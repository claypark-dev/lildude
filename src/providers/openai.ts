/**
 * OpenAI provider adapter implementing the LLMProvider interface.
 * Supports OpenAI-compatible APIs including DeepSeek via custom baseURL.
 * See HLD Section 3.3 for provider architecture.
 */

import OpenAI from 'openai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionChunk,
} from 'openai/resources/chat/completions';
import { APIError, APIConnectionError, RateLimitError, AuthenticationError } from 'openai/error';
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

/** Configuration for the OpenAI provider adapter */
interface OpenAIProviderConfig {
  apiKey: string;
  baseUrl?: string;
  providerName?: string;
  maxRetries?: number;
}

/** Map from OpenAI finish_reason to our stopReason */
const STOP_REASON_MAP: Record<string, ChatResponse['stopReason']> = {
  stop: 'end_turn',
  tool_calls: 'tool_use',
  length: 'max_tokens',
  content_filter: 'end_turn',
  function_call: 'tool_use',
};

/**
 * Convert our ToolDefinition to OpenAI's ChatCompletionTool format.
 * @param tool - Lil Dude tool definition
 * @returns OpenAI-compatible tool definition
 */
function toOpenAITool(tool: ToolDefinition): ChatCompletionTool {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters as unknown as Record<string, unknown>,
    },
  };
}

/**
 * Convert our Message format to OpenAI's ChatCompletionMessageParam format.
 * Handles string content, content blocks, tool_use blocks, and tool_result blocks.
 * @param messages - Array of Lil Dude messages
 * @param systemPrompt - Optional system prompt to prepend
 * @returns Array of OpenAI-compatible message params
 */
function toOpenAIMessages(
  messages: Message[],
  systemPrompt?: string,
): ChatCompletionMessageParam[] {
  const openAIMessages: ChatCompletionMessageParam[] = [];

  if (systemPrompt) {
    openAIMessages.push({ role: 'system', content: systemPrompt });
  }

  for (const message of messages) {
    if (message.role === 'system') {
      openAIMessages.push({
        role: 'system',
        content: typeof message.content === 'string'
          ? message.content
          : extractTextFromBlocks(message.content),
      });
      continue;
    }

    if (typeof message.content === 'string') {
      openAIMessages.push({
        role: message.role as 'user' | 'assistant',
        content: message.content,
      });
      continue;
    }

    // Handle content blocks for assistant messages with tool calls
    if (message.role === 'assistant') {
      const textParts: string[] = [];
      const toolCalls: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }> = [];

      for (const block of message.content) {
        if (block.type === 'text' && block.text) {
          textParts.push(block.text);
        } else if (block.type === 'tool_use' && block.id && block.name) {
          toolCalls.push({
            id: block.id,
            type: 'function',
            function: {
              name: block.name,
              arguments: JSON.stringify(block.input ?? {}),
            },
          });
        }
      }

      const assistantMsg: ChatCompletionMessageParam = {
        role: 'assistant',
        content: textParts.length > 0 ? textParts.join('\n') : null,
      };

      if (toolCalls.length > 0) {
        (assistantMsg as OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam)
          .tool_calls = toolCalls;
      }

      openAIMessages.push(assistantMsg);
      continue;
    }

    // Handle user messages with tool_result blocks
    if (message.role === 'user') {
      const toolResults: ContentBlock[] = [];
      const textParts: string[] = [];

      for (const block of message.content) {
        if (block.type === 'tool_result') {
          toolResults.push(block);
        } else if (block.type === 'text' && block.text) {
          textParts.push(block.text);
        }
      }

      // Emit tool result messages first
      for (const toolResult of toolResults) {
        openAIMessages.push({
          role: 'tool',
          tool_call_id: toolResult.toolUseId ?? '',
          content: toolResult.content ?? '',
        });
      }

      // Emit text content if present
      if (textParts.length > 0) {
        openAIMessages.push({
          role: 'user',
          content: textParts.join('\n'),
        });
      }
    }
  }

  return openAIMessages;
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
 * Map an OpenAI finish_reason to our stop reason.
 * @param finishReason - The OpenAI finish reason string
 * @returns Our normalized stop reason
 */
