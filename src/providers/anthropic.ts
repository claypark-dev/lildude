/**
 * Anthropic provider adapter for Lil Dude.
 * Implements LLMProvider using the @anthropic-ai/sdk package.
 * Handles chat, streaming, token counting, and cost tracking.
 * See HLD Section 10 for provider architecture.
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  MessageParam,
  Tool as AnthropicTool,
  ContentBlockParam,
  RawMessageStreamEvent,
  TextBlock,
  ToolUseBlock,
} from '@anthropic-ai/sdk/resources/messages/messages.js';
// Note: We avoid importing SDK error classes directly because ESM dual-package
// hazard causes instanceof checks to fail. Instead we check the `status` property.

import type {
  LLMProvider,
  Message,
  ChatOptions,
  ChatResponse,
  StreamChunk,
  ContentBlock,
  ToolDefinition,
} from '../types/index.js';
import { ProviderError } from '../errors.js';
import { countTokens } from '../cost/tokens.js';
import { calculateCost } from '../cost/pricing.js';
import { providerLogger } from '../utils/logger.js';

const PROVIDER_NAME = 'anthropic';

/** Configuration for constructing the Anthropic provider */
export interface AnthropicProviderConfig {
  apiKey: string;
  baseUrl?: string;
}

/**
 * Map our Message format to Anthropic's MessageParam format.
 * Filters out system messages (handled separately via the system param).
 * @param messages - Array of Lil Dude messages
 * @returns Array of Anthropic MessageParam objects
 */
function toAnthropicMessages(messages: Message[]): MessageParam[] {
  return messages
    .filter((msg) => msg.role !== 'system')
    .map((msg): MessageParam => {
      if (typeof msg.content === 'string') {
        return {
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
        };
      }

      const blocks: ContentBlockParam[] = msg.content.map((block) => {
        if (block.type === 'tool_use') {
          return {
            type: 'tool_use' as const,
            id: block.id ?? '',
            name: block.name ?? '',
            input: block.input ?? {},
          };
        }

        if (block.type === 'tool_result') {
          return {
            type: 'tool_result' as const,
            tool_use_id: block.toolUseId ?? '',
            content: block.content ?? '',
            is_error: block.isError,
          };
        }

        return {
          type: 'text' as const,
          text: block.text ?? '',
        };
      });

      return {
        role: msg.role as 'user' | 'assistant',
        content: blocks,
      };
    });
}

/**
 * Map our ToolDefinition format to Anthropic's Tool format.
 * @param tools - Array of Lil Dude tool definitions
 * @returns Array of Anthropic Tool objects
 */
function toAnthropicTools(tools: ToolDefinition[]): AnthropicTool[] {
  return tools.map((tool): AnthropicTool => ({
    name: tool.name,
    description: tool.description,
    input_schema: {
      type: 'object' as const,
      properties: tool.parameters.properties,
      required: tool.parameters.required,
    },
  }));
}

/**
 * Map Anthropic's stop_reason to our ChatResponse stopReason.
 * @param stopReason - Anthropic stop_reason string
 * @returns Our normalized stopReason value
 */
function mapStopReason(
  stopReason: string | null,
): ChatResponse['stopReason'] {
  switch (stopReason) {
    case 'end_turn':
      return 'end_turn';
    case 'tool_use':
      return 'tool_use';
    case 'max_tokens':
      return 'max_tokens';
    case 'stop_sequence':
      return 'stop_sequence';
    default:
      return 'end_turn';
  }
}

/**
 * Map an Anthropic content block to our ContentBlock format.
 * @param block - Anthropic TextBlock or ToolUseBlock
 * @returns Our normalized ContentBlock
 */
function mapContentBlock(block: TextBlock | ToolUseBlock): ContentBlock {
  if (block.type === 'text') {
    return { type: 'text', text: block.text };
  }

  return {
    type: 'tool_use',
    id: block.id,
    name: block.name,
    input: block.input as Record<string, unknown>,
  };
}

/**
 * Wrap Anthropic SDK errors into ProviderError with correct retryable flag.
 * Uses status code checks to avoid ESM dual-package instanceof issues.
 * @param error - The caught error from the SDK call
 * @returns A ProviderError instance
 */
function wrapError(error: unknown): ProviderError {
  // The Anthropic SDK error classes may fail instanceof checks in ESM
  // due to dual-package hazard, so we check the `status` property directly.
  if (error instanceof Error && 'status' in error) {
    const status = (error as { status: number }).status;

    if (status === 429) {
      return new ProviderError(`Rate limited: ${error.message}`, PROVIDER_NAME, true);
    }
    if (status === 401) {
      return new ProviderError(`Authentication failed: ${error.message}`, PROVIDER_NAME, false);
    }
    if (status >= 500) {
      return new ProviderError(`API error (${status}): ${error.message}`, PROVIDER_NAME, true);
    }

    return new ProviderError(`API error (${status}): ${error.message}`, PROVIDER_NAME, false);
  }

  // Connection errors (no status code, e.g. ECONNREFUSED)
  if (error instanceof Error && error.message.includes('ECONNREFUSED')) {
    return new ProviderError(`Connection error: ${error.message}`, PROVIDER_NAME, true);
  }

  if (error instanceof Error) {
    return new ProviderError(error.message, PROVIDER_NAME, false);
  }

  return new ProviderError(String(error), PROVIDER_NAME, false);
}

/**
 * Anthropic LLM provider implementation.
 * Supports chat, streaming, token counting, and cost tracking
 * via the @anthropic-ai/sdk package.
 */
