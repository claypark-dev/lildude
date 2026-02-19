/**
 * Integration tests for the Anthropic provider adapter.
 * Uses a mock HTTP server to simulate Anthropic API responses.
 * Tests chat, streaming, tool use, rate limits, and auth errors.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Message, ChatOptions } from '../../../src/types/index.js';
import { AnthropicProvider } from '../../../src/providers/anthropic.js';
import { ProviderError } from '../../../src/errors.js';

/** Tracks the last request body sent to the mock server */
let lastRequestBody: Record<string, unknown> | undefined;

/** Queue of mock responses for the server to return */
let responseQueue: Array<{
  status: number;
  headers?: Record<string, string>;
  body: unknown;
  streaming?: boolean;
}> = [];

let mockServer: http.Server;
let baseUrl: string;

/**
 * Build a standard Anthropic API response body.
 * @param overrides - Partial overrides for the response fields
 */
function buildMessageResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'msg_test_001',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text: 'Hello from mock Claude!' }],
    model: 'claude-haiku-4-5-20251001',
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: 25,
      output_tokens: 15,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
    },
    ...overrides,
  };
}

/**
 * Build a Server-Sent Events stream body from a list of events.
 * @param events - Array of SSE event objects
 * @returns Formatted SSE string
 */
function buildSSEStream(events: Array<{ event: string; data: unknown }>): string {
  return events.map((evt) => `event: ${evt.event}\ndata: ${JSON.stringify(evt.data)}\n\n`).join('');
}

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      mockServer = http.createServer((req, res) => {
        let body = '';
        req.on('data', (chunk: Buffer) => {
          body += chunk.toString();
        });
        req.on('end', () => {
          try {
            lastRequestBody = JSON.parse(body) as Record<string, unknown>;
          } catch {
            lastRequestBody = undefined;
          }

          const mockResponse = responseQueue.shift();
          if (!mockResponse) {
            res.writeHead(500, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: { type: 'server_error', message: 'No mock response queued' } }));
            return;
          }

          const headers: Record<string, string> = {
            ...mockResponse.headers,
          };

          if (mockResponse.streaming) {
            headers['content-type'] = 'text/event-stream';
            res.writeHead(mockResponse.status, headers);
            res.end(mockResponse.body as string);
          } else {
            headers['content-type'] = 'application/json';
            res.writeHead(mockResponse.status, headers);
            res.end(JSON.stringify(mockResponse.body));
          }
        });
      });

      mockServer.listen(0, '127.0.0.1', () => {
        const addr = mockServer.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    }),
);

afterAll(
  () =>
    new Promise<void>((resolve) => {
      mockServer.close(() => resolve());
    }),
);

beforeEach(() => {
  responseQueue = [];
  lastRequestBody = undefined;
});

function createProvider(): AnthropicProvider {
  return new AnthropicProvider({
    apiKey: 'test-api-key',
    baseUrl,
  });
}

const defaultOptions: ChatOptions = {
  model: 'claude-haiku-4-5-20251001',
  maxTokens: 1024,
};

const simpleMessages: Message[] = [
  { role: 'user', content: 'Hello' },
];

