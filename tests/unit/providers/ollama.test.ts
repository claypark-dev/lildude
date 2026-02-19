/**
 * Unit tests for the Ollama provider.
 * Stubs global fetch to simulate the Ollama REST API.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OllamaProvider } from '../../../src/providers/ollama.js';
import { ProviderError } from '../../../src/errors.js';
import { MODEL_PRICING } from '../../../src/cost/pricing.js';
import { selectModel } from '../../../src/providers/router.js';
import type { ChatOptions, Message, ToolDefinition } from '../../../src/types/index.js';
import type { OllamaChatResponse } from '../../../src/providers/ollama-types.js';

/** Build a minimal successful Ollama chat response */
function buildOllamaTextResponse(
  text: string,
  doneReason: string = 'stop',
): OllamaChatResponse {
  return {
    model: 'llama3.2',
    message: {
      role: 'assistant',
      content: text,
    },
    done: true,
    done_reason: doneReason,
    prompt_eval_count: 12,
    eval_count: 24,
  };
}

/** Build an Ollama chat response with tool calls */
function buildOllamaToolCallResponse(
  toolName: string,
  toolArgs: Record<string, unknown>,
): OllamaChatResponse {
  return {
    model: 'qwen2.5',
    message: {
      role: 'assistant',
      content: '',
      tool_calls: [
        {
          function: {
            name: toolName,
            arguments: toolArgs,
          },
        },
      ],
    },
    done: true,
    done_reason: 'stop',
    prompt_eval_count: 18,
    eval_count: 30,
  };
}

const defaultOptions: ChatOptions = {
  model: 'ollama/llama3.2',
  maxTokens: 1024,
};

