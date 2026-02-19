/**
 * Google Gemini provider adapter implementing the LLMProvider interface.
 * Uses raw fetch calls against the Gemini REST API — no SDK dependency.
 * See HLD Section 3.3 for provider architecture.
 */

import { ProviderError } from '../errors.js';
import { countTokens } from '../cost/tokens.js';
import { calculateCost } from '../cost/pricing.js';
import { providerLogger } from '../utils/logger.js';
import type {
  LLMProvider,
  Message,
  ChatOptions,
  ChatResponse,
  StreamChunk,
  ContentBlock,
  ToolDefinition,
} from '../types/index.js';
import type {
  GeminiContent,
  GeminiPart,
  GeminiFunctionDeclaration,
  GeminiTool,
  GeminiGenerateContentRequest,
  GeminiGenerateContentResponse,
  GeminiErrorResponse,
  GeminiStreamChunk,
} from './gemini-types.js';

const PROVIDER_NAME = 'gemini';
const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

/** Configuration for constructing the Gemini provider */
export interface GeminiProviderConfig {
  apiKey: string;
  baseUrl?: string;
}

/** Map from Gemini finishReason to our stopReason */
const STOP_REASON_MAP: Record<string, ChatResponse['stopReason']> = {
  STOP: 'end_turn',
  MAX_TOKENS: 'max_tokens',
  SAFETY: 'end_turn',
  RECITATION: 'end_turn',
  OTHER: 'end_turn',
};

/**
 * Convert our Message[] to Gemini's contents[] format.
 * Filters out system messages (handled via systemInstruction).
 * @param messages - Array of Lil Dude messages
 * @returns Array of GeminiContent objects
 */
function toGeminiContents(messages: Message[]): GeminiContent[] {
  const contents: GeminiContent[] = [];

  for (const message of messages) {
    if (message.role === 'system') {
      continue;
    }

    const role = message.role === 'assistant' ? 'model' : 'user';
    const parts: GeminiPart[] = [];

    if (typeof message.content === 'string') {
      parts.push({ text: message.content });
    } else {
      for (const block of message.content) {
        if (block.type === 'text' && block.text) {
          parts.push({ text: block.text });
        } else if (block.type === 'tool_use' && block.name) {
          parts.push({
            functionCall: {
              name: block.name,
              args: block.input ?? {},
            },
          });
        } else if (block.type === 'tool_result' && block.toolUseId) {
          parts.push({
            functionResponse: {
              name: block.toolUseId,
              response: { result: block.content ?? '' },
            },
          });
        }
      }
    }

    if (parts.length > 0) {
      contents.push({ role, parts });
    }
  }

  return contents;
}

/**
 * Convert our ToolDefinition[] to Gemini's tools format.
 * @param tools - Array of Lil Dude tool definitions
 * @returns Array of GeminiTool objects with functionDeclarations
 */
function toGeminiTools(tools: ToolDefinition[]): GeminiTool[] {
  const declarations: GeminiFunctionDeclaration[] = tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: {
      type: tool.parameters.type,
      properties: tool.parameters.properties,
      required: tool.parameters.required,
    },
  }));

  return [{ functionDeclarations: declarations }];
}

/**
 * Map a Gemini finishReason string to our normalized stopReason.
 * @param finishReason - Gemini's finish reason
 * @returns Normalized stop reason
 */
function mapStopReason(finishReason: string | undefined): ChatResponse['stopReason'] {
  if (!finishReason) {
    return 'end_turn';
  }
  return STOP_REASON_MAP[finishReason] ?? 'end_turn';
}

/**
 * Parse Gemini response parts into our ContentBlock array.
 * @param parts - Array of Gemini parts from the response
 * @returns Array of normalized ContentBlock objects
 */
function parseResponseParts(parts: GeminiPart[]): ContentBlock[] {
  const blocks: ContentBlock[] = [];

  for (const part of parts) {
    if (part.text) {
      blocks.push({ type: 'text', text: part.text });
    }

    if (part.functionCall) {
      blocks.push({
        type: 'tool_use',
        id: `call_${part.functionCall.name}_${Date.now()}`,
        name: part.functionCall.name,
        input: part.functionCall.args,
      });
    }
  }

  return blocks;
}

