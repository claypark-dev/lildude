/**
 * Agent loop — the central nervous system of Lil Dude.
 * Processes user messages through a pipeline of input sanitization,
 * permission gating, cost control, model routing, context building,
 * LLM calls with tool-use loops, and cost tracking.
 * See HLD Section 3 and Section 12 for kill conditions.
 */

import type { ChatResponse, Message, ChannelType, ModelSelection } from '../types/index.js';
import type { SecurityLevel } from '../security/permissions.js';
import { stripThinkTags, prependNoThink, antiThinkingInstruction } from '../utils/think-strip.js';
import type { EmbeddingResult } from '../memory/embeddings.js';
import { extractAndStorePreferences } from '../memory/preference-extractor.js';
import { extractInlineFacts } from '../memory/inline-extractor.js';
import { upsertKnowledge } from '../persistence/knowledge.js';
import { processEntities } from '../memory/entity-linker.js';
import { checkForInjection } from '../security/injection.js';
import { canAfford, isWithinMonthlyBudget } from '../cost/budget.js';
import { calculateCost } from '../cost/pricing.js';
import { classifyComplexity, selectModel, selectModelWithHistory } from '../providers/router.js';
import { buildContext } from '../context/manager.js';
import { createToolExecutor } from '../tools/executor.js';
import { CORE_TOOLS } from '../tools/definitions.js';
import { recordTokenUsage } from '../persistence/token-usage.js';
import { getMonthlyTotalCost } from '../persistence/token-usage.js';
import {
  createConversation,
  getConversation,
  incrementMessageCount,
} from '../persistence/conversations.js';
import { appendConversationLog, getConversationLogs } from '../persistence/conversation-logs.js';
import { createTask, updateTaskStatus, updateTaskSpend } from '../persistence/tasks.js';
import { recordRoutingDecision } from '../persistence/routing-history.js';
import { recordFailurePattern } from '../persistence/failure-patterns.js';
import { recordWaveExecution } from '../persistence/wave-effectiveness.js';
import { recordExecution, getWaveSource } from '../persistence/wave-executions.js';
import { orchestratorLogger } from '../utils/logger.js';
import { matchWave } from '../waves/registry.js';
import { executeWave } from '../waves/executor.js';
import { checkWaveSafety, getDefaultSafetyTier } from '../waves/safety.js';
import { detectGap, generateWaveProposal } from '../waves/shorebreak.js';
import { createToolGuard } from './tool-guard.js';
import { runPostTaskQualityCheck } from './quality-checker.js';
import {
  DEFAULT_MAX_ROUND_TRIPS,
  DEFAULT_MAX_TOKENS_PER_TASK,
  DEFAULT_MAX_DURATION_MS,
  DEFAULT_MAX_CONSECUTIVE_ERRORS,
  DEFAULT_TASK_BUDGET_USD,
  extractResponseText,
  executeTools,
  buildResult,
  triggerSummarizationIfNeeded,
  extractKeyFactsOnTaskCompletion,
} from './agent-loop-helpers.js';
import type {
  AgentLoopDeps,
  AgentLoopConfig,
  AgentLoopResult,
  AgentLoop,
  ProcessMessageOptions,
} from './agent-loop-helpers.js';

// Re-export types so existing consumers aren't broken
export type { AgentLoopDeps, AgentLoopConfig, AgentLoopResult, AgentLoop, ProcessMessageOptions };

/**
 * Minimum match score for a wave to be routed to.
 * Lowered from 0.4 → 0.15 after capping the coverage-ratio denominator
 * at 80 chars (see registry.ts). The LLM fallthrough (llmCallCount === 0
 * && no external_data) acts as a second safety net for canned wave outputs.
 */
const WAVE_MATCH_THRESHOLD = 0.15;

/**
 * Create an agent loop configured with the given dependencies.
 * The agent loop processes messages through the full pipeline:
 * sanitization, permission gate, cost gate, model routing,
 * context building, LLM call with tool-use loop, and cost tracking.
 *
 * @param deps - The injected dependencies (db, provider, security level, etc.).
 * @param config - Optional kill condition overrides.
 * @returns An AgentLoop instance.
 */