describe('AnthropicProvider', () => {
  describe('chat()', () => {
    it('returns a properly typed ChatResponse for a simple text reply', async () => {
      responseQueue.push({
        status: 200,
        body: buildMessageResponse(),
      });

      const provider = createProvider();
      const result = await provider.chat(simpleMessages, defaultOptions);

      expect(result.content).toHaveLength(1);
      expect(result.content[0]).toEqual({
        type: 'text',
        text: 'Hello from mock Claude!',
      });
      expect(result.model).toBe('claude-haiku-4-5-20251001');
      expect(result.usage.inputTokens).toBe(25);
      expect(result.usage.outputTokens).toBe(15);
      expect(result.stopReason).toBe('end_turn');
    });

    it('sends the correct request parameters to the API', async () => {
      responseQueue.push({
        status: 200,
        body: buildMessageResponse(),
      });

      const provider = createProvider();
      await provider.chat(simpleMessages, {
        model: 'claude-haiku-4-5-20251001',
        maxTokens: 512,
        temperature: 0.5,
        systemPrompt: 'You are a test assistant.',
        stopSequences: ['STOP'],
      });

      expect(lastRequestBody).toBeDefined();
      expect(lastRequestBody?.model).toBe('claude-haiku-4-5-20251001');
      expect(lastRequestBody?.max_tokens).toBe(512);
      expect(lastRequestBody?.temperature).toBe(0.5);
      expect(lastRequestBody?.system).toBe('You are a test assistant.');
      expect(lastRequestBody?.stop_sequences).toEqual(['STOP']);
      expect(lastRequestBody?.stream).toBe(false);
    });

    it('maps cache token usage when present', async () => {
      responseQueue.push({
        status: 200,
        body: buildMessageResponse({
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_creation_input_tokens: 20,
            cache_read_input_tokens: 30,
          },
        }),
      });

      const provider = createProvider();
      const result = await provider.chat(simpleMessages, defaultOptions);

      expect(result.usage.inputTokens).toBe(100);
      expect(result.usage.outputTokens).toBe(50);
      expect(result.usage.cacheWriteTokens).toBe(20);
      expect(result.usage.cacheReadTokens).toBe(30);
    });

    it('filters system messages from the messages array', async () => {
      responseQueue.push({
        status: 200,
        body: buildMessageResponse(),
      });

      const provider = createProvider();
      const messagesWithSystem: Message[] = [
        { role: 'system', content: 'System prompt via message' },
        { role: 'user', content: 'Hello' },
      ];

      await provider.chat(messagesWithSystem, defaultOptions);

      const sentMessages = lastRequestBody?.messages as Array<{ role: string }>;
      expect(sentMessages).toHaveLength(1);
      expect(sentMessages[0].role).toBe('user');
    });
  });

  describe('tool use round-trip', () => {
    it('returns tool_use content blocks with stop_reason tool_use', async () => {
      responseQueue.push({
        status: 200,
        body: buildMessageResponse({
          content: [
            {
              type: 'tool_use',
              id: 'toolu_test_123',
              name: 'get_weather',
              input: { location: 'San Francisco' },
            },
          ],
          stop_reason: 'tool_use',
        }),
      });

      const provider = createProvider();
      const result = await provider.chat(simpleMessages, {
        ...defaultOptions,
        tools: [
          {
            name: 'get_weather',
            description: 'Get the weather for a location',
            parameters: {
              type: 'object',
              properties: {
                location: { type: 'string', description: 'City name' },
              },
              required: ['location'],
            },
          },
        ],
      });

      expect(result.stopReason).toBe('tool_use');
      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('tool_use');
      expect(result.content[0].id).toBe('toolu_test_123');
      expect(result.content[0].name).toBe('get_weather');
      expect(result.content[0].input).toEqual({ location: 'San Francisco' });
    });

    it('correctly maps tool definitions to Anthropic format', async () => {
      responseQueue.push({
        status: 200,
        body: buildMessageResponse(),
      });

      const provider = createProvider();
      await provider.chat(simpleMessages, {
        ...defaultOptions,
        tools: [
          {
            name: 'search',
            description: 'Search the web',
            parameters: {
              type: 'object',
              properties: {
                query: { type: 'string' },
              },
              required: ['query'],
            },
          },
        ],
      });

      const sentTools = lastRequestBody?.tools as Array<Record<string, unknown>>;
      expect(sentTools).toHaveLength(1);
      expect(sentTools[0].name).toBe('search');
      expect(sentTools[0].description).toBe('Search the web');
      expect(sentTools[0].input_schema).toEqual({
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      });
    });

    it('handles feeding tool_result back in a follow-up message', async () => {
      responseQueue.push({
        status: 200,
        body: buildMessageResponse({
          content: [{ type: 'text', text: 'The weather in SF is sunny, 72F.' }],
          stop_reason: 'end_turn',
        }),
      });

      const provider = createProvider();
      const followUpMessages: Message[] = [
        { role: 'user', content: "What's the weather in SF?" },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_test_123',
              name: 'get_weather',
              input: { location: 'San Francisco' },
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              toolUseId: 'toolu_test_123',
              content: '{"temperature": 72, "condition": "sunny"}',
            },
          ],
        },
      ];

      const result = await provider.chat(followUpMessages, defaultOptions);

      expect(result.stopReason).toBe('end_turn');
      expect(result.content[0].text).toBe('The weather in SF is sunny, 72F.');

      // Verify the tool_result was mapped correctly in the request
      const sentMessages = lastRequestBody?.messages as Array<{
        role: string;
        content: Array<Record<string, unknown>> | string;
      }>;
      const toolResultMessage = sentMessages[2];
      expect(toolResultMessage.role).toBe('user');

      const toolResultBlock = (toolResultMessage.content as Array<Record<string, unknown>>)[0];
      expect(toolResultBlock.type).toBe('tool_result');
      expect(toolResultBlock.tool_use_id).toBe('toolu_test_123');
    });
  });

  describe('chatStream()', () => {
    it('yields text_delta chunks from a streaming response', async () => {
      const sseBody = buildSSEStream([
        {
          event: 'message_start',
          data: {
            type: 'message_start',
            message: {
              id: 'msg_stream_001',
              type: 'message',
              role: 'assistant',
              content: [],
              model: 'claude-haiku-4-5-20251001',
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: 10, output_tokens: 0, cache_creation_input_tokens: null, cache_read_input_tokens: null },
            },
          },
        },
        {
          event: 'content_block_start',
          data: {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'text', text: '' },
          },
        },
        {
          event: 'content_block_delta',
          data: {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: 'Hello ' },
          },
        },
        {
          event: 'content_block_delta',
          data: {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: 'world!' },
          },
        },
        {
          event: 'content_block_stop',
          data: { type: 'content_block_stop', index: 0 },
        },
        {
          event: 'message_delta',
          data: {
            type: 'message_delta',
            delta: { stop_reason: 'end_turn', stop_sequence: null },
            usage: { output_tokens: 5 },
          },
        },
        {
          event: 'message_stop',
          data: { type: 'message_stop' },
        },
      ]);

      responseQueue.push({
        status: 200,
        body: sseBody,
        streaming: true,
      });

      const provider = createProvider();
      const chunks: StreamChunk[] = [];

      for await (const chunk of provider.chatStream(simpleMessages, defaultOptions)) {
        chunks.push(chunk);
      }

      const textDeltas = chunks.filter((c) => c.type === 'text_delta');
      expect(textDeltas).toHaveLength(2);
      expect(textDeltas[0].text).toBe('Hello ');
      expect(textDeltas[1].text).toBe('world!');

      const stopChunks = chunks.filter((c) => c.type === 'message_stop');
      expect(stopChunks).toHaveLength(1);
    });

    it('yields tool_use_start and tool_input_delta for streaming tool use', async () => {
      const sseBody = buildSSEStream([
        {
          event: 'message_start',
          data: {
            type: 'message_start',
            message: {
              id: 'msg_stream_002',
              type: 'message',
              role: 'assistant',
              content: [],
              model: 'claude-haiku-4-5-20251001',
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: 10, output_tokens: 0, cache_creation_input_tokens: null, cache_read_input_tokens: null },
            },
          },
        },
        {
          event: 'content_block_start',
          data: {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'tool_use', id: 'toolu_stream_1', name: 'get_weather', input: {} },
          },
        },
        {
          event: 'content_block_delta',
          data: {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'input_json_delta', partial_json: '{"loc' },
          },
        },
        {
          event: 'content_block_delta',
          data: {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'input_json_delta', partial_json: 'ation":"NYC"}' },
          },
        },
        {
          event: 'content_block_stop',
          data: { type: 'content_block_stop', index: 0 },
        },
        {
          event: 'message_delta',
          data: {
            type: 'message_delta',
            delta: { stop_reason: 'tool_use', stop_sequence: null },
            usage: { output_tokens: 10 },
          },
        },
        {
          event: 'message_stop',
          data: { type: 'message_stop' },
        },
      ]);

      responseQueue.push({
        status: 200,
        body: sseBody,
        streaming: true,
      });

      const provider = createProvider();
      const chunks: StreamChunk[] = [];

      for await (const chunk of provider.chatStream(simpleMessages, defaultOptions)) {
        chunks.push(chunk);
      }

      const toolStarts = chunks.filter((c) => c.type === 'tool_use_start');
      expect(toolStarts).toHaveLength(1);
      expect(toolStarts[0].toolName).toBe('get_weather');

      const inputDeltas = chunks.filter((c) => c.type === 'tool_input_delta');
      expect(inputDeltas).toHaveLength(2);
      expect(inputDeltas[0].toolInput).toBe('{"loc');
      expect(inputDeltas[1].toolInput).toBe('ation":"NYC"}');
    });
  });

  describe('error handling', () => {
    it('throws a retryable ProviderError on 429 rate limit', async () => {
      responseQueue.push({
        status: 429,
        headers: { 'retry-after': '30' },
        body: {
          type: 'error',
          error: {
            type: 'rate_limit_error',
            message: 'Rate limit exceeded',
          },
        },
      });

      const provider = createProvider();

      try {
        await provider.chat(simpleMessages, defaultOptions);
        expect.fail('Expected ProviderError to be thrown');
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(ProviderError);
        const providerErr = error as ProviderError;
        expect(providerErr.retryable).toBe(true);
        expect(providerErr.provider).toBe('anthropic');
        expect(providerErr.message).toContain('Rate limited');
      }
    });

    it('throws a non-retryable ProviderError on 401 auth failure', async () => {
      responseQueue.push({
        status: 401,
        body: {
          type: 'error',
          error: {
            type: 'authentication_error',
            message: 'Invalid API key',
          },
        },
      });

      const provider = createProvider();

      try {
        await provider.chat(simpleMessages, defaultOptions);
        expect.fail('Expected ProviderError to be thrown');
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(ProviderError);
        const providerErr = error as ProviderError;
        expect(providerErr.retryable).toBe(false);
        expect(providerErr.provider).toBe('anthropic');
        expect(providerErr.message).toContain('Authentication failed');
      }
    });

    it('throws a retryable ProviderError on 500 server error', async () => {
      responseQueue.push({
        status: 500,
        body: {
          type: 'error',
          error: {
            type: 'api_error',
            message: 'Internal server error',
          },
        },
      });

      const provider = createProvider();

      try {
        await provider.chat(simpleMessages, defaultOptions);
        expect.fail('Expected ProviderError to be thrown');
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(ProviderError);
        const providerErr = error as ProviderError;
        expect(providerErr.retryable).toBe(true);
        expect(providerErr.provider).toBe('anthropic');
      }
    });

    it('throws a retryable ProviderError on streaming 429 rate limit', async () => {
      responseQueue.push({
        status: 429,
        headers: { 'retry-after': '30' },
        body: {
          type: 'error',
          error: {
            type: 'rate_limit_error',
            message: 'Rate limit exceeded during stream',
          },
        },
      });

      const provider = createProvider();

      try {
        const gen = provider.chatStream(simpleMessages, defaultOptions);
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _chunk of gen) {
          // drain
        }
        expect.fail('Expected ProviderError to be thrown');
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(ProviderError);
        const providerErr = error as ProviderError;
        expect(providerErr.retryable).toBe(true);
      }
    });
  });

  describe('countTokens()', () => {
    it('returns a positive integer for non-empty text', () => {
      const provider = createProvider();
      const tokenCount = provider.countTokens('Hello, world! This is a test.');
      expect(tokenCount).toBeGreaterThan(0);
      expect(Number.isInteger(tokenCount)).toBe(true);
    });

    it('returns 0 for empty text', () => {
      const provider = createProvider();
      expect(provider.countTokens('')).toBe(0);
    });
  });

  describe('provider name', () => {
    it('has the name "anthropic"', () => {
      const provider = createProvider();
      expect(provider.name).toBe('anthropic');
    });
  });
});