/**
 * Wrap HTTP or Gemini API errors into a ProviderError.
 * @param statusCode - HTTP status code (or 0 for network errors)
 * @param message - Error message
 * @returns A ProviderError instance
 */
function wrapHttpError(statusCode: number, message: string): ProviderError {
  if (statusCode === 429) {
    return new ProviderError(
      `Rate limited by ${PROVIDER_NAME}: ${message}`,
      PROVIDER_NAME,
      true,
    );
  }

  if (statusCode === 401 || statusCode === 403) {
    return new ProviderError(
      `Authentication failed for ${PROVIDER_NAME}: ${message}`,
      PROVIDER_NAME,
      false,
    );
  }

  if (statusCode >= 500) {
    return new ProviderError(
      `${PROVIDER_NAME} API error (${statusCode}): ${message}`,
      PROVIDER_NAME,
      true,
    );
  }

  if (statusCode === 0) {
    return new ProviderError(
      `Network error connecting to ${PROVIDER_NAME}: ${message}`,
      PROVIDER_NAME,
      true,
    );
  }

  return new ProviderError(
    `${PROVIDER_NAME} API error (${statusCode}): ${message}`,
    PROVIDER_NAME,
    false,
  );
}

/**
 * Build the request body for a Gemini generateContent call.
 * @param messages - Conversation messages
 * @param options - Chat options including model, maxTokens, tools, etc.
 * @returns The request body object
 */
function buildRequestBody(
  messages: Message[],
  options: ChatOptions,
): GeminiGenerateContentRequest {
  const contents = toGeminiContents(messages);

  const body: GeminiGenerateContentRequest = { contents };

  if (options.systemPrompt) {
    body.systemInstruction = {
      role: 'user',
      parts: [{ text: options.systemPrompt }],
    };
  }

  if (options.tools && options.tools.length > 0) {
    body.tools = toGeminiTools(options.tools);
  }

  const generationConfig: GeminiGenerateContentRequest['generationConfig'] = {};
  generationConfig.maxOutputTokens = options.maxTokens;

  if (options.temperature !== undefined) {
    generationConfig.temperature = options.temperature;
  }

  if (options.stopSequences && options.stopSequences.length > 0) {
    generationConfig.stopSequences = options.stopSequences;
  }

  body.generationConfig = generationConfig;

  return body;
}

/**
 * Google Gemini LLM provider implementation.
 * Calls the Gemini REST API via fetch for chat and streaming completions.
 */
export class GeminiProvider implements LLMProvider {
  readonly name = PROVIDER_NAME;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  /**
   * Create a new GeminiProvider.
   * @param config - API key and optional base URL override
   */
  constructor(config: GeminiProviderConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? BASE_URL;

    providerLogger.info(
      { provider: this.name },
      'Gemini provider initialized',
    );
  }

  /**
   * Send a non-streaming chat request to the Gemini API.
   * @param messages - Conversation messages
   * @param options - Chat options including model, maxTokens, tools, etc.
   * @returns Normalized ChatResponse with content blocks and usage info
   */
  async chat(messages: Message[], options: ChatOptions): Promise<ChatResponse> {
    try {
      const body = buildRequestBody(messages, options);
      const url = `${this.baseUrl}/models/${options.model}:generateContent?key=${this.apiKey}`;

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({})) as GeminiErrorResponse;
        const errorMessage = errorBody.error?.message ?? response.statusText;
        throw wrapHttpError(response.status, errorMessage);
      }

      const responseData = await response.json() as GeminiGenerateContentResponse;
      const candidate = responseData.candidates?.[0];

      if (!candidate) {
        throw new ProviderError(
          `${PROVIDER_NAME} returned no candidates`,
          PROVIDER_NAME,
          false,
        );
      }

      const contentBlocks = parseResponseParts(candidate.content.parts);
      const usageMetadata = responseData.usageMetadata;

      const usage = {
        inputTokens: usageMetadata?.promptTokenCount ?? 0,
        outputTokens: usageMetadata?.candidatesTokenCount ?? 0,
        cacheReadTokens: usageMetadata?.cachedContentTokenCount ?? undefined,
      };