export class AnthropicProvider implements LLMProvider {
  readonly name = PROVIDER_NAME;
  private readonly client: Anthropic;

  /**
   * Create a new AnthropicProvider.
   * @param config - API key and optional base URL
   */
  constructor(config: AnthropicProviderConfig) {
    this.client = new Anthropic({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
      maxRetries: 0,
    });
  }

  /**
   * Send a non-streaming chat request to Anthropic.
   * Maps messages and tools to Anthropic's format, records cost, and
   * returns a normalized ChatResponse.
   * @param messages - Conversation messages
   * @param options - Model, maxTokens, temperature, tools, systemPrompt, stopSequences
   * @returns Normalized ChatResponse with content, usage, and stopReason
   */
  async chat(messages: Message[], options: ChatOptions): Promise<ChatResponse> {
    try {
      const anthropicMessages = toAnthropicMessages(messages);

      const requestParams: Anthropic.MessageCreateParamsNonStreaming = {
        model: options.model,
        max_tokens: options.maxTokens,
        messages: anthropicMessages,
        stream: false,
      };

      if (options.temperature !== undefined) {
        requestParams.temperature = options.temperature;
      }

      if (options.systemPrompt) {
        requestParams.system = options.systemPrompt;
      }

      if (options.stopSequences && options.stopSequences.length > 0) {
        requestParams.stop_sequences = options.stopSequences;
      }

      if (options.tools && options.tools.length > 0) {
        requestParams.tools = toAnthropicTools(options.tools);
      }

      const response = await this.client.messages.create(requestParams);

      const contentBlocks: ContentBlock[] = response.content
        .filter(
          (block): block is TextBlock | ToolUseBlock =>
            block.type === 'text' || block.type === 'tool_use',
        )
        .map(mapContentBlock);

      const usage = {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? undefined,
        cacheWriteTokens:
          response.usage.cache_creation_input_tokens ?? undefined,
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
          stopReason: response.stop_reason,
        },
        'Anthropic chat completed',
      );

      return {
        content: contentBlocks,
        model: response.model,
        usage,
        stopReason: mapStopReason(response.stop_reason),
      };
    } catch (error: unknown) {
      throw wrapError(error);
    }
  }

  /**
   * Send a streaming chat request to Anthropic.
   * Yields StreamChunk objects as the response arrives.
   * @param messages - Conversation messages
   * @param options - Model, maxTokens, temperature, tools, systemPrompt, stopSequences
   * @yields StreamChunk objects with text deltas, tool use starts, and message_stop
   */
  async *chatStream(
    messages: Message[],
    options: ChatOptions,
  ): AsyncGenerator<StreamChunk> {
    try {
      const anthropicMessages = toAnthropicMessages(messages);

      const requestParams: Anthropic.MessageCreateParamsStreaming = {
        model: options.model,
        max_tokens: options.maxTokens,
        messages: anthropicMessages,
        stream: true,
      };

      if (options.temperature !== undefined) {
        requestParams.temperature = options.temperature;
      }

      if (options.systemPrompt) {
        requestParams.system = options.systemPrompt;
      }

      if (options.stopSequences && options.stopSequences.length > 0) {
        requestParams.stop_sequences = options.stopSequences;
      }

      if (options.tools && options.tools.length > 0) {
        requestParams.tools = toAnthropicTools(options.tools);
      }

      const stream = await this.client.messages.create(requestParams);

      let inputTokens = 0;
      let outputTokens = 0;

      for await (const event of stream as AsyncIterable<RawMessageStreamEvent>) {
        const chunk = this.mapStreamEvent(event);

        if (event.type === 'message_start') {
          inputTokens = event.message.usage.input_tokens;
          outputTokens = event.message.usage.output_tokens;
        }

        if (event.type === 'message_delta') {
          outputTokens += event.usage.output_tokens;
        }

        if (chunk) {
          yield chunk;
        }
      }

      const costUsd = calculateCost(
        options.model,
        inputTokens,
        outputTokens,
      );

      providerLogger.info(
        {
          model: options.model,
          inputTokens,
          outputTokens,
          costUsd,
        },
        'Anthropic stream completed',
      );
    } catch (error: unknown) {
      throw wrapError(error);
    }
  }

  /**
   * Count the number of tokens in a text string.
   * Delegates to the shared tiktoken-based counter in src/cost/tokens.ts.
   * @param text - The text to count tokens for
   * @returns The number of tokens
   */
  countTokens(text: string): number {
    return countTokens(text);
  }

  /**
   * Map a single Anthropic stream event to our StreamChunk format.
   * Returns undefined for events we do not surface to callers.
   * @param event - Raw Anthropic stream event
   * @returns StreamChunk or undefined if the event is not relevant
   */
  private mapStreamEvent(event: RawMessageStreamEvent): StreamChunk | undefined {
    switch (event.type) {
      case 'content_block_start': {
        if (event.content_block.type === 'tool_use') {
          return {
            type: 'tool_use_start',
            toolName: event.content_block.name,
          };
        }
        return undefined;
      }

      case 'content_block_delta': {
        if (event.delta.type === 'text_delta') {
          return {
            type: 'text_delta',
            text: event.delta.text,
          };
        }
        if (event.delta.type === 'input_json_delta') {
          return {
            type: 'tool_input_delta',
            toolInput: event.delta.partial_json,
          };
        }
        return undefined;
      }

      case 'message_stop':
        return { type: 'message_stop' };

      default:
        return undefined;
    }
  }
}
