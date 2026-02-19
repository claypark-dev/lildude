/**
 * Helper functions for the skill execution engine.
 * Extracted to keep executor.ts under 300 lines.
 * Contains LLM parameter extraction, parsing, validation, and budget checking.
 */

import { z } from 'zod';
import type {
  Skill,
  ToolResult,
  LLMProvider,
  ChatResponse,
  Message,
} from '../types/index.js';
import { canAfford } from '../cost/budget.js';
import { createModuleLogger } from '../utils/logger.js';
import { BudgetExceededError } from '../errors.js';
import type { SkillExecutionResult, SkillExecutorDeps } from './executor.js';

const helpersLogger = createModuleLogger('skill-executor-helpers');

/** Zod schema for validating the LLM parameter extraction response. */
const ExtractedParamsSchema = z.record(z.unknown());

/**
 * Call the LLM to extract parameters from a user message for a given skill.
 * Uses a tightly-constrained system prompt to get JSON-only output.
 *
 * @param provider - The LLM provider instance.
 * @param model - The model identifier to use.
 * @param skill - The skill whose parameters to extract.
 * @param userMessage - The raw user message.
 * @returns The ChatResponse from the LLM.
 */
export async function callLLMForParamExtraction(
  provider: LLMProvider,
  model: string,
  skill: Skill,
  userMessage: string,
): Promise<ChatResponse> {
  const toolParamDescriptions = skill.manifest.tools
    .map((tool) => `  - ${tool.name}: ${tool.description} (params: ${JSON.stringify(tool.parameters)})`)
    .join('\n');

  const systemPrompt = [
    `You are a parameter extraction engine for the "${skill.manifest.name}" skill.`,
    `Skill description: ${skill.manifest.description}`,
    `Available tools:\n${toolParamDescriptions || '  (no tools defined)'}`,
    '',
    'Extract the parameters from the user message for this skill.',
    'Return ONLY a valid JSON object with the extracted parameters.',
    'Do NOT include any explanation, markdown, or text outside the JSON.',
    'If no parameters can be extracted, return an empty JSON object: {}',
  ].join('\n');

  const messages: Message[] = [
    { role: 'user', content: userMessage },
  ];

  return provider.chat(messages, {
    model,
    maxTokens: 512,
    temperature: 0,
    systemPrompt,
  });
}

/**
 * Parse extracted parameters from an LLM ChatResponse.
 * Attempts to find and parse JSON from the response text.
 * Falls back to an empty object if parsing fails.
 *
 * @param response - The ChatResponse from parameter extraction.
 * @returns A record of extracted parameters.
 */
export function parseExtractedParams(response: ChatResponse): Record<string, unknown> {
  const responseText = response.content
    .filter((block) => block.type === 'text' && block.text)
    .map((block) => block.text ?? '')
    .join('');

  const trimmed = responseText.trim();

  try {
    const parsed: unknown = JSON.parse(trimmed);
    const validated = ExtractedParamsSchema.safeParse(parsed);

    if (validated.success) {
      return validated.data;
    }

    helpersLogger.warn(
      { validationErrors: validated.error.issues },
      'Extracted params failed Zod validation, using empty params',
    );
    return {};
  } catch {
    // Try to extract JSON from within the response (e.g., wrapped in markdown)
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed: unknown = JSON.parse(jsonMatch[0]);
        const validated = ExtractedParamsSchema.safeParse(parsed);
        if (validated.success) {
          return validated.data;
        }
      } catch {
        // Fall through to empty params
      }
    }

    helpersLogger.warn(
      { responseText: trimmed.slice(0, 200) },
      'Failed to parse extracted params from LLM response, using empty params',
    );
    return {};
  }
}

/**
 * Run the skill's optional validate() method if it exists.
 * Returns a success result if no validator is defined.
 *
 * @param skill - The skill that may have a validate method.
 * @param result - The ToolResult to validate.
 * @returns A validation result with valid flag and optional feedback.
 */
export async function runValidationIfPresent(
  skill: Skill,
  result: ToolResult,
): Promise<{ valid: boolean; feedback?: string }> {
  if (!skill.validate) {
    return { valid: true };
  }

  try {
    return await skill.validate(result);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    helpersLogger.warn(
      { skillName: skill.manifest.name, error: errorMessage },
      'Skill validation threw an error, treating as valid',
    );
    return { valid: true };
  }
}

/**
 * Assert that the current task can afford an estimated cost.
 * Throws BudgetExceededError if the budget would be exceeded.
 *
 * @param deps - The executor dependencies containing budget info.
 * @param estimatedCost - The estimated cost of the next operation.
 * @throws {BudgetExceededError} If the budget would be exceeded.
 */
export function assertCanAfford(deps: SkillExecutorDeps, estimatedCost: number): void {
  if (!canAfford(deps.taskSpentUsd, deps.taskBudgetUsd, estimatedCost)) {
    throw new BudgetExceededError(
      `Task budget of $${deps.taskBudgetUsd} would be exceeded ` +
      `(spent: $${deps.taskSpentUsd}, estimated: $${estimatedCost})`,
    );
  }
}

/**
 * Build a failure SkillExecutionResult with zero cost and tokens.
 *
 * @param errorMessage - The error message to include in the output.
 * @param wasDeterministic - Whether the skill was deterministic.
 * @returns A failed SkillExecutionResult.
 */
export function buildFailureResult(
  errorMessage: string,
  wasDeterministic: boolean,
): SkillExecutionResult {
  return {
    success: false,
    output: errorMessage,
    tokensUsed: { input: 0, output: 0 },
    costUsd: 0,
    llmCallCount: 0,
    wasDeterministic,
  };
}