function mapStopReason(
  finishReason: string | null | undefined,
): ChatResponse['stopReason'] {
  if (!finishReason) {
    return 'end_turn';
  }
  return STOP_REASON_MAP[finishReason] ?? 'end_turn';
}

/**
 * Wrap an OpenAI SDK error into a ProviderError with correct retryable flag.
 * @param error - The caught error
 * @param providerName - Name of the provider for error context
 * @returns A ProviderError instance
 */
function wrapError(error: unknown, providerName: string): ProviderError {
  if (error instanceof RateLimitError) {
    return new ProviderError(
      `Rate limited by ${providerName}: ${error.message}`,
      providerName,
      true,
    );
  }

  if (error instanceof AuthenticationError) {
    return new ProviderError(
      `Authentication failed for ${providerName}: ${error.message}`,
      providerName,
      false,
    );
  }

  if (error instanceof APIConnectionError) {
    return new ProviderError(
      `Network error connecting to ${providerName}: ${error.message}`,
      providerName,
      true,
    );
  }

  if (error instanceof APIError) {
    const statusCode = error.status;
    const isRetryable = statusCode !== undefined && statusCode >= 500;
    return new ProviderError(
      `${providerName} API error (${statusCode ?? 'unknown'}): ${error.message}`,
      providerName,
      isRetryable,
    );
  }

  if (error instanceof Error) {
    return new ProviderError(
      `${providerName} unexpected error: ${error.message}`,
      providerName,
      false,
    );
  }

  return new ProviderError(
    `${providerName} unknown error: ${String(error)}`,
    providerName,
    false,
  );
}

/**
 * OpenAI provider adapter for Lil Dude.
 * Implements the LLMProvider interface for OpenAI and compatible APIs (e.g., DeepSeek).
 */
export class OpenAIProvider implements LLMProvider {
  readonly name: string;
  private readonly client: OpenAI;

  /**
   * Create a new OpenAI provider.
   * @param config - Provider configuration including API key and optional base URL
   */
  constructor(config: OpenAIProviderConfig) {
    this.name = config.providerName ?? 'openai';
    this.client = new OpenAI({
      apiKey: config.apiKey,
      ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
      ...(config.maxRetries !== undefined ? { maxRetries: config.maxRetries } : {}),
    });

    providerLogger.info(
      { provider: this.name, hasCustomBaseUrl: !!config.baseUrl },
      'OpenAI provider initialized',
    );
  }

  /**
   * Send a non-streaming chat completion request.
   * @param messages - Conversation messages
   * @param options - Chat options including model, maxTokens, tools, etc.
   * @returns Parsed chat response with content blocks and usage info
   */
  async chat(messages: Message[], options: ChatOptions): Promise<ChatResponse> {
    try {
      const openAIMessages = toOpenAIMessages(messages, options.systemPrompt);
      const tools = options.tools?.map(toOpenAITool);

      const response = await this.client.chat.completions.create({
        model: options.model,
        messages: openAIMessages,
        max_tokens: options.maxTokens,
        ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
        ...(tools && tools.length > 0 ? { tools } : {}),
        ...(options.stopSequences && options.stopSequences.length > 0
          ? { stop: options.stopSequences }
          : {}),
        stream: false,
      });

      const choice = response.choices[0];
      if (!choice) {
        throw new ProviderError(
          `${this.name} returned no choices`,
          this.name,
          false,
        );
      }

      const contentBlocks = this.parseResponseMessage(choice.message);
      const usage = response.usage;

      return {
        content: contentBlocks,
        model: response.model,
        usage: {
          inputTokens: usage?.prompt_tokens ?? 0,
          outputTokens: usage?.completion_tokens ?? 0,
          cacheReadTokens: usage?.prompt_tokens_details?.cached_tokens ?? undefined,
        },
        stopReason: mapStopReason(choice.finish_reason),
      };
    } catch (error: unknown) {
      if (error instanceof ProviderError) {
        throw error;
      }
      throw wrapError(error, this.name);
    }
  }

