/**
 * Token counting utilities using tiktoken.
 * Provides accurate token counts for cost estimation and context management.
 * Falls back to character-based estimation if tiktoken is unavailable.
 * See HLD Section 6 for cost control architecture.
 */

import { createRequire } from 'node:module';
import type { Tiktoken } from 'tiktoken';
import type { Message, ContentBlock } from '../types/index.js';
import { costLogger } from '../utils/logger.js';

/** Overhead tokens added per message in the chat format */
const PER_MESSAGE_OVERHEAD = 4;

/** Tokens added at the end for reply priming */
const REPLY_PRIMING_TOKENS = 2;

/** Rough character-to-token ratio used when tiktoken is unavailable */
const CHARS_PER_TOKEN_FALLBACK = 4;

let encoder: Tiktoken | undefined;
let useFallback = false;

/**
 * Initialize the tiktoken encoder lazily.
 * Falls back to character-based estimation if tiktoken fails to load.
 */
function getEncoder(): Tiktoken | undefined {
  if (useFallback) {
    return undefined;
  }

  if (encoder) {
    return encoder;
  }

  try {
    // Use createRequire for synchronous loading in ESM context.
    // tiktoken's get_encoding is synchronous but the WASM module
    // may fail to load in some environments (e.g., edge runtimes).
    const esmRequire = createRequire(import.meta.url);
    const tiktoken = esmRequire('tiktoken') as typeof import('tiktoken');
    encoder = tiktoken.get_encoding('cl100k_base');
    return encoder;
  } catch (initError: unknown) {
    const errorMessage = initError instanceof Error ? initError.message : String(initError);
    costLogger.warn(
      { error: errorMessage },
      'tiktoken failed to initialize, falling back to character-based token estimation',
    );
    useFallback = true;
    return undefined;
  }
}

/**
 * Count tokens in a text string using cl100k_base encoding.
 * Falls back to chars/4 estimation if tiktoken is unavailable.
 * @param text - The text to count tokens for
 * @returns The number of tokens in the text
 */
export function countTokens(text: string): number {
  if (text.length === 0) {
    return 0;
  }

  const enc = getEncoder();
  if (enc) {
    const tokens = enc.encode(text);
    return tokens.length;
  }

  // Fallback: rough approximation of ~4 characters per token
  return Math.ceil(text.length / CHARS_PER_TOKEN_FALLBACK);
}

/**
 * Count tokens for a single ContentBlock.
 * Text blocks use their text content; tool-use blocks stringify the input.
 * @param block - The content block to count tokens for
 * @returns The number of tokens in the block
 */
function countContentBlockTokens(block: ContentBlock): number {
  if (block.type === 'text' && block.text) {
    return countTokens(block.text);
  }

  if (block.type === 'tool_use' && block.input) {
    return countTokens(JSON.stringify(block.input));
  }

  if (block.type === 'tool_result' && block.content) {
    return countTokens(block.content);
  }

  return 0;
}

/**
 * Estimate total tokens for an array of messages.
 * Adds per-message overhead (4 tokens) and reply priming (2 tokens).
 * @param messages - The array of messages to estimate tokens for
 * @returns Total estimated token count including overhead
 */
export function estimateMessageTokens(messages: Message[]): number {
  let totalTokens = 0;

  for (const message of messages) {
    // Per-message overhead for role and formatting
    totalTokens += PER_MESSAGE_OVERHEAD;

    if (typeof message.content === 'string') {
      totalTokens += countTokens(message.content);
    } else {
      // ContentBlock[] content
      for (const block of message.content) {
        totalTokens += countContentBlockTokens(block);
      }
    }
  }

  // Reply priming tokens at the end
  totalTokens += REPLY_PRIMING_TOKENS;

  return totalTokens;
}
