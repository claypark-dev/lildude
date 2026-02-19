/**
 * Ollama local model provider adapter implementing the LLMProvider interface.
 * Uses raw fetch calls against the Ollama REST API — no SDK dependency.
 * All inference is local and zero-cost.
 * See HLD Section 3.3 for provider architecture.
 */

import { ProviderError } from '../errors.js';
import { countTokens } from '../cost/tokens.js';
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
  OllamaMessage,
  OllamaTool,
  OllamaChatRequest,
  OllamaChatResponse,
  OllamaStreamChunk,
  OllamaErrorResponse,
  OllamaToolCall,
} from './ollama-types.js';

const PROVIDER_NAME = 'ollama';
const DEFAULT_BASE_URL = 'http://localhost:11434';

/** Configuration for constructing the Ollama provider */
export interface OllamaProviderConfig {
  baseUrl?: string;
  model?: string;
}

/** Map from Ollama done_reason to our stopReason */
const STOP_REASON_MAP: Record<string, ChatResponse['stopReason']> = {
  stop: 'end_turn',
  length: 'max_tokens',
  load: 'end_turn',
};

/**
 * Convert our Message[] to Ollama's message format.
 * Handles string content, content blocks, tool_use blocks, and tool_result blocks.
 * @param messages - Array of Lil Dude messages
 * @param systemPrompt - Optional system prompt to prepend
 * @returns Array of OllamaMessage objects
 */
function toOllamaMessages(
  messages: Message[],
  systemPrompt?: string,
): OllamaMessage[] {
  const ollamaMessages: OllamaMessage[] = [];

  if (systemPrompt) {
    ollamaMessages.push({ role: 'system', content: systemPrompt });
  }

  for (const message of messages) {
    if (message.role === 'system') {
      ollamaMessages.push({
        role: 'system',
        content: typeof message.content === 'string'
          ? message.content
          : extractTextFromBlocks(message.content),
      });
      continue;
    }

    if (typeof message.content === 'string') {
      ollamaMessages.push({
        role: message.role as 'user' | 'assistant',
        content: message.content,
      });
      continue;
    }

    // Handle content blocks for assistant messages with tool calls
    if (message.role === 'assistant') {
      const textParts: string[] = [];
      const toolCalls: OllamaToolCall[] = [];

      for (const block of message.content) {
        if (block.type === 'text' && block.text) {
          textParts.push(block.text);
        } else if (block.type === 'tool_use' && block.name) {
          toolCalls.push({
            function: {
              name: block.name,
              arguments: block.input ?? {},
            },
          });
        }
      }

      const assistantMsg: OllamaMessage = {
        role: 'assistant',
        content: textParts.join('\n'),
      };

      if (toolCalls.length > 0) {
        assistantMsg.tool_calls = toolCalls;
      }

      ollamaMessages.push(assistantMsg);
      continue;
    }

    // Handle user messages — tool_result blocks become tool role messages
    if (message.role === 'user') {
      const textParts: string[] = [];

      for (const block of message.content) {
        if (block.type === 'tool_result') {
          ollamaMessages.push({
            role: 'tool',
            content: block.content ?? '',
          });
        } else if (block.type === 'text' && block.text) {
          textParts.push(block.text);
        }
      }

      if (textParts.length > 0) {
        ollamaMessages.push({
          role: 'user',
          content: textParts.join('\n'),
        });
      }
    }
  }

  return ollamaMessages;
}

/**
 * Extract plain text from an array of content blocks.
 * @param blocks - Array of content blocks
 * @returns Concatenated text from text blocks
 */
function extractTextFromBlocks(blocks: ContentBlock[]): string {
  return blocks
    .filter((block): block is ContentBlock & { text: string } =>
      block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n');
}

/**
 * Convert our ToolDefinition[] to Ollama's OpenAI-compatible tool format.
 * @param tools - Array of Lil Dude tool definitions
 * @returns Array of OllamaTool objects
 */
function toOllamaTools(tools: ToolDefinition[]): OllamaTool[] {
  return tools.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: tool.parameters.type,
        properties: tool.parameters.properties,
        required: tool.parameters.required,
      },
    },
  }));
}

