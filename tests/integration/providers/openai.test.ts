/**
 * Integration tests for the OpenAI provider adapter.
 * Uses a mock HTTP server to simulate OpenAI API responses.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { OpenAIProvider } from '../../../src/providers/openai.js';
import { ProviderError } from '../../../src/errors.js';
import type { Message, ToolDefinition, ChatOptions } from '../../../src/types/index.js';

/** Collects the full body from an incoming HTTP request */
function readRequestBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

/** Shape of a mock chat completion response from OpenAI */
interface MockCompletion {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: string;
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
}

/** Creates a standard successful chat completion response */
function makeCompletion(overrides?: Partial<MockCompletion>): MockCompletion {
  return {
    id: 'chatcmpl-test-123',
    object: 'chat.completion',
    created: 1700000000,
    model: 'gpt-4o-mini',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: 'Hello! How can I help you today?' },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 8,
      total_tokens: 18,
    },
    ...overrides,
  };
}

/** Creates streaming chunks as SSE-formatted lines */
function makeStreamChunks(
  chunks: Array<{
    content?: string | null;
    tool_calls?: Array<{
      index: number;
      id?: string;
      type?: string;
      function?: { name?: string; arguments?: string };
    }>;
    finish_reason?: string | null;
  }>,
  model = 'gpt-4o-mini',
): string {
  const lines: string[] = [];

  for (const chunk of chunks) {
    const sseChunk = {
      id: 'chatcmpl-stream-123',
      object: 'chat.completion.chunk',
      created: 1700000000,
      model,
      choices: [
        {
          index: 0,
          delta: {
            ...(chunk.content !== undefined ? { content: chunk.content } : {}),
            ...(chunk.tool_calls ? { tool_calls: chunk.tool_calls } : {}),
          },
          finish_reason: chunk.finish_reason ?? null,
        },
      ],
    };
    lines.push(`data: ${JSON.stringify(sseChunk)}\n\n`);
  }

  lines.push('data: [DONE]\n\n');
  return lines.join('');
}