  /**
   * Send a streaming chat completion request.
   * Yields StreamChunks as they arrive from the API.
   * @param messages - Conversation messages
   * @param options - Chat options including model, maxTokens, tools, etc.
   * @yields StreamChunk objects for text deltas, tool use events, and message stop
   */
  async *chatStream(
    messages: Message[],
    options: ChatOptions,
  ): AsyncGenerator<StreamChunk> {
    try {
      const openAIMessages = toOpenAIMessages(messages, options.systemPrompt);
      const tools = options.tools?.map(toOpenAITool);

      const stream = await this.client.chat.completions.create({
        model: options.model,
        messages: openAIMessages,
        max_tokens: options.maxTokens,
        ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
        ...(tools && tools.length > 0 ? { tools } : {}),
        ...(options.stopSequences && options.stopSequences.length > 0
          ? { stop: options.stopSequences }
          : {}),
        stream: true,
      });

      yield* this.processStream(stream);
    } catch (error: unknown) {
      if (error instanceof ProviderError) {
        throw error;
      }
      throw wrapError(error, this.name);
    }
  }

  /**
   * Count tokens in a text string using tiktoken.
   * @param text - The text to count tokens for
   * @returns Number of tokens
   */
  countTokens(text: string): number {
    return countTokens(text);
  }

  /**
   * Process a streaming response from OpenAI, yielding StreamChunks.
   * Tracks active tool calls across chunks.
   * @param stream - The OpenAI streaming response
   * @yields StreamChunk objects
   */
  private async *processStream(
    stream: AsyncIterable<ChatCompletionChunk>,
  ): AsyncGenerator<StreamChunk> {
    const activeToolCalls = new Map<number, boolean>();

    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      if (!choice) {
        continue;
      }

      const delta = choice.delta;

      // Handle text content
      if (delta.content) {
        yield { type: 'text_delta', text: delta.content };
      }

      // Handle tool calls
      if (delta.tool_calls) {
        for (const toolCall of delta.tool_calls) {
          const toolIndex = toolCall.index;

          // New tool call starting
          if (toolCall.function?.name && !activeToolCalls.has(toolIndex)) {
            activeToolCalls.set(toolIndex, true);
            yield {
              type: 'tool_use_start',
              toolName: toolCall.function.name,
            };
          }

          // Tool arguments delta
          if (toolCall.function?.arguments) {
            yield {
              type: 'tool_input_delta',
              toolInput: toolCall.function.arguments,
            };
          }
        }
      }

      // Handle finish
      if (choice.finish_reason) {
        yield { type: 'message_stop' };
      }
    }
  }

  /**
   * Parse an OpenAI response message into our ContentBlock array.
   * Handles text content and tool_calls.
   * @param message - The OpenAI chat completion message
   * @returns Array of content blocks
   */
  private parseResponseMessage(
    message: OpenAI.Chat.Completions.ChatCompletionMessage,
  ): ContentBlock[] {
    const blocks: ContentBlock[] = [];

    if (message.content) {
      blocks.push({ type: 'text', text: message.content });
    }

    if (message.tool_calls) {
      for (const toolCall of message.tool_calls) {
        let parsedInput: Record<string, unknown> = {};
        try {
          parsedInput = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
        } catch {
          providerLogger.warn(
            { toolName: toolCall.function.name, rawArgs: toolCall.function.arguments },
            'Failed to parse tool call arguments as JSON',
          );
        }

        blocks.push({
          type: 'tool_use',
          id: toolCall.id,
          name: toolCall.function.name,
          input: parsedInput,
        });
      }
    }

    return blocks;
  }
}