const defaultMessages: Message[] = [
  { role: 'user', content: 'Hello, Ollama!' },
];

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('OllamaProvider', () => {
  describe('constructor', () => {
    it('sets provider name to "ollama"', () => {
      const provider = new OllamaProvider();
      expect(provider.name).toBe('ollama');
    });

    it('accepts a custom baseUrl', () => {
      const provider = new OllamaProvider({ baseUrl: 'http://gpu-box:11434' });
      expect(provider.name).toBe('ollama');
    });
  });

  describe('chat', () => {
    it('sends correct request to Ollama API', async () => {
      let capturedUrl = '';
      let capturedBody = '';

      vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
        capturedUrl = typeof url === 'string' ? url : url.toString();
        capturedBody = typeof init?.body === 'string' ? init.body : '';
        return new Response(JSON.stringify(buildOllamaTextResponse('Hi there!')), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      const provider = new OllamaProvider();
      await provider.chat(defaultMessages, defaultOptions);

      expect(capturedUrl).toBe('http://localhost:11434/api/chat');

      const parsedBody = JSON.parse(capturedBody) as Record<string, unknown>;
      expect(parsedBody).toHaveProperty('model', 'llama3.2');
      expect(parsedBody).toHaveProperty('stream', false);
      expect(parsedBody).toHaveProperty('messages');
    });

    it('strips ollama/ prefix from model name in request', async () => {
      let capturedBody = '';

      vi.stubGlobal('fetch', async (_url: string | URL | Request, init?: RequestInit) => {
        capturedBody = typeof init?.body === 'string' ? init.body : '';
        return new Response(JSON.stringify(buildOllamaTextResponse('OK')), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      const provider = new OllamaProvider();
      await provider.chat(defaultMessages, { ...defaultOptions, model: 'ollama/qwen2.5' });

      const parsedBody = JSON.parse(capturedBody) as Record<string, unknown>;
      expect(parsedBody).toHaveProperty('model', 'qwen2.5');
    });

    it('parses text response correctly', async () => {
      vi.stubGlobal('fetch', async () => {
        return new Response(
          JSON.stringify(buildOllamaTextResponse('Hello from Ollama!')),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      });

      const provider = new OllamaProvider();
      const response = await provider.chat(defaultMessages, defaultOptions);

      expect(response.content).toHaveLength(1);
      expect(response.content[0].type).toBe('text');
      expect(response.content[0].text).toBe('Hello from Ollama!');
      expect(response.model).toBe('ollama/llama3.2');
      expect(response.usage.inputTokens).toBe(12);
      expect(response.usage.outputTokens).toBe(24);
      expect(response.stopReason).toBe('end_turn');
    });

    it('parses tool call response correctly', async () => {
      vi.stubGlobal('fetch', async () => {
        return new Response(
          JSON.stringify(buildOllamaToolCallResponse('get_weather', { city: 'Tokyo' })),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      });

      const provider = new OllamaProvider();
      const tools: ToolDefinition[] = [
        {
          name: 'get_weather',
          description: 'Get weather for a city',
          parameters: {
            type: 'object',
            properties: { city: { type: 'string' } },
            required: ['city'],
          },
        },
      ];

      const response = await provider.chat(defaultMessages, {
        ...defaultOptions,
        model: 'ollama/qwen2.5',
        tools,
      });

      expect(response.content.some((b) => b.type === 'tool_use')).toBe(true);
      const toolBlock = response.content.find((b) => b.type === 'tool_use');
      expect(toolBlock?.name).toBe('get_weather');
      expect(toolBlock?.input).toEqual({ city: 'Tokyo' });
      expect(response.stopReason).toBe('tool_use');
    });

    it('sends system prompt as first message', async () => {
      let capturedBody = '';

      vi.stubGlobal('fetch', async (_url: string | URL | Request, init?: RequestInit) => {
        capturedBody = typeof init?.body === 'string' ? init.body : '';
        return new Response(
          JSON.stringify(buildOllamaTextResponse('Response')),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      });

      const provider = new OllamaProvider();
      await provider.chat(defaultMessages, {
        ...defaultOptions,
        systemPrompt: 'You are a helpful assistant.',
      });

      const parsedBody = JSON.parse(capturedBody) as {
        messages: Array<{ role: string; content: string }>;
      };
      expect(parsedBody.messages[0].role).toBe('system');
      expect(parsedBody.messages[0].content).toBe('You are a helpful assistant.');
    });

    it('sends tools in OpenAI-compatible format', async () => {
      let capturedBody = '';

      vi.stubGlobal('fetch', async (_url: string | URL | Request, init?: RequestInit) => {
        capturedBody = typeof init?.body === 'string' ? init.body : '';
        return new Response(
          JSON.stringify(buildOllamaTextResponse('Response')),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      });

      const provider = new OllamaProvider();
      const tools: ToolDefinition[] = [
        {
          name: 'search',
          description: 'Search the web',
          parameters: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
          },
        },
      ];

      await provider.chat(defaultMessages, { ...defaultOptions, tools });

      const parsedBody = JSON.parse(capturedBody) as {
        tools?: Array<{
          type: string;
          function: {
            name: string;
            description: string;
            parameters: Record<string, unknown>;
          };
        }>;
      };
      expect(parsedBody.tools).toHaveLength(1);
      expect(parsedBody.tools![0].type).toBe('function');
      expect(parsedBody.tools![0].function.name).toBe('search');
    });
  });

  describe('message conversion', () => {
    it('converts string content messages', async () => {
      let capturedBody = '';

      vi.stubGlobal('fetch', async (_url: string | URL | Request, init?: RequestInit) => {
        capturedBody = typeof init?.body === 'string' ? init.body : '';
        return new Response(
          JSON.stringify(buildOllamaTextResponse('OK')),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      });

      const provider = new OllamaProvider();
      const messages: Message[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
        { role: 'user', content: 'Bye' },
      ];

      await provider.chat(messages, defaultOptions);

      const parsedBody = JSON.parse(capturedBody) as {
        messages: Array<{ role: string; content: string }>;
      };
      expect(parsedBody.messages).toHaveLength(3);
      expect(parsedBody.messages[0]).toEqual({ role: 'user', content: 'Hello' });
      expect(parsedBody.messages[1]).toEqual({ role: 'assistant', content: 'Hi there' });
      expect(parsedBody.messages[2]).toEqual({ role: 'user', content: 'Bye' });
    });

    it('converts content blocks with tool_use', async () => {
      let capturedBody = '';

      vi.stubGlobal('fetch', async (_url: string | URL | Request, init?: RequestInit) => {
        capturedBody = typeof init?.body === 'string' ? init.body : '';
        return new Response(
          JSON.stringify(buildOllamaTextResponse('OK')),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      });

      const provider = new OllamaProvider();
      const messages: Message[] = [
        { role: 'user', content: 'What is the weather?' },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Let me check.' },
            {
              type: 'tool_use',
              id: 'call_123',
              name: 'get_weather',
              input: { city: 'NYC' },
            },
          ],
        },
      ];

      await provider.chat(messages, defaultOptions);

      const parsedBody = JSON.parse(capturedBody) as {
        messages: Array<{
          role: string;
          content: string;
          tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }>;
        }>;
      };
      const assistantMsg = parsedBody.messages[1];
      expect(assistantMsg.role).toBe('assistant');
      expect(assistantMsg.content).toBe('Let me check.');
      expect(assistantMsg.tool_calls).toHaveLength(1);
      expect(assistantMsg.tool_calls![0].function.name).toBe('get_weather');
    });

    it('converts content blocks with tool_result', async () => {
      let capturedBody = '';

      vi.stubGlobal('fetch', async (_url: string | URL | Request, init?: RequestInit) => {
        capturedBody = typeof init?.body === 'string' ? init.body : '';
        return new Response(
          JSON.stringify(buildOllamaTextResponse('OK')),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      });

      const provider = new OllamaProvider();
      const messages: Message[] = [
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              toolUseId: 'call_123',
              content: '{"temp": 72}',
            },
          ],
        },
      ];

      await provider.chat(messages, defaultOptions);

      const parsedBody = JSON.parse(capturedBody) as {
        messages: Array<{ role: string; content: string }>;
      };
      const toolMsg = parsedBody.messages[0];
      expect(toolMsg.role).toBe('tool');
      expect(toolMsg.content).toBe('{"temp": 72}');
    });
  });

  describe('error handling', () => {
    it('throws retryable ProviderError on connection refused', async () => {
      vi.stubGlobal('fetch', async () => {
        throw new TypeError('fetch failed: ECONNREFUSED');
      });

      const provider = new OllamaProvider();

      try {
        await provider.chat(defaultMessages, defaultOptions);
        expect.fail('Should have thrown');
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(ProviderError);
        const providerError = error as ProviderError;
        expect(providerError.retryable).toBe(true);
        expect(providerError.provider).toBe('ollama');
        expect(providerError.message).toContain('Connection refused');
      }
    });

    it('throws non-retryable ProviderError on model not found (404)', async () => {
      vi.stubGlobal('fetch', async () => {
        return new Response(
          JSON.stringify({ error: 'model "bad-model" not found' }),
          { status: 404, headers: { 'Content-Type': 'application/json' } },
        );
      });

      const provider = new OllamaProvider();

      try {
        await provider.chat(defaultMessages, defaultOptions);
        expect.fail('Should have thrown');
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(ProviderError);
        const providerError = error as ProviderError;
        expect(providerError.retryable).toBe(false);
        expect(providerError.message).toContain('Model not found');
      }
    });

    it('throws retryable ProviderError on 500 server error', async () => {
      vi.stubGlobal('fetch', async () => {
        return new Response(
          JSON.stringify({ error: 'internal server error' }),
          { status: 500, headers: { 'Content-Type': 'application/json' } },
        );
      });

      const provider = new OllamaProvider();

      try {
        await provider.chat(defaultMessages, defaultOptions);
        expect.fail('Should have thrown');
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(ProviderError);
        const providerError = error as ProviderError;
        expect(providerError.retryable).toBe(true);
      }
    });

    it('wraps unknown errors as non-retryable ProviderError', async () => {
      vi.stubGlobal('fetch', async () => {
        throw new Error('Something unexpected');
      });

      const provider = new OllamaProvider();

      try {
        await provider.chat(defaultMessages, defaultOptions);
        expect.fail('Should have thrown');
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(ProviderError);
        const providerError = error as ProviderError;
        expect(providerError.retryable).toBe(false);
        expect(providerError.message).toContain('unexpected error');
      }
    });
  });

  describe('stop reason mapping', () => {
    it('maps "stop" done_reason to end_turn', async () => {
      vi.stubGlobal('fetch', async () => {
        return new Response(
          JSON.stringify(buildOllamaTextResponse('Done', 'stop')),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      });

      const provider = new OllamaProvider();
      const response = await provider.chat(defaultMessages, defaultOptions);
      expect(response.stopReason).toBe('end_turn');
    });

    it('maps "length" done_reason to max_tokens', async () => {
      vi.stubGlobal('fetch', async () => {
        return new Response(
          JSON.stringify(buildOllamaTextResponse('Truncated', 'length')),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      });

      const provider = new OllamaProvider();
      const response = await provider.chat(defaultMessages, defaultOptions);
      expect(response.stopReason).toBe('max_tokens');
    });
  });

  describe('streaming', () => {
    it('yields correct chunks from NDJSON stream', async () => {
      const ndjsonLines = [
        JSON.stringify({ model: 'llama3.2', message: { role: 'assistant', content: 'Hello' }, done: false }),
        JSON.stringify({ model: 'llama3.2', message: { role: 'assistant', content: ' World' }, done: false }),
        JSON.stringify({ model: 'llama3.2', message: { role: 'assistant', content: '!' }, done: false }),
        JSON.stringify({ model: 'llama3.2', message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', prompt_eval_count: 10, eval_count: 15 }),
      ];

      vi.stubGlobal('fetch', async () => {
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            for (const line of ndjsonLines) {
              controller.enqueue(encoder.encode(line + '\n'));
            }
            controller.close();
          },
        });

        return new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'application/x-ndjson' },
        });
      });

      const provider = new OllamaProvider();
      const chunks: Array<{ type: string; text?: string }> = [];

      for await (const chunk of provider.chatStream(defaultMessages, defaultOptions)) {
        chunks.push(chunk);
      }

      const textChunks = chunks.filter((c) => c.type === 'text_delta');
      expect(textChunks).toHaveLength(3);
      expect(textChunks[0].text).toBe('Hello');
      expect(textChunks[1].text).toBe(' World');
      expect(textChunks[2].text).toBe('!');

      const stopChunks = chunks.filter((c) => c.type === 'message_stop');
      expect(stopChunks).toHaveLength(1);
    });

    it('yields tool use events from stream', async () => {
      const ndjsonLines = [
        JSON.stringify({
          model: 'qwen2.5',
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [{ function: { name: 'get_time', arguments: { timezone: 'UTC' } } }],
          },
          done: false,
        }),
        JSON.stringify({
          model: 'qwen2.5',
          message: { role: 'assistant', content: '' },
          done: true,
          done_reason: 'stop',
        }),
      ];

      vi.stubGlobal('fetch', async () => {
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            for (const line of ndjsonLines) {
              controller.enqueue(encoder.encode(line + '\n'));
            }
            controller.close();
          },
        });

        return new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'application/x-ndjson' },
        });
      });

      const provider = new OllamaProvider();
      const chunks: Array<{ type: string; toolName?: string; toolInput?: string }> = [];

      for await (const chunk of provider.chatStream(defaultMessages, defaultOptions)) {
        chunks.push(chunk);
      }

      const toolStartChunks = chunks.filter((c) => c.type === 'tool_use_start');
      expect(toolStartChunks).toHaveLength(1);
      expect(toolStartChunks[0].toolName).toBe('get_time');

      const toolInputChunks = chunks.filter((c) => c.type === 'tool_input_delta');
      expect(toolInputChunks).toHaveLength(1);
      expect(toolInputChunks[0].toolInput).toBe(JSON.stringify({ timezone: 'UTC' }));
    });

    it('throws retryable error on stream connection failure', async () => {
      vi.stubGlobal('fetch', async () => {
        throw new TypeError('fetch failed: network error');
      });

      const provider = new OllamaProvider();

      try {
        // Must consume the generator to trigger the error
        const gen = provider.chatStream(defaultMessages, defaultOptions);
        await gen.next();
        expect.fail('Should have thrown');
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(ProviderError);
        const providerError = error as ProviderError;
        expect(providerError.retryable).toBe(true);
      }
    });
  });

  describe('token counting', () => {
    it('counts tokens for a text string', () => {
      const provider = new OllamaProvider();
      const tokenCount = provider.countTokens('Hello, world!');
      expect(tokenCount).toBeGreaterThan(0);
      expect(typeof tokenCount).toBe('number');
    });

    it('returns 0 for empty string', () => {
      const provider = new OllamaProvider();
      expect(provider.countTokens('')).toBe(0);
    });
  });
});