/**
 * Map an Ollama done_reason string to our normalized stopReason.
 * @param doneReason - Ollama's done reason
 * @returns Normalized stop reason
 */
function mapStopReason(
  doneReason: string | undefined,
): ChatResponse['stopReason'] {
  if (!doneReason) {
    return 'end_turn';
  }
  return STOP_REASON_MAP[doneReason] ?? 'end_turn';
}

/**
 * Parse an Ollama response message into our ContentBlock array.
 * Handles text content and tool_calls.
 * @param message - The Ollama response message
 * @returns Array of content blocks
 */
function parseResponseMessage(message: OllamaMessage): ContentBlock[] {
  const blocks: ContentBlock[] = [];

  if (message.content && message.content.length > 0) {
    blocks.push({ type: 'text', text: message.content });
  }

  if (message.tool_calls) {
    for (const toolCall of message.tool_calls) {
      blocks.push({
        type: 'tool_use',
        id: `call_${toolCall.function.name}_${Date.now()}`,
        name: toolCall.function.name,
        input: toolCall.function.arguments,
      });
    }
  }

  return blocks;
}

/**
 * Determine if an error is a connection refused / network error.
 * @param error - The caught error
 * @returns True if the error indicates connection failure
 */
function isConnectionError(error: unknown): boolean {
  if (error instanceof TypeError) {
    const msg = error.message.toLowerCase();
    return msg.includes('fetch') || msg.includes('network') || msg.includes('econnrefused');
  }
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return msg.includes('econnrefused') || msg.includes('connect');
  }
  return false;
}

/**
 * Wrap HTTP or Ollama API errors into a ProviderError.
 * @param statusCode - HTTP status code (or 0 for network errors)
 * @param message - Error message
 * @returns A ProviderError instance
 */
