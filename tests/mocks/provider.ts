/**
 * Mock LLM provider for use in unit tests.
 * Implements the LLMProvider interface with programmable responses
 * and call history tracking.
 */

import type {
  LLMProvider,
  Message,
  ChatOptions,
  ChatResponse,
  StreamChunk,
} from '../../src/types/index.js';

/** A programmed response rule: match when any message content contains the trigger string. */
interface ResponseRule {
  inputContains: string;
  response: ChatResponse;
}

/** Call record captured by the mock provider. */
export interface MockProviderCall {
  messages: Message[];
  options: ChatOptions;
}

/** Extended LLMProvider with test helpers for programming responses and inspecting calls. */
export interface MockProvider extends LLMProvider {
  /** Pre-program a response: when input contains `inputContains`, return `response`. */
  when(inputContains: string, response: ChatResponse): void;
  /** Set a default response for unmatched inputs. */
  setDefault(response: ChatResponse): void;
  /** Get call history. */
  getCalls(): MockProviderCall[];
  /** Reset all programmed responses and call history. */
  reset(): void;
}

/**
 * Build a simple fallback ChatResponse with the given text.
 * @param text - The text content of the response
 * @returns A minimal ChatResponse
 */
function buildFallbackResponse(text: string): ChatResponse {
  return {
    content: [{ type: 'text', text }],
    model: 'mock-model',
    usage: { inputTokens: 0, outputTokens: 0 },
    stopReason: 'end_turn',
  };
}

/**
 * Extract all text from a Message array for matching purposes.
 * @param messages - The messages to extract text from
 * @returns Concatenated text from all messages
 */
function extractAllText(messages: Message[]): string {
  const parts: string[] = [];
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      parts.push(msg.content);
    } else {
      for (const block of msg.content) {
        if (block.text) {
          parts.push(block.text);
        }
        if (block.content) {
          parts.push(block.content);
        }
      }
    }
  }
  return parts.join(' ');
}

/**
 * Find the first matching response rule for a set of messages.
 * @param messages - The messages to match against
 * @param rules - The programmed response rules
 * @returns The matched ChatResponse, or undefined if no match
 */
function findMatchingResponse(
  messages: Message[],
  rules: ResponseRule[],
): ChatResponse | undefined {
  const combinedText = extractAllText(messages);
  for (const rule of rules) {
    if (combinedText.includes(rule.inputContains)) {
      return rule.response;
    }
  }
  return undefined;
}

/**
 * Create a MockProvider for testing.
 * Supports programmable responses via `when()`, a default fallback via `setDefault()`,
 * and call history inspection via `getCalls()`.
 *
 * @param name - Provider name (defaults to 'mock')
 * @returns A MockProvider instance
 */
export function createMockProvider(name: string = 'mock'): MockProvider {
  const rules: ResponseRule[] = [];
  const calls: MockProviderCall[] = [];
  let defaultResponse: ChatResponse | undefined;

  return {
    name,

    when(inputContains: string, response: ChatResponse): void {
      rules.push({ inputContains, response });
    },

    setDefault(response: ChatResponse): void {
      defaultResponse = response;
    },

    getCalls(): MockProviderCall[] {
      return [...calls];
    },

    reset(): void {
      rules.length = 0;
      calls.length = 0;
      defaultResponse = undefined;
    },

    async chat(messages: Message[], options: ChatOptions): Promise<ChatResponse> {
      calls.push({ messages, options });

      const matched = findMatchingResponse(messages, rules);
      if (matched) {
        return matched;
      }

      if (defaultResponse) {
        return defaultResponse;
      }

      return buildFallbackResponse('Mock response');
    },

    async *chatStream(
      messages: Message[],
      options: ChatOptions,
    ): AsyncGenerator<StreamChunk> {
      calls.push({ messages, options });

      const matched = findMatchingResponse(messages, rules);
      const response = matched ?? defaultResponse ?? buildFallbackResponse('Mock response');

      for (const block of response.content) {
        if (block.type === 'text' && block.text) {
          // Yield text in small chunks to simulate streaming
          const words = block.text.split(' ');
          for (const word of words) {
            yield { type: 'text_delta', text: word + ' ' };
          }
        }
      }

      yield { type: 'message_stop' };
    },

    countTokens(text: string): number {
      return Math.ceil(text.length / 4);
    },
  };
}