      const costUsd = calculateCost(
        options.model,
        usage.inputTokens,
        usage.outputTokens,
        usage.cacheReadTokens ?? 0,
      );

      providerLogger.info(
        {
          model: options.model,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          costUsd,
          stopReason: candidate.finishReason,
        },
        'Gemini chat completed',
      );

      const stopReason = mapStopReason(candidate.finishReason);
      const hasToolUse = contentBlocks.some((block) => block.type === 'tool_use');

      return {
        content: contentBlocks,
        model: options.model,
        usage,
        stopReason: hasToolUse ? 'tool_use' : stopReason,
      };
    } catch (error: unknown) {
      if (error instanceof ProviderError) {
        throw error;
      }
      if (error instanceof TypeError && (error.message.includes('fetch') || error.message.includes('network'))) {
        throw wrapHttpError(0, error.message);
      }
      throw new ProviderError(
        `${PROVIDER_NAME} unexpected error: ${error instanceof Error ? error.message : String(error)}`,
        PROVIDER_NAME,
        false,
      );
    }
  }

  /**
   * Send a streaming chat request to the Gemini API via SSE.
   * Yields StreamChunk objects as the response arrives.
   * @param messages - Conversation messages
   * @param options - Chat options including model, maxTokens, tools, etc.
   * @yields StreamChunk objects for text deltas, tool use events, and message stop
   */
  async *chatStream(
    messages: Message[],
    options: ChatOptions,
  ): AsyncGenerator<StreamChunk> {
    try {
      const body = buildRequestBody(messages, options);
      const url = `${this.baseUrl}/models/${options.model}:streamGenerateContent?alt=sse&key=${this.apiKey}`;

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({})) as GeminiErrorResponse;
        const errorMessage = errorBody.error?.message ?? response.statusText;
        throw wrapHttpError(response.status, errorMessage);
      }

      if (!response.body) {
        throw new ProviderError(
          `${PROVIDER_NAME} returned no response body for stream`,
          PROVIDER_NAME,
          false,
        );
      }

      yield* this.processSSEStream(response.body);
    } catch (error: unknown) {
      if (error instanceof ProviderError) {
        throw error;
      }
      if (error instanceof TypeError && (error.message.includes('fetch') || error.message.includes('network'))) {
        throw wrapHttpError(0, error.message);
      }
      throw new ProviderError(
        `${PROVIDER_NAME} unexpected error: ${error instanceof Error ? error.message : String(error)}`,
        PROVIDER_NAME,
        false,
      );
    }
  }

  /**
   * Count the number of tokens in a text string.
   * Delegates to the shared tiktoken-based counter.
   * @param text - The text to count tokens for
   * @returns The number of tokens
   */
  countTokens(text: string): number {
    return countTokens(text);
  }

  /**
   * Process an SSE stream body, parsing each data line as a GeminiStreamChunk.
   * @param body - The ReadableStream body from the fetch response
   * @yields StreamChunk objects
   */
  private async *processSSEStream(
    body: ReadableStream<Uint8Array>,
  ): AsyncGenerator<StreamChunk> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();

          if (!trimmed.startsWith('data: ')) {
            continue;
          }

          const jsonStr = trimmed.slice(6);
          if (jsonStr === '[DONE]') {
            yield { type: 'message_stop' };
            return;
          }

          let chunk: GeminiStreamChunk;
          try {
            chunk = JSON.parse(jsonStr) as GeminiStreamChunk;
          } catch {
            continue;
          }

          const candidate = chunk.candidates?.[0];
          if (!candidate?.content?.parts) {
            if (candidate?.finishReason) {
              yield { type: 'message_stop' };
            }
            continue;
          }

          for (const part of candidate.content.parts) {
            if (part.text) {
              yield { type: 'text_delta', text: part.text };
            }

            if (part.functionCall) {
              yield {
                type: 'tool_use_start',
                toolName: part.functionCall.name,
              };
              yield {
                type: 'tool_input_delta',
                toolInput: JSON.stringify(part.functionCall.args),
              };
            }
          }

          if (candidate.finishReason) {
            yield { type: 'message_stop' };
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
