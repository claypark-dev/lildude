/**
 * Shorebreak — Dynamic Wave Generator — S2.N.4
 *
 * When the agent detects it cannot fulfill a user request (no matching wave),
 * Shorebreak generates a new wave on-the-fly:
 *
 *   1. Gap detection — analyze the failed response to identify the missing capability
 *   2. Template match — find a safe building block template for the request
 *   3. Code generation — LLM composes code from template (or free-form fallback)
 *   4. Security scan — AST-based static analysis on ALL generated code
 *   5. User proposal — present the wave for user approval
 *   6. Sandbox test — run in vm.createContext() to verify it works
 *   7. Registration — save to ~/.lil-dude/waves/generated/ and load on restart
 *
 * Every LLM call goes through canAfford() budget checks.
 */

import type BetterSqlite3 from 'better-sqlite3';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import type { LLMProvider, Message, WaveSafetyTier } from '../types/index.js';
import { canAfford } from '../cost/budget.js';
import { calculateCost } from '../cost/pricing.js';
import { selectModel } from '../providers/router.js';
import { createModuleLogger } from '../utils/logger.js';
import { homeDir } from '../config/loader.js';
import { scanWaveCode, type ScanResult } from './security-scanner.js';
import { executeSandboxed, type SandboxResult } from './shorebreak-sandbox.js';
import { findMatchingTemplate, type ShorebreakTemplate } from './shorebreak-templates/index.js';
import {
  buildGapDetectionPrompt,
  buildTemplateCompositionPrompt,
  buildFreeFormGenerationPrompt,
} from './shorebreak-prompts.js';
import { stripThinkTags, prependNoThink } from '../utils/think-strip.js';

const shorebreakLogger = createModuleLogger('shorebreak');

/** Result of gap detection analysis. */
export interface GapDetectionResult {
  /** Whether a capability gap was detected. */
  isGap: boolean;
  /** Why the gap exists. */
  reason: string;
  /** Suggested name for the new wave. */
  suggestedWaveName: string;
  /** Suggested description. */
  suggestedDescription: string;
  /** Domains the wave may need. */
  requiredDomains: string[];
  /** Suggested safety tier. */
  suggestedSafetyTier: WaveSafetyTier;
}

/** A wave proposal for user review before approval. */
export interface WaveProposal {
  /** Unique ID for this proposal. */
  id: string;
  /** Proposed wave name. */
  name: string;
  /** Description of what the wave does. */
  description: string;
  /** Generated source code. */
  sourceCode: string;
  /** Safety tier classification. */
  safetyTier: WaveSafetyTier;
  /** Template used (or 'free-form'). */
  sourceTemplate: string;
  /** Domains the wave needs to contact. */
  requiredDomains: string[];
  /** Security scan results. */
  scanResult: ScanResult;
  /** Whether the security scan passed. */
  scanPassed: boolean;
  /** Sandbox test results (if scan passed). */
  sandboxResult?: SandboxResult;
  /** Whether the sandbox test passed. */
  testPassed: boolean;
  /** Cost of generating this proposal (USD). */
  generationCostUsd: number;
}

/** Dependencies for the Shorebreak system. */
export interface ShorebreakDeps {
  /** Database instance. */
  db: BetterSqlite3.Database;
  /** LLM provider for code generation. */
  provider: LLMProvider;
  /** Budget remaining for this task (USD). */
  taskBudgetUsd: number;
  /** Amount already spent on this task (USD). */
  taskSpentUsd: number;
  /** Enabled provider names for model selection. */
  enabledProviders: string[];
}

/**
 * Detect a capability gap from the agent's response.
 *
 * Calls the LLM with the gap detection prompt to analyze whether
 * the agent's response indicates it cannot fulfill the request.
 *
 * @param agentResponse - The text response from the agent.
 * @param userMessage - The original user request.
 * @param deps - Shorebreak dependencies.
 * @returns Gap detection result, or null if budget insufficient.
 */