describe('OpenAIProvider', () => {
  let server: http.Server;
  let baseUrl: string;
  let lastRequestBody: Record<string, unknown> | undefined;
  let mockHandler: (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    body: Record<string, unknown>,
  ) => void;

  beforeAll(async () => {
    server = http.createServer(async (req, res) => {
      const rawBody = await readRequestBody(req);
      const body = JSON.parse(rawBody) as Record<string, unknown>;
      lastRequestBody = body;
      mockHandler(req, res, body);
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}/v1`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((closeError) => (closeError ? reject(closeError) : resolve()));
    });
  });

  beforeEach(() => {
    lastRequestBody = undefined;
    // Default handler returns a simple completion
    mockHandler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(makeCompletion()));
    };
  });

  function createProvider(overrides?: { providerName?: string; maxRetries?: number }): OpenAIProvider {
    return new OpenAIProvider({
      apiKey: 'test-api-key',
      baseUrl,
      maxRetries: 0,
      ...overrides,
    });
  }

  const defaultMessages: Message[] = [
    { role: 'user', content: 'Hello' },
  ];

  const defaultOptions: ChatOptions = {
    model: 'gpt-4o-mini',
    maxTokens: 1024,
  };

  describe('chat()', () => {
    it('should return a successful chat response', async () => {
      const provider = createProvider();
      const response = await provider.chat(defaultMessages, defaultOptions);

      expect(response.content).toHaveLength(1);
      expect(response.content[0]).toEqual({
        type: 'text',
        text: 'Hello! How can I help you today?',
      });
      expect(response.model).toBe('gpt-4o-mini');
      expect(response.usage.inputTokens).toBe(10);
      expect(response.usage.outputTokens).toBe(8);
      expect(response.stopReason).toBe('end_turn');
    });

    it('should send the correct model and maxTokens in the request', async () => {
      const provider = createProvider();
      await provider.chat(defaultMessages, {
        model: 'gpt-4o',
        maxTokens: 2048,
        temperature: 0.7,
      });

      expect(lastRequestBody).toBeDefined();
      expect(lastRequestBody!.model).toBe('gpt-4o');
      expect(lastRequestBody!.max_tokens).toBe(2048);
      expect(lastRequestBody!.temperature).toBe(0.7);
    });

    it('should prepend system prompt as a system message', async () => {
      const provider = createProvider();
      await provider.chat(defaultMessages, {
        ...defaultOptions,
        systemPrompt: 'You are a helpful assistant.',
      });

      expect(lastRequestBody).toBeDefined();
      const sentMessages = lastRequestBody!.messages as Array<{ role: string; content: string }>;
      expect(sentMessages[0]).toEqual({
        role: 'system',
        content: 'You are a helpful assistant.',
      });
      expect(sentMessages[1]).toEqual({
        role: 'user',
        content: 'Hello',
      });
    });

    it('should send stop sequences when provided', async () => {
      const provider = createProvider();
      await provider.chat(defaultMessages, {
        ...defaultOptions,
        stopSequences: ['STOP', 'END'],
      });

      expect(lastRequestBody).toBeDefined();
      expect(lastRequestBody!.stop).toEqual(['STOP', 'END']);
    });

    it('should map stop finish_reason to end_turn', async () => {
      mockHandler = (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(makeCompletion({
          choices: [{
            index: 0,
            message: { role: 'assistant', content: 'Done.' },
            finish_reason: 'stop',
          }],
        })));
      };

      const provider = createProvider();
      const response = await provider.chat(defaultMessages, defaultOptions);
      expect(response.stopReason).toBe('end_turn');
    });

    it('should map length finish_reason to max_tokens', async () => {
      mockHandler = (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(makeCompletion({
          choices: [{
            index: 0,
            message: { role: 'assistant', content: 'Truncated text...' },
            finish_reason: 'length',
          }],
        })));
      };

      const provider = createProvider();
      const response = await provider.chat(defaultMessages, defaultOptions);
      expect(response.stopReason).toBe('max_tokens');
    });

    it('should include cached token count when available', async () => {
      mockHandler = (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(makeCompletion({
          usage: {
            prompt_tokens: 50,
            completion_tokens: 20,
            total_tokens: 70,
            prompt_tokens_details: { cached_tokens: 30 },
          },
        })));
      };

      const provider = createProvider();
      const response = await provider.chat(defaultMessages, defaultOptions);
      expect(response.usage.inputTokens).toBe(50);
      expect(response.usage.outputTokens).toBe(20);
      expect(response.usage.cacheReadTokens).toBe(30);
    });
  });

  describe('tool use mapping', () => {
    const weatherTool: ToolDefinition = {
      name: 'get_weather',
      description: 'Get the current weather for a location',
      parameters: {
        type: 'object',
        properties: {
          location: { type: 'string', description: 'City name' },
          unit: { type: 'string', enum: ['celsius', 'fahrenheit'] },
        },
        required: ['location'],
      },
    };

    it('should convert tool definitions to OpenAI format', async () => {
      const provider = createProvider();
      await provider.chat(defaultMessages, {
        ...defaultOptions,
        tools: [weatherTool],
      });

      expect(lastRequestBody).toBeDefined();
      const sentTools = lastRequestBody!.tools as Array<{
        type: string;
        function: { name: string; description: string; parameters: unknown };
      }>;
      expect(sentTools).toHaveLength(1);
      expect(sentTools[0].type).toBe('function');
      expect(sentTools[0].function.name).toBe('get_weather');
      expect(sentTools[0].function.description).toBe('Get the current weather for a location');
      expect(sentTools[0].function.parameters).toEqual(weatherTool.parameters);
    });

    it('should parse tool call responses into tool_use content blocks', async () => {
      mockHandler = (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(makeCompletion({
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [{
                id: 'call_abc123',
                type: 'function',
                function: {
                  name: 'get_weather',
                  arguments: '{"location":"San Francisco","unit":"celsius"}',
                },
              }],
            },
            finish_reason: 'tool_calls',
          }],
        })));
      };

      const provider = createProvider();
      const response = await provider.chat(defaultMessages, {
        ...defaultOptions,
        tools: [weatherTool],
      });

      expect(response.stopReason).toBe('tool_use');
      expect(response.content).toHaveLength(1);
      expect(response.content[0]).toEqual({
        type: 'tool_use',
        id: 'call_abc123',
        name: 'get_weather',
        input: { location: 'San Francisco', unit: 'celsius' },
      });
    });

    it('should handle tool call with text content', async () => {
      mockHandler = (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(makeCompletion({
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: 'Let me check the weather for you.',
              tool_calls: [{
                id: 'call_def456',
                type: 'function',
                function: {
                  name: 'get_weather',
                  arguments: '{"location":"Tokyo"}',
                },
              }],
            },
            finish_reason: 'tool_calls',
          }],
        })));
      };

      const provider = createProvider();
      const response = await provider.chat(defaultMessages, {
        ...defaultOptions,
        tools: [weatherTool],
      });

      expect(response.content).toHaveLength(2);
      expect(response.content[0]).toEqual({
        type: 'text',
        text: 'Let me check the weather for you.',
      });
      expect(response.content[1]).toEqual({
        type: 'tool_use',
        id: 'call_def456',
        name: 'get_weather',
        input: { location: 'Tokyo' },
      });
    });

    it('should send tool_result messages as tool role messages', async () => {
      const messagesWithToolResult: Message[] = [
        { role: 'user', content: 'What is the weather?' },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'call_abc123',
              name: 'get_weather',
              input: { location: 'SF' },
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              toolUseId: 'call_abc123',
              content: '72°F and sunny',
            },
          ],
        },
      ];

      const provider = createProvider();
      await provider.chat(messagesWithToolResult, defaultOptions);

      expect(lastRequestBody).toBeDefined();
      const sentMessages = lastRequestBody!.messages as Array<Record<string, unknown>>;

      // First message is user text
      expect(sentMessages[0]).toEqual({ role: 'user', content: 'What is the weather?' });

      // Second is assistant with tool_calls
      expect(sentMessages[1].role).toBe('assistant');
      const toolCalls = (sentMessages[1] as Record<string, unknown>).tool_calls as Array<Record<string, unknown>>;
      expect(toolCalls).toHaveLength(1);
      expect((toolCalls[0].function as Record<string, unknown>).name).toBe('get_weather');

      // Third is tool result
      expect(sentMessages[2]).toEqual({
        role: 'tool',
        tool_call_id: 'call_abc123',
        content: '72°F and sunny',
      });
    });
  });

  describe('chatStream()', () => {
    it('should yield text_delta chunks for streamed text', async () => {
      mockHandler = (_req, res) => {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        });
        res.write(makeStreamChunks([
          { content: 'Hello' },
          { content: ', world!' },
          { finish_reason: 'stop' },
        ]));
        res.end();
      };

      const provider = createProvider();
      const chunks: Array<{ type: string; text?: string }> = [];

      for await (const chunk of provider.chatStream(defaultMessages, defaultOptions)) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual([
        { type: 'text_delta', text: 'Hello' },
        { type: 'text_delta', text: ', world!' },
        { type: 'message_stop' },
      ]);
    });

    it('should yield tool_use_start and tool_input_delta for streamed tool calls', async () => {
      mockHandler = (_req, res) => {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        });
        res.write(makeStreamChunks([
          {
            tool_calls: [{
              index: 0,
              id: 'call_stream1',
              type: 'function',
              function: { name: 'get_weather', arguments: '' },
            }],
          },
          {
            tool_calls: [{
              index: 0,
              function: { arguments: '{"loc' },
            }],
          },
          {
            tool_calls: [{
              index: 0,
              function: { arguments: 'ation":"NYC"}' },
            }],
          },
          { finish_reason: 'tool_calls' },
        ]));
        res.end();
      };

      const provider = createProvider();
      const chunks: Array<{ type: string; toolName?: string; toolInput?: string }> = [];

      for await (const chunk of provider.chatStream(defaultMessages, defaultOptions)) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual([
        { type: 'tool_use_start', toolName: 'get_weather' },
        { type: 'tool_input_delta', toolInput: '{"loc' },
        { type: 'tool_input_delta', toolInput: 'ation":"NYC"}' },
        { type: 'message_stop' },
      ]);
    });
  });

  describe('DeepSeek base URL override', () => {
    it('should use custom base URL for DeepSeek compatibility', async () => {
      const provider = new OpenAIProvider({
        apiKey: 'deepseek-test-key',
        baseUrl,
        providerName: 'deepseek',
        maxRetries: 0,
      });

      expect(provider.name).toBe('deepseek');

      const response = await provider.chat(defaultMessages, {
        model: 'deepseek-chat',
        maxTokens: 1024,
      });

      expect(response.content).toHaveLength(1);
      expect(lastRequestBody).toBeDefined();
      expect(lastRequestBody!.model).toBe('deepseek-chat');
    });

    it('should send requests to the custom base URL', async () => {
      let requestReceived = false;
      mockHandler = (_req, res) => {
        requestReceived = true;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(makeCompletion({ model: 'deepseek-chat' })));
      };

      const provider = new OpenAIProvider({
        apiKey: 'deepseek-test-key',
        baseUrl,
        providerName: 'deepseek',
        maxRetries: 0,
      });

      await provider.chat(defaultMessages, {
        model: 'deepseek-chat',
        maxTokens: 512,
      });

      expect(requestReceived).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should mark rate limit errors as retryable', async () => {
      mockHandler = (_req, res) => {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: {
            message: 'Rate limit exceeded',
            type: 'rate_limit_exceeded',
            code: 'rate_limit_exceeded',
          },
        }));
      };

      const provider = createProvider();

      try {
        await provider.chat(defaultMessages, defaultOptions);
        expect.fail('Should have thrown');
      } catch (caughtError: unknown) {
        expect(caughtError).toBeInstanceOf(ProviderError);
        const providerErr = caughtError as ProviderError;
        expect(providerErr.retryable).toBe(true);
        expect(providerErr.provider).toBe('openai');
        expect(providerErr.message).toContain('Rate limited');
      }
    });

    it('should mark auth errors as non-retryable', async () => {
      mockHandler = (_req, res) => {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: {
            message: 'Incorrect API key provided',
            type: 'invalid_request_error',
            code: 'invalid_api_key',
          },
        }));
      };

      const provider = createProvider();

      try {
        await provider.chat(defaultMessages, defaultOptions);
        expect.fail('Should have thrown');
      } catch (caughtError: unknown) {
        expect(caughtError).toBeInstanceOf(ProviderError);
        const providerErr = caughtError as ProviderError;
        expect(providerErr.retryable).toBe(false);
        expect(providerErr.provider).toBe('openai');
        expect(providerErr.message).toContain('Authentication failed');
      }
    });

    it('should mark server errors as retryable', async () => {
      mockHandler = (_req, res) => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: {
            message: 'Internal server error',
            type: 'server_error',
          },
        }));
      };

      const provider = createProvider();

      try {
        await provider.chat(defaultMessages, defaultOptions);
        expect.fail('Should have thrown');
      } catch (caughtError: unknown) {
        expect(caughtError).toBeInstanceOf(ProviderError);
        const providerErr = caughtError as ProviderError;
        expect(providerErr.retryable).toBe(true);
      }
    });

    it('should mark stream rate limit errors as retryable', async () => {
      mockHandler = (_req, res) => {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: {
            message: 'Rate limit exceeded',
            type: 'rate_limit_exceeded',
            code: 'rate_limit_exceeded',
          },
        }));
      };

      const provider = createProvider();

      try {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _chunk of provider.chatStream(defaultMessages, defaultOptions)) {
          // Should not yield any chunks
        }
        expect.fail('Should have thrown');
      } catch (caughtError: unknown) {
        expect(caughtError).toBeInstanceOf(ProviderError);
        const providerErr = caughtError as ProviderError;
        expect(providerErr.retryable).toBe(true);
      }
    });
  });

  describe('countTokens()', () => {
    it('should return a token count for text', () => {
      const provider = createProvider();
      const tokenCount = provider.countTokens('Hello, world!');
      expect(tokenCount).toBeGreaterThan(0);
      expect(typeof tokenCount).toBe('number');
    });

    it('should return 0 for empty text', () => {
      const provider = createProvider();
      expect(provider.countTokens('')).toBe(0);
    });
  });

  describe('provider name', () => {
    it('should default to openai', () => {
      const provider = createProvider();
      expect(provider.name).toBe('openai');
    });

    it('should accept a custom provider name', () => {
      const provider = createProvider({ providerName: 'deepseek' });
      expect(provider.name).toBe('deepseek');
    });
  });
});
