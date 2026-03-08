/**
 * Utilities for handling LLM thinking mode output.
 *
 * Many small/local models (qwen3.5, deepseek-r1 distills, etc.) wrap
 * internal reasoning in <think>...</think> tags. This consumes output
 * tokens before the model produces its actual answer.
 *
 * These utilities:
 * 1. Strip <think> blocks from model responses
 * 2. Provide anti-thinking prompt instructions
 * 3. Prepend /no_think directives recognized by qwen and deepseek models
 */

/**
 * Strip `<think>...</think>` blocks from model responses.
 * Handles multiline thinking blocks and returns the trimmed remainder.
 *
 * @param text - Raw text from a model response that may contain thinking blocks.
 * @returns The text with all thinking blocks removed and whitespace trimmed.
 */
export function stripThinkTags(text: string): string {
  // Strip complete <think>...</think> blocks
  let result = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  // Strip unclosed <think> blocks (model ran out of tokens mid-reasoning)
  result = result.replace(/<think>[\s\S]*$/g, '').trim();
  return result;
}

/**
 * Build anti-thinking instruction line for system prompts.
 * Append this to any system prompt where the model should output
 * structured data (JSON, scores, summaries) without reasoning.
 *
 * @returns A single instruction line to suppress thinking mode.
 */
export function antiThinkingInstruction(): string {
  return 'Do NOT use <think> tags or any reasoning. Output the answer immediately.';
}

/**
 * Prepend the `/no_think` directive to a user message.
 * This is a model-level signal recognized by qwen, deepseek, and other
 * models with thinking modes.
 *
 * @param userMessage - The original user message.
 * @returns The message prefixed with `/no_think\n`.
 */
export function prependNoThink(userMessage: string): string {
  return `/no_think\n${userMessage}`;
}