export async function detectGap(
  agentResponse: string,
  userMessage: string,
  deps: ShorebreakDeps,
): Promise<GapDetectionResult | null> {
  const modelSelection = selectModel('small', deps.enabledProviders);
  const estimatedCost = calculateCost(modelSelection.model, 500, 300);

  if (!canAfford(deps.taskSpentUsd, deps.taskBudgetUsd, estimatedCost)) {
    shorebreakLogger.warn('Insufficient budget for gap detection');
    return null;
  }

  try {
    const messages: Message[] = [
      { role: 'user', content: prependNoThink(`User asked: "${userMessage}"\n\nAssistant responded: "${agentResponse}"`) },
    ];

    const response = await deps.provider.chat(messages, {
      model: modelSelection.model,
      maxTokens: 256,
      temperature: 0,
      systemPrompt: buildGapDetectionPrompt(),
    });

    const responseText = stripThinkTags(
      response.content
        .filter((block) => block.type === 'text' && block.text)
        .map((block) => block.text ?? '')
        .join(''),
    );

    const parsed = parseGapDetectionResponse(responseText);

    shorebreakLogger.info(
      { isGap: parsed.isGap, waveName: parsed.suggestedWaveName },
      'Gap detection complete',
    );

    return parsed;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    shorebreakLogger.error({ error: message }, 'Gap detection failed');
    return null;
  }
}

/**
 * Parse the gap detection LLM response into a structured result.
 */
function parseGapDetectionResponse(responseText: string): GapDetectionResult {
  const trimmed = responseText.trim();

  try {
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return defaultGapResult();
    }

    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

    return {
      isGap: parsed['isGap'] === true,
      reason: typeof parsed['reason'] === 'string' ? parsed['reason'] : '',
      suggestedWaveName: typeof parsed['suggestedWaveName'] === 'string'
        ? parsed['suggestedWaveName']
        : 'unknown-wave',
      suggestedDescription: typeof parsed['suggestedDescription'] === 'string'
        ? parsed['suggestedDescription']
        : '',
      requiredDomains: Array.isArray(parsed['requiredDomains'])
        ? (parsed['requiredDomains'] as string[]).filter((d) => typeof d === 'string')
        : [],
      suggestedSafetyTier: isValidSafetyTier(parsed['suggestedSafetyTier'])
        ? parsed['suggestedSafetyTier'] as WaveSafetyTier
        : 'observe',
    };
  } catch {
    return defaultGapResult();
  }
}

function defaultGapResult(): GapDetectionResult {
  return {
    isGap: false,
    reason: '',
    suggestedWaveName: '',
    suggestedDescription: '',
    requiredDomains: [],
    suggestedSafetyTier: 'observe',
  };
}

function isValidSafetyTier(value: unknown): boolean {
  return typeof value === 'string' &&
    ['observe', 'create', 'modify', 'destroy', 'execute'].includes(value);
}

/**
 * Generate a wave proposal from a detected capability gap.
 *
 * Tries template-based generation first, falls back to free-form.
 * Scans the generated code, runs a sandbox test, and returns the
 * full proposal for user review.
 *
 * @param gap - The detected capability gap.
 * @param userMessage - The original user request.
 * @param deps - Shorebreak dependencies.
 * @returns A WaveProposal for user review, or null on failure.
 */