export function createAgentLoop(
  deps: AgentLoopDeps,
  config?: AgentLoopConfig,
): AgentLoop {
  const maxRoundTrips = config?.maxRoundTrips ?? DEFAULT_MAX_ROUND_TRIPS;
  const maxTokensPerTask = config?.maxTokensPerTask ?? DEFAULT_MAX_TOKENS_PER_TASK;
  const maxDurationMs = config?.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;
  const maxConsecutiveErrors = config?.maxConsecutiveErrors ?? DEFAULT_MAX_CONSECUTIVE_ERRORS;
  const taskBudgetUsd = config?.taskBudgetUsd ?? DEFAULT_TASK_BUDGET_USD;
  const enabledProviders = config?.enabledProviders ?? [deps.provider.name];
  const enableHybridSearch = config?.enableHybridSearch ?? false;

  return {
    updateSecurityLevel(level: SecurityLevel): void {
      deps.securityLevel = level;
      orchestratorLogger.info({ securityLevel: level }, 'Security level hot-reloaded');
    },

    async processMessage(
      conversationId: string,
      userMessage: string,
      channelType: ChannelType,
      options?: ProcessMessageOptions,
    ): Promise<AgentLoopResult> {
      const abortSignal = options?.abortSignal;
      const startTime = Date.now();
      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let totalCostUsd = 0;
      let toolCallCount = 0;
      let roundTrips = 0;

      try {
        // Step 1: Input sanitization — check for prompt injection
        const sanitizationResult = checkForInjection(userMessage, 'user');
        if (!sanitizationResult.isClean) {
          orchestratorLogger.warn(
            { conversationId, threats: sanitizationResult.threats },
            'Prompt injection detected in user message',
          );
          return buildResult(
            'I detected potentially harmful content in your message and cannot process it. Please rephrase your request.',
            totalInputTokens, totalOutputTokens, totalCostUsd, toolCallCount, roundTrips,
          );
        }

        // Step 2: Create task for tracking
        const task = createTask(deps.db, {
          type: 'chat',
          description: userMessage.slice(0, 200),
          channelType,
          channelId: conversationId,
          tokenBudgetUsd: taskBudgetUsd,
        });
        const taskId = task.id;
        updateTaskStatus(deps.db, taskId, 'running');

        // Step 3: Ensure conversation exists
        if (!getConversation(deps.db, conversationId)) {
          createConversation(deps.db, { id: conversationId, channelType, channelId: conversationId, taskId });
        }

        // Step 4: Monthly budget check
        const monthlySpent = getMonthlyTotalCost(deps.db);
        if (!isWithinMonthlyBudget(monthlySpent, deps.monthlyBudgetUsd, 0)) {
          updateTaskStatus(deps.db, taskId, 'failed', 'Monthly budget exceeded');
          return buildResult(
            'Monthly budget has been exceeded. Please adjust your budget or wait until next month.',
            totalInputTokens, totalOutputTokens, totalCostUsd, toolCallCount, roundTrips,
          );
        }

        // Step 5: Model routing — prefer quality-aware routing with history
        const tier = classifyComplexity(userMessage, false);
        let modelSelection: ModelSelection;
        try {
          modelSelection = selectModelWithHistory(tier, enabledProviders, deps.db, 'chat');
        } catch {
          updateTaskStatus(deps.db, taskId, 'failed', 'No model available');
          return buildResult(
            'No suitable model is available for this request. Please check your provider configuration.',
            totalInputTokens, totalOutputTokens, totalCostUsd, toolCallCount, roundTrips,
          );
        }

        // Step 5b: Wave routing — check if a registered wave matches
        const waveMatch = matchWave(userMessage);

        // Skip wave if this looks like a conversational follow-up referencing
        // previous results rather than a new search/action request.
        // Detect via: (1) recent conversation history exists AND (2) message
        // uses anaphoric references ("that", "those", "it") without new search criteria.
        let skipWaveForFollowUp = false;
        if (waveMatch && waveMatch.score > WAVE_MATCH_THRESHOLD) {
          const recentLogs = getConversationLogs(deps.db, conversationId, 4);
          if (recentLogs.length >= 2) {
            const lower = userMessage.toLowerCase();
            const hasAnaphoricRef = /\b(that|those|the|these|it|this|which|above|earlier|previous|same)\b/.test(lower);
            const isShortMessage = lower.split(/\s+/).length <= 15;
            if (hasAnaphoricRef && isShortMessage) {
              skipWaveForFollowUp = true;
              orchestratorLogger.info(
                { waveName: waveMatch.wave.manifest.name, score: waveMatch.score },
                'Skipping wave — message looks like a follow-up referencing previous results',
              );
            }
          }
        }

        if (waveMatch && waveMatch.score > WAVE_MATCH_THRESHOLD && !skipWaveForFollowUp) {
          // Wave safety check before execution
          const waveSafetyTier = waveMatch.wave.manifest.safetyTier ?? getDefaultSafetyTier();
          const safetyResult = checkWaveSafety(waveSafetyTier, modelSelection.tier, deps.securityLevel);

          if (safetyResult.decision === 'block') {
            orchestratorLogger.warn(
              { waveName: waveMatch.wave.manifest.name, reason: safetyResult.reason },
              'Wave blocked by safety check',
            );
            updateTaskStatus(deps.db, taskId, 'failed', safetyResult.reason);
            const blockMsg = safetyResult.requiredTier
              ? `I can't run "${waveMatch.wave.manifest.name}" with the current model and security settings. A ${safetyResult.requiredTier}-tier model is required.`
              : `I can't run "${waveMatch.wave.manifest.name}" at this security level. Please adjust your security settings.`;
            return buildResult(blockMsg, totalInputTokens, totalOutputTokens,
              totalCostUsd, toolCallCount, roundTrips);
          }

          if (safetyResult.decision === 'confirm') {
            orchestratorLogger.info(
              { waveName: waveMatch.wave.manifest.name, reason: safetyResult.reason },
              'Wave requires user confirmation (auto-approved in current version)',
            );
            // TODO: Wire user confirmation channel when approval queue is built (Sprint 4)
          }

          orchestratorLogger.info(
            { waveName: waveMatch.wave.manifest.name, score: waveMatch.score, safety: safetyResult.decision },
            'Wave matched, routing to wave executor',
          );
          const waveResult = await executeWave(waveMatch.wave, userMessage, {
            db: deps.db, provider: deps.provider,
            taskBudgetUsd, taskSpentUsd: totalCostUsd, enabledProviders,
            securityLevel: deps.securityLevel,
            getAccessToken: deps.getAccessToken,
          });
          totalInputTokens += waveResult.tokensUsed.input;
          totalOutputTokens += waveResult.tokensUsed.output;
          totalCostUsd += waveResult.costUsd;
          updateTaskSpend(deps.db, taskId, totalCostUsd);
          updateTaskStatus(deps.db, taskId, waveResult.success ? 'completed' : 'failed',
            waveResult.success ? undefined : waveResult.output);

          // Track wave effectiveness for self-improvement (generated waves only)
          recordWaveExecution(deps.db, waveMatch.wave.manifest.name, waveResult.success);

          // Track comprehensive execution stats (all wave sources)
          try {
            const waveSource = getWaveSource(deps.db, waveMatch.wave.manifest.name);
            recordExecution(deps.db, {
              waveName: waveMatch.wave.manifest.name,
              waveSource,
              waveCategory: waveMatch.wave.manifest.category,
              success: waveResult.success,
              errorMessage: waveResult.success ? undefined : waveResult.output.slice(0, 500),
            });
          } catch {
            // Non-critical — don't fail the request
          }

          // Record failure pattern if wave execution failed
          if (!waveResult.success) {
            try {
              recordFailurePattern(deps.db, {
                intent: userMessage.slice(0, 200),
                waveName: waveMatch.wave.manifest.name,
                errorType: 'wave_execution_failure',
                errorMessage: waveResult.output.slice(0, 500),
                model: modelSelection.model,
                provider: modelSelection.provider,
              });
            } catch {
              // Non-critical — don't fail the request
            }
          }

          // Check for external data tags that need LLM summarization.
          // Check for both formats: <external_data (wave inline) and <EXTERNAL_ (server spotlighting)
          const hasExternalData = waveResult.output.includes('<external_data') || waveResult.output.includes('<EXTERNAL_');

          // Only fall through to the regular LLM path if the wave FAILED and
          // didn't use any LLM calls or external data — meaning it couldn't
          // handle the request at all. Successful waves always return their
          // output (even if no LLM was used), since they performed real actions
          // like creating requests, setting reminders, or returning status info.
          if (!waveResult.success && waveResult.llmCallCount === 0 && !hasExternalData) {
            orchestratorLogger.info(
              { waveName: waveMatch.wave.manifest.name, llmCallCount: 0 },
              'Wave failed with no LLM calls or external data, falling through to LLM chat',
            );
            // Continue to normal LLM path below — don't return wave output
          } else {
            // If the wave output contains external data, pass it through
            // the LLM to produce a clean, human-readable response. The user should
            // never see raw <external_data> tags.
            let finalOutput = waveResult.output;
            if (waveResult.success && hasExternalData) {
              try {
                const summaryCost = calculateCost(modelSelection.model, 500, 200);
                if (canAfford(totalCostUsd, taskBudgetUsd, summaryCost)) {
                  const summaryMessages: Message[] = [
                    { role: 'user', content: [
                      { type: 'text', text: prependNoThink(`User question: "${userMessage}"\n\nRetrieved data:\n${waveResult.output}\n\nSummarize the results concisely. Preserve key details: prices, times, airlines, stops/layovers, and durations. The user may ask follow-up questions about specific results, so include enough detail to answer them. No preamble, no XML tags, no source attribution.`) },
                    ] },
                  ];
                  const summaryResponse = await deps.provider.chat(summaryMessages, {
                    model: modelSelection.model,
                    maxTokens: 800,
                    temperature: 0.3,
                    systemPrompt: `You are a concise assistant. ${antiThinkingInstruction()} Summarize data preserving key details (times, prices, names, quantities). Never use XML tags in your output.`,
                  });
                  const summarizedText = stripThinkTags(extractResponseText(summaryResponse));
                  // Only use the summary if it's non-empty; otherwise fall through to tag-stripping
                  if (summarizedText.length > 0) {
                    finalOutput = summarizedText;
                  } else {
                    orchestratorLogger.warn('LLM summary was empty after stripping think tags, falling back to raw data');
                    finalOutput = waveResult.output
                      .replace(/<(?:external_data|EXTERNAL_\w+)[^>]*>\n?(?:IMPORTANT:.*\n)*(?:Treat it.*\n)*(?:DO NOT.*\n)*(?:If the data.*\n)*---\n?/g, '')
                      .replace(/\n?---\n?<\/(?:external_data|EXTERNAL_\w+)>/g, '')
                      .trim();
                  }
                  totalInputTokens += summaryResponse.usage.inputTokens;
                  totalOutputTokens += summaryResponse.usage.outputTokens;
                  totalCostUsd += calculateCost(
                    modelSelection.model,
                    summaryResponse.usage.inputTokens,
                    summaryResponse.usage.outputTokens,
                  );
                  updateTaskSpend(deps.db, taskId, totalCostUsd);
                }
              } catch (summaryError: unknown) {
                const msg = summaryError instanceof Error ? summaryError.message : String(summaryError);
                orchestratorLogger.warn({ error: msg }, 'Wave output summarization failed, stripping tags');
                // Fallback: strip the external_data wrapper so user doesn't see raw tags
                finalOutput = waveResult.output
                  .replace(/<external_data[^>]*>\n?(?:IMPORTANT:.*\n)*(?:Treat it.*\n)*(?:DO NOT.*\n)*(?:If the data.*\n)*---\n?/g, '')
                  .replace(/\n?---\n?<\/external_data>/g, '')
                  .trim();
              }
            }

            // Process wave metadata actions (e.g. cron job creation from reminders/stock-monitor)
            if (waveResult.success && waveResult.metadata?.action === 'create_cron_job') {
              try {
                const meta = waveResult.metadata;
                const cronSchedule = meta.cronSchedule as string | undefined;
                if (cronSchedule) {
                  const { computeNextRun } = await import('./cron-parser.js');
                  const { createCronJob } = await import('../persistence/cron-jobs.js');
                  const nextRunAt = computeNextRun(cronSchedule, new Date());
                  const cronJob = createCronJob(deps.db, {
                    schedule: cronSchedule,
                    taskDescription: (meta.taskDescription as string) ?? userMessage,
                    waveId: (meta.waveId as string) ?? waveMatch.wave.manifest.name,
                    usesAi: (meta.usesAi as boolean) ?? false,
                    estimatedCostPerRun: (meta.estimatedCostPerRun as number) ?? 0,
                    nextRunAt,
                    channelType: channelType,
                    channelId: conversationId,
                    expiresAt: meta.expiresAt ? new Date(meta.expiresAt as string) : undefined,
                  });
                  orchestratorLogger.info(
                    { jobId: cronJob.id, schedule: cronSchedule, waveId: cronJob.waveId },
                    'Cron job created from wave metadata',
                  );
                  // Append cron job info to the output so the user knows it was scheduled
                  finalOutput += `\n\n📅 Scheduled (job ${cronJob.id}): runs on "${cronSchedule}"`;
                  if (meta.expiresAt) {
                    finalOutput += ` until ${new Date(meta.expiresAt as string).toLocaleString()}`;
                  }
                }
              } catch (cronError: unknown) {
                const cronMsg = cronError instanceof Error ? cronError.message : String(cronError);
                orchestratorLogger.error({ error: cronMsg }, 'Failed to create cron job from wave metadata');
              }
            }

            // Log both sides of the conversation so follow-up messages have context.
            // Without this, the wave output is lost and follow-ups can't reference it.
            appendConversationLog(deps.db, {
              conversationId, role: 'user', content: userMessage, tokenCount: 0,
            });
            appendConversationLog(deps.db, {
              conversationId, role: 'assistant', content: finalOutput, tokenCount: 0,
            });

            return buildResult(finalOutput, totalInputTokens, totalOutputTokens,
              totalCostUsd, toolCallCount, waveResult.llmCallCount);
          }
        }

        // Step 6: Generate query embedding for hybrid search (if enabled)
        let queryEmbedding: EmbeddingResult | undefined;
        if (enableHybridSearch && deps.embeddingGenerator) {
          try {
            queryEmbedding = await deps.embeddingGenerator.generateEmbedding(userMessage);
          } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            orchestratorLogger.warn({ error: msg }, 'Embedding generation failed, falling back to keyword search');
          }
        }

        // Step 6b: Inline fact extraction (deterministic, zero LLM cost)
        // Extract and store facts from the user message BEFORE context is built
        // so that newly learned facts appear in the same request's knowledge search.
        if (deps.db) {
          try {
            const inlineFacts = extractInlineFacts(userMessage);
            for (const fact of inlineFacts) {
              const entry = upsertKnowledge(deps.db, {
                category: fact.category,
                key: fact.key,
                value: fact.value,
                confidence: fact.confidence,
                sourceConversationId: conversationId,
                isCorrection: fact.isCorrection,
              });
              // Link detected entities to the knowledge entry
              if (fact.entities && fact.entities.length > 0) {
                processEntities(deps.db, entry.id, fact.entities);
              }
            }
          } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            orchestratorLogger.warn({ error: msg }, 'Inline fact extraction failed (non-fatal)');
          }
        }

        // Step 7: Build context
        const contextPayload = await buildContext(deps.db, conversationId, userMessage, {
          userName: deps.userName,
          securityLevel: deps.securityLevel,
          useHybridSearch: enableHybridSearch,
          queryEmbedding,
        });

        // Step 7: Log user message
        appendConversationLog(deps.db, {
          conversationId, role: 'user', content: userMessage, tokenCount: contextPayload.totalTokens,
        });

        // Step 8: Pre-call cost gate
        const estimatedCost = calculateCost(modelSelection.model, contextPayload.totalTokens, 1000);
        if (!canAfford(totalCostUsd, taskBudgetUsd, estimatedCost)) {
          updateTaskStatus(deps.db, taskId, 'failed', 'Task budget exceeded before first call');
          return buildResult(
            'This request would exceed the task budget. Please try a simpler request.',
            totalInputTokens, totalOutputTokens, totalCostUsd, toolCallCount, roundTrips,
          );
        }

        // Step 9: Create tool executor and tool guard
        const toolExecutor = createToolExecutor(deps.db, deps.securityLevel, taskId);
        const toolGuard = createToolGuard();

        // Step 10: LLM call with tool-use loop
        const messages: Message[] = [...contextPayload.messages];
        let consecutiveErrors = 0;

        while (roundTrips < maxRoundTrips) {
          if (abortSignal?.aborted) {
            orchestratorLogger.info({ taskId, roundTrips }, 'Task aborted via signal');
            updateTaskStatus(deps.db, taskId, 'killed', 'Aborted');
            return buildResult('Task was cancelled.',
              totalInputTokens, totalOutputTokens, totalCostUsd, toolCallCount, roundTrips);
          }

          if (Date.now() - startTime > maxDurationMs) {
            orchestratorLogger.warn({ taskId, roundTrips }, 'Max duration exceeded');
            updateTaskStatus(deps.db, taskId, 'killed', 'Max duration exceeded');
            return buildResult('I ran out of time processing your request. Here is what I have so far.',
              totalInputTokens, totalOutputTokens, totalCostUsd, toolCallCount, roundTrips);
          }

          if (totalInputTokens + totalOutputTokens > maxTokensPerTask) {
            orchestratorLogger.warn({ taskId, roundTrips }, 'Max tokens per task exceeded');
            updateTaskStatus(deps.db, taskId, 'killed', 'Max tokens exceeded');
            return buildResult('Token limit for this task has been reached.',
              totalInputTokens, totalOutputTokens, totalCostUsd, toolCallCount, roundTrips);
          }

          const preCallEstimate = calculateCost(modelSelection.model, 1000, 1000);
          if (!canAfford(totalCostUsd, taskBudgetUsd, preCallEstimate)) {
            orchestratorLogger.warn({ taskId, totalCostUsd }, 'Task budget exceeded');
            updateTaskStatus(deps.db, taskId, 'failed', 'Task budget exceeded');
            return buildResult('Task budget has been exceeded.',
              totalInputTokens, totalOutputTokens, totalCostUsd, toolCallCount, roundTrips);
          }

          let response: ChatResponse;
          try {
            response = await deps.provider.chat(messages, {
              model: modelSelection.model, maxTokens: 4096, tools: CORE_TOOLS,
              systemPrompt: contextPayload.systemPrompt,
            });
            consecutiveErrors = 0;
          } catch (error: unknown) {
            consecutiveErrors++;
            const errorMessage = error instanceof Error ? error.message : String(error);
            orchestratorLogger.error({ taskId, roundTrips, error: errorMessage }, 'LLM call failed');
            if (consecutiveErrors >= maxConsecutiveErrors) {
              updateTaskStatus(deps.db, taskId, 'failed', 'Max consecutive errors');
              return buildResult('I encountered repeated errors trying to process your request. Please try again later.',
                totalInputTokens, totalOutputTokens, totalCostUsd, toolCallCount, roundTrips);
            }
            continue;
          }

          roundTrips++;
          const callCost = calculateCost(modelSelection.model, response.usage.inputTokens,
            response.usage.outputTokens, response.usage.cacheReadTokens ?? 0);
          totalInputTokens += response.usage.inputTokens;
          totalOutputTokens += response.usage.outputTokens;
          totalCostUsd += callCost;

          recordTokenUsage(deps.db, {
            taskId, provider: deps.provider.name, model: modelSelection.model,
            inputTokens: response.usage.inputTokens, outputTokens: response.usage.outputTokens,
            cachedTokens: response.usage.cacheReadTokens ?? 0, costUsd: callCost, roundTripNumber: roundTrips,
          });

          if (response.stopReason === 'end_turn' || response.stopReason === 'max_tokens') {
            const responseText = extractResponseText(response);
            appendConversationLog(deps.db, {
              conversationId, role: 'assistant', content: responseText, tokenCount: response.usage.outputTokens,
            });
            incrementMessageCount(deps.db, conversationId, response.usage.inputTokens + response.usage.outputTokens);
            updateTaskSpend(deps.db, taskId, totalCostUsd);
            updateTaskStatus(deps.db, taskId, 'completed');
            recordRoutingDecision(deps.db, {
              taskId, model: modelSelection.model, provider: modelSelection.provider,
              tier: modelSelection.tier, taskType: 'chat',
              inputLength: userMessage.length, outputTokens: totalOutputTokens, costUsd: totalCostUsd,
            });
            // Optional quality check for small-tier completions
            if (modelSelection.tier === 'small' && config?.enableQualityChecks) {
              const qualityResult = await runPostTaskQualityCheck(deps.db, taskId, userMessage, responseText, modelSelection, deps.provider, totalCostUsd, taskBudgetUsd);
              if (qualityResult.rated) {
                orchestratorLogger.info({ taskId, score: qualityResult.score, feedback: qualityResult.feedback }, 'Quality check completed');
              }
            }

            // Shorebreak: detect capability gaps and propose new waves
            if (config?.enableShorebreak) {
              try {
                const gapResult = await detectGap(responseText, userMessage, {
                  db: deps.db, provider: deps.provider,
                  taskBudgetUsd, taskSpentUsd: totalCostUsd, enabledProviders,
                });
                if (gapResult?.isGap) {
                  orchestratorLogger.info(
                    { waveName: gapResult.suggestedWaveName, reason: gapResult.reason },
                    'Shorebreak detected capability gap',
                  );
                  const proposal = await generateWaveProposal(gapResult, userMessage, {
                    db: deps.db, provider: deps.provider,
                    taskBudgetUsd, taskSpentUsd: totalCostUsd, enabledProviders,
                  });
                  if (proposal) {
                    const shorebreakNote = proposal.scanPassed
                      ? `\n\n---\n💡 I noticed I couldn't do this, so I generated a new "${proposal.name}" wave. Review and approve it in the web panel to enable this capability next time.`
                      : `\n\n---\n⚠️ I tried to generate a "${proposal.name}" wave for this, but it didn't pass the security scan. You can review details in the web panel.`;
                    triggerSummarizationIfNeeded(deps.db, conversationId, deps.provider, totalCostUsd, taskBudgetUsd);
                    extractKeyFactsOnTaskCompletion(deps.db, conversationId);
                    extractAndStorePreferences(deps.db, [userMessage]);
                    return buildResult(responseText + shorebreakNote, totalInputTokens, totalOutputTokens, totalCostUsd, toolCallCount, roundTrips);
                  }
                }
              } catch (shorebreakError: unknown) {
                const sbMsg = shorebreakError instanceof Error ? shorebreakError.message : String(shorebreakError);
                orchestratorLogger.warn({ error: sbMsg }, 'Shorebreak gap detection failed (non-critical)');
              }
            }

            triggerSummarizationIfNeeded(deps.db, conversationId, deps.provider, totalCostUsd, taskBudgetUsd);
            extractKeyFactsOnTaskCompletion(deps.db, conversationId);
            extractAndStorePreferences(deps.db, [userMessage]);
            return buildResult(responseText, totalInputTokens, totalOutputTokens, totalCostUsd, toolCallCount, roundTrips);
          }

          if (response.stopReason === 'tool_use') {
            const toolUseBlocks = response.content.filter((block) => block.type === 'tool_use');
            messages.push({ role: 'assistant', content: response.content });
            const toolExecResult = await executeTools(
              toolExecutor, toolUseBlocks, toolGuard, taskId, modelSelection.tier,
            );
            toolCallCount += toolUseBlocks.length;
            messages.push({ role: 'user', content: toolExecResult.results });

            // Handle tool guard decisions
            if (toolExecResult.guardDecision) {
              if (!toolExecResult.guardDecision.shouldContinue) {
                orchestratorLogger.warn({ taskId }, 'Tool guard stopping task due to repeated failures');
                updateTaskStatus(deps.db, taskId, 'failed', toolExecResult.guardDecision.reason);
                toolGuard.clearTask(taskId);

                // Record failure pattern for learning
                try {
                  recordFailurePattern(deps.db, {
                    intent: userMessage.slice(0, 200),
                    errorType: 'tool_guard_stop',
                    errorMessage: toolExecResult.guardDecision.reason ?? 'Repeated tool failures',
                    model: modelSelection.model,
                    provider: modelSelection.provider,
                  });
                } catch {
                  // Non-critical
                }

                return buildResult(
                  `I had trouble completing your request: ${toolExecResult.guardDecision.reason}`,
                  totalInputTokens, totalOutputTokens, totalCostUsd, toolCallCount, roundTrips,
                );
              }
              if (toolExecResult.guardDecision.shouldEscalate && toolExecResult.guardDecision.recommendedTier) {
                try {
                  modelSelection = selectModel(toolExecResult.guardDecision.recommendedTier, enabledProviders);
                  orchestratorLogger.info(
                    { taskId, from: modelSelection.tier, to: toolExecResult.guardDecision.recommendedTier },
                    'Model escalated by tool guard',
                  );
                } catch {
                  orchestratorLogger.warn({ taskId }, 'Tool guard recommended escalation but no model available');
                }
              }
            }
            continue;
          }

          const responseText = extractResponseText(response);
          updateTaskSpend(deps.db, taskId, totalCostUsd);
          updateTaskStatus(deps.db, taskId, 'completed');
          recordRoutingDecision(deps.db, {
            taskId, model: modelSelection.model, provider: modelSelection.provider,
            tier: modelSelection.tier, taskType: 'chat',
            inputLength: userMessage.length, outputTokens: totalOutputTokens, costUsd: totalCostUsd,
          });
          // Optional quality check for small-tier completions
          if (modelSelection.tier === 'small' && config?.enableQualityChecks) {
            const qualityResult = await runPostTaskQualityCheck(deps.db, taskId, userMessage, responseText, modelSelection, deps.provider, totalCostUsd, taskBudgetUsd);
            if (qualityResult.rated) {
              orchestratorLogger.info({ taskId, score: qualityResult.score, feedback: qualityResult.feedback }, 'Quality check completed');
            }
          }
          extractKeyFactsOnTaskCompletion(deps.db, conversationId);
          extractAndStorePreferences(deps.db, [userMessage]);
          return buildResult(responseText || 'I completed your request.',
            totalInputTokens, totalOutputTokens, totalCostUsd, toolCallCount, roundTrips);
        }

        orchestratorLogger.warn({ conversationId, roundTrips }, 'Max round trips reached');
        updateTaskStatus(deps.db, task.id, 'killed', 'Max round trips exceeded');
        toolGuard.clearTask(taskId);
        return buildResult('I reached the maximum number of processing steps for this request.',
          totalInputTokens, totalOutputTokens, totalCostUsd, toolCallCount, roundTrips);
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        orchestratorLogger.error({ conversationId, error: errorMessage }, 'Unhandled error in agent loop');
        return buildResult('An unexpected error occurred while processing your request. Please try again.',
          totalInputTokens, totalOutputTokens, totalCostUsd, toolCallCount, roundTrips);
      }
    },
  };
}