describe('Ollama in pricing table', () => {
  it('ollama/llama3.2 exists with zero cost and small tier', () => {
    const pricing = MODEL_PRICING['ollama/llama3.2'];
    expect(pricing).toBeDefined();
    expect(pricing.tier).toBe('small');
    expect(pricing.inputPer1k).toBe(0);
    expect(pricing.outputPer1k).toBe(0);
    expect(pricing.contextWindow).toBe(8192);
  });

  it('ollama/qwen2.5 exists with zero cost and small tier', () => {
    const pricing = MODEL_PRICING['ollama/qwen2.5'];
    expect(pricing).toBeDefined();
    expect(pricing.tier).toBe('small');
    expect(pricing.inputPer1k).toBe(0);
    expect(pricing.outputPer1k).toBe(0);
    expect(pricing.supportsTools).toBe(true);
  });
});

describe('Ollama in router', () => {
  it('router selects ollama/llama3.2 for small tier when only ollama is enabled', () => {
    const selection = selectModel('small', ['ollama']);
    expect(selection.model).toBe('ollama/llama3.2');
    expect(selection.provider).toBe('ollama');
    expect(selection.estimatedCostUsd).toBe(0);
  });

  it('router prefers cloud providers over ollama for small tier', () => {
    const selection = selectModel('small', ['anthropic', 'ollama']);
    expect(selection.provider).toBe('anthropic');
    expect(selection.model).toBe('claude-haiku-4-5-20251001');
  });

  it('ollama is last preference in small tier', () => {
    // When only deepseek and ollama are enabled, deepseek comes first
    const selection = selectModel('small', ['deepseek', 'ollama']);
    expect(selection.provider).toBe('deepseek');
    expect(selection.model).toBe('deepseek-chat');
  });
});