export async function generateWaveProposal(
  gap: GapDetectionResult,
  userMessage: string,
  deps: ShorebreakDeps,
): Promise<WaveProposal | null> {
  const modelSelection = selectModel('medium', deps.enabledProviders);
  const estimatedCost = calculateCost(modelSelection.model, 1000, 1000);

  if (!canAfford(deps.taskSpentUsd, deps.taskBudgetUsd, estimatedCost)) {
    shorebreakLogger.warn('Insufficient budget for wave generation');
    return null;
  }

  let sourceCode: string;
  let sourceTemplate: string;
  let generationCostUsd = 0;

  // Try template-based generation first
  const template = findMatchingTemplate(userMessage);

  try {
    if (template) {
      shorebreakLogger.info({ templateId: template.id }, 'Using template for wave generation');
      const result = await generateFromTemplate(template, userMessage, gap, deps, modelSelection.model);
      sourceCode = result.code;
      sourceTemplate = template.id;
      generationCostUsd = result.costUsd;
    } else {
      shorebreakLogger.info('No template match, using free-form generation');
      const result = await generateFreeForm(gap, userMessage, deps, modelSelection.model);
      sourceCode = result.code;
      sourceTemplate = 'free-form';
      generationCostUsd = result.costUsd;
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    shorebreakLogger.error({ error: message }, 'Wave code generation failed');
    return null;
  }

  // Security scan
  const scanResult = scanWaveCode(sourceCode, gap.requiredDomains);

  // Sandbox test (only if scan passed)
  let sandboxResult: SandboxResult | undefined;
  let testPassed = false;

  if (scanResult.passed) {
    sandboxResult = await executeSandboxed(
      sourceCode,
      { _test: true },
      gap.requiredDomains,
    );
    testPassed = sandboxResult.success;
  }

  const proposalId = nanoid();

  const proposal: WaveProposal = {
    id: proposalId,
    name: gap.suggestedWaveName,
    description: gap.suggestedDescription,
    sourceCode,
    safetyTier: gap.suggestedSafetyTier,
    sourceTemplate,
    requiredDomains: gap.requiredDomains,
    scanResult,
    scanPassed: scanResult.passed,
    sandboxResult,
    testPassed,
    generationCostUsd,
  };

  // Store proposal in DB for the approval flow
  storeProposal(deps.db, proposal);

  shorebreakLogger.info(
    {
      proposalId,
      name: gap.suggestedWaveName,
      scanPassed: scanResult.passed,
      testPassed,
      template: sourceTemplate,
    },
    'Wave proposal generated',
  );

  return proposal;
}

/**
 * Generate wave code using a template.
 */
async function generateFromTemplate(
  template: ShorebreakTemplate,
  userMessage: string,
  gap: GapDetectionResult,
  deps: ShorebreakDeps,
  model: string,
): Promise<{ code: string; costUsd: number }> {
  const prompt = buildTemplateCompositionPrompt(
    template,
    userMessage,
    { domains: gap.requiredDomains },
  );

  const messages: Message[] = [{ role: 'user', content: prompt }];

  const response = await deps.provider.chat(messages, {
    model,
    maxTokens: 2048,
    temperature: 0.2,
  });

  const code = response.content
    .filter((block) => block.type === 'text' && block.text)
    .map((block) => block.text ?? '')
    .join('')
    .trim();

  const costUsd = calculateCost(
    model,
    response.usage.inputTokens,
    response.usage.outputTokens,
    response.usage.cacheReadTokens ?? 0,
  );

  return { code, costUsd };
}

/**
 * Generate wave code free-form (no template).
 */
async function generateFreeForm(
  gap: GapDetectionResult,
  userMessage: string,
  deps: ShorebreakDeps,
  model: string,
): Promise<{ code: string; costUsd: number }> {
  const prompt = buildFreeFormGenerationPrompt(
    userMessage,
    gap.suggestedWaveName,
    gap.suggestedDescription,
    gap.requiredDomains,
  );

  const messages: Message[] = [{ role: 'user', content: prompt }];

  const response = await deps.provider.chat(messages, {
    model,
    maxTokens: 2048,
    temperature: 0.2,
  });

  const code = response.content
    .filter((block) => block.type === 'text' && block.text)
    .map((block) => block.text ?? '')
    .join('')
    .trim();

  const costUsd = calculateCost(
    model,
    response.usage.inputTokens,
    response.usage.outputTokens,
    response.usage.cacheReadTokens ?? 0,
  );

  return { code, costUsd };
}

/**
 * Store a wave proposal in the generated_waves DB table.
 */
function storeProposal(db: BetterSqlite3.Database, proposal: WaveProposal): void {
  try {
    db.prepare(
      `INSERT INTO generated_waves (id, name, description, safety_tier, source_template,
       source_code, manifest, scan_result, scan_passed, user_approved, test_passed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    ).run(
      proposal.id,
      proposal.name,
      proposal.description,
      proposal.safetyTier,
      proposal.sourceTemplate,
      proposal.sourceCode,
      JSON.stringify(buildManifest(proposal)),
      JSON.stringify(proposal.scanResult),
      proposal.scanPassed ? 1 : 0,
      proposal.testPassed ? 1 : 0,
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    shorebreakLogger.error({ error: message, proposalId: proposal.id }, 'Failed to store proposal');
  }
}

/**
 * Build a wave manifest from a proposal.
 */
function buildManifest(proposal: WaveProposal): Record<string, unknown> {
  return {
    name: proposal.name,
    version: '1.0.0',
    description: proposal.description,
    author: 'shorebreak-generated',
    permissions: {
      domains: proposal.requiredDomains,
      shell: [],
      directories: [],
      requiresBrowser: false,
      requiresOAuth: [],
    },
    triggers: extractTriggers(proposal.name, proposal.description),
    deterministic: true,
    tools: [
      {
        name: 'execute',
        description: proposal.description,
        parameters: {},
      },
    ],
    minTier: 'basic',
    entryPoint: 'index.js',
    safetyTier: proposal.safetyTier,
  };
}

/**
 * Extract trigger keywords from a wave name and description.
 */
function extractTriggers(name: string, description: string): string[] {
  const words = `${name} ${description}`
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 3);

  // Deduplicate and take the top 5 most relevant words
  const stopWords = new Set(['this', 'that', 'with', 'from', 'into', 'using', 'will', 'does', 'have', 'been']);
  const unique = [...new Set(words)].filter((word) => !stopWords.has(word));
  return unique.slice(0, 5);
}

/**
 * Approve a wave proposal and register it for future use.
 *
 * Writes the wave files to ~/.lil-dude/waves/generated/{name}/
 * and marks the proposal as approved in the database.
 *
 * @param db - Database instance.
 * @param proposalId - The proposal ID to approve.
 * @returns True if approval succeeded, false otherwise.
 */
export function approveWaveProposal(
  db: BetterSqlite3.Database,
  proposalId: string,
): boolean {
  try {
    const row = db.prepare(
      'SELECT id, name, source_code, manifest, scan_passed, test_passed FROM generated_waves WHERE id = ?',
    ).get(proposalId) as {
      id: string;
      name: string;
      source_code: string;
      manifest: string;
      scan_passed: number;
      test_passed: number;
    } | undefined;

    if (!row) {
      shorebreakLogger.warn({ proposalId }, 'Proposal not found');
      return false;
    }

    if (!row.scan_passed) {
      shorebreakLogger.warn({ proposalId }, 'Cannot approve proposal that failed security scan');
      return false;
    }

    // Write wave files to disk
    const generatedDir = join(homeDir(), 'waves', 'generated', row.name);
    mkdirSync(generatedDir, { recursive: true });
    writeFileSync(join(generatedDir, 'wave.json'), row.manifest, 'utf-8');
    writeFileSync(join(generatedDir, 'index.js'), wrapAsModule(row.source_code), 'utf-8');

    // Mark as approved in DB
    db.prepare(
      'UPDATE generated_waves SET user_approved = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    ).run(proposalId);

    shorebreakLogger.info({ proposalId, name: row.name, dir: generatedDir }, 'Wave proposal approved and saved');
    return true;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    shorebreakLogger.error({ error: message, proposalId }, 'Failed to approve proposal');
    return false;
  }
}

/**
 * Reject a wave proposal.
 */
export function rejectWaveProposal(
  db: BetterSqlite3.Database,
  proposalId: string,
): boolean {
  try {
    const result = db.prepare(
      'DELETE FROM generated_waves WHERE id = ? AND user_approved = 0',
    ).run(proposalId);

    return result.changes > 0;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    shorebreakLogger.error({ error: message, proposalId }, 'Failed to reject proposal');
    return false;
  }
}

/**
 * Get all pending (unapproved) wave proposals.
 */
export function getPendingProposals(
  db: BetterSqlite3.Database,
): Array<{ id: string; name: string; description: string; safetyTier: string; scanPassed: boolean; testPassed: boolean; createdAt: string }> {
  try {
    const rows = db.prepare(
      `SELECT id, name, description, safety_tier, scan_passed, test_passed, created_at
       FROM generated_waves WHERE user_approved = 0
       ORDER BY created_at DESC`,
    ).all() as Array<{
      id: string;
      name: string;
      description: string;
      safety_tier: string;
      scan_passed: number;
      test_passed: number;
      created_at: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      safetyTier: row.safety_tier,
      scanPassed: row.scan_passed === 1,
      testPassed: row.test_passed === 1,
      createdAt: row.created_at,
    }));
  } catch {
    return [];
  }
}

/**
 * Wrap sandbox-style code (var execute = ...) as a CommonJS module export.
 */
function wrapAsModule(sourceCode: string): string {
  return [
    '// Generated by Shorebreak — do not edit manually',
    '// This wave was generated from a user request and approved by the user.',
    '',
    sourceCode,
    '',
    'module.exports = { plan: async () => ({ steps: [], estimatedCostUsd: 0, isDeterministic: true, extractedParams: {} }), execute: async (plan) => { const result = await execute(plan.extractedParams || {}); return { success: true, output: typeof result === "string" ? result : JSON.stringify(result) }; } };',
  ].join('\n');
}