function wrapHttpError(statusCode: number, message: string): ProviderError {
  if (statusCode === 404) {
    return new ProviderError(
      `Model not found on ${PROVIDER_NAME}: ${message}`,
      PROVIDER_NAME,
      false,
    );
  }

  if (statusCode >= 500) {
    return new ProviderError(
      `${PROVIDER_NAME} server error (${statusCode}): ${message}`,
      PROVIDER_NAME,
      true,
    );
  }

  if (statusCode === 0) {
    return new ProviderError(
      `Connection refused — is Ollama running? ${message}`,
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
 * Build the request body for an Ollama /api/chat call.
 * @param messages - Conversation messages
 * @param options - Chat options including model, maxTokens, tools, etc.
 * @param stream - Whether to enable streaming
 * @returns The OllamaChatRequest body
 */
function buildRequestBody(
  messages: Message[],
  options: ChatOptions,
  stream: boolean,
): OllamaChatRequest {
  const ollamaMessages = toOllamaMessages(messages, options.systemPrompt);

  const body: OllamaChatRequest = {
    model: options.model.replace(/^ollama\//, ''),
    messages: ollamaMessages,
    stream,
  };

  if (options.tools && options.tools.length > 0) {
    body.tools = toOllamaTools(options.tools);
  }

  const ollamaOptions: OllamaChatRequest['options'] = {};
  let hasOptions = false;

  if (options.maxTokens) {
    ollamaOptions.num_predict = options.maxTokens;
    hasOptions = true;
  }

  if (options.temperature !== undefined) {
    ollamaOptions.temperature = options.temperature;
    hasOptions = true;
  }

  if (options.stopSequences && options.stopSequences.length > 0) {
    ollamaOptions.stop = options.stopSequences;
    hasOptions = true;
  }

  if (hasOptions) {
    body.options = ollamaOptions;
  }

  return body;
}

/**
 * Ollama local LLM provider implementation.
 * Calls the Ollama REST API via fetch for chat and streaming completions.
 * All inference runs locally at zero cost.
 */
export class OllamaProvider implements LLMProvider {
  readonly name = PROVIDER_NAME;
  private readonly baseUrl: string;

  /**
   * Create a new OllamaProvider.
   * @param config - Optional base URL and default model override
   */
  constructor(config?: OllamaProviderConfig) {
    this.baseUrl = config?.baseUrl ?? DEFAULT_BASE_URL;

    providerLogger.info(
      { provider: this.name, baseUrl: this.baseUrl },
      'Ollama provider initialized',
    );
  }

  /**
   * Send a non-streaming chat request to the Ollama API.
   * @param messages - Conversation messages
   * @param options - Chat options including model, maxTokens, tools, etc.
   * @returns Normalized ChatResponse with content blocks and usage info
   */
  async chat(messages: Message[], options: ChatOptions): Promise<ChatResponse> {
    try {
      const body = buildRequestBody(messages, options, false);
      const url = `${this.baseUrl}/api/chat`;

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({})) as OllamaErrorResponse;
        const errorMessage = errorBody.error ?? response.statusText;
        throw wrapHttpError(response.status, errorMessage);
      }

      const responseData = await response.json() as OllamaChatResponse;
      const contentBlocks = parseResponseMessage(responseData.message);

      const usage = {
        inputTokens: responseData.prompt_eval_count ?? 0,
        outputTokens: responseData.eval_count ?? 0,
      };

      const stopReason = mapStopReason(responseData.done_reason);
      const hasToolUse = contentBlocks.some((block) => block.type === 'tool_use');

      providerLogger.info(
        {
          model: options.model,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          costUsd: 0,
          stopReason: responseData.done_reason,
        },
        'Ollama chat completed (local, zero cost)',
      );

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
      if (isConnectionError(error)) {
        throw wrapHttpError(0, error instanceof Error ? error.message : String(error));
      }
      throw new ProviderError(
        `${PROVIDER_NAME} unexpected error: ${error instanceof Error ? error.message : String(error)}`,
        PROVIDER_NAME,
        false,
      );
    }
  }

  /**
   * Send a streaming chat request to the Ollama API via NDJSON.
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
      const body = buildRequestBody(messages, options, true);
      const url = `${this.baseUrl}/api/chat`;

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({})) as OllamaErrorResponse;
        const errorMessage = errorBody.error ?? response.statusText;
        throw wrapHttpError(response.status, errorMessage);
      }

      if (!response.body) {
        throw new ProviderError(
          `${PROVIDER_NAME} returned no response body for stream`,
          PROVIDER_NAME,
          false,
        );
      }

      yield* this.processNDJSONStream(response.body);
    } catch (error: unknown) {
      if (error instanceof ProviderError) {
        throw error;
      }
      if (isConnectionError(error)) {
        throw wrapHttpError(0, error instanceof Error ? error.message : String(error));
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
   * Process an NDJSON stream body, parsing each line as an OllamaStreamChunk.
   * @param body - The ReadableStream body from the fetch response
   * @yields StreamChunk objects
   */
  private async *processNDJSONStream(
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
          if (trimmed.length === 0) {
            continue;
          }

          let chunk: OllamaStreamChunk;
          try {
            chunk = JSON.parse(trimmed) as OllamaStreamChunk;
          } catch {
            continue;
          }

          // Emit text content deltas
          if (chunk.message.content && chunk.message.content.length > 0) {
            yield { type: 'text_delta', text: chunk.message.content };
          }

          // Emit tool calls if present
          if (chunk.message.tool_calls) {
            for (const toolCall of chunk.message.tool_calls) {
              yield {
                type: 'tool_use_start',
                toolName: toolCall.function.name,
              };
              yield {
                type: 'tool_input_delta',
                toolInput: JSON.stringify(toolCall.function.arguments),
              };
            }
          }

          // Emit message stop when done
          if (chunk.done) {
            yield { type: 'message_stop' };
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
