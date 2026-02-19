/**
 * Unit tests for the Gemini provider.
 * Stubs global fetch to simulate the Gemini REST API.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GeminiProvider } from '../../../src/providers/gemini.js';
import { ProviderError } from '../../../src/errors.js';
import { MODEL_PRICING } from '../../../src/cost/pricing.js';
import { selectModel } from '../../../src/providers/router.js';
import type { ChatOptions, Message, ToolDefinition } from '../../../src/types/index.js';
import type { GeminiGenerateContentResponse } from '../../../src/providers/gemini-types.js';

/** Build a minimal successful Gemini API response */
function buildGeminiTextResponse(
  text: string,
  finishReason: string = 'STOP',
): GeminiGenerateContentResponse {
  return {
    candidates: [
      {
        content: {
          role: 'model',
          parts: [{ text }],
        },
        finishReason,
        index: 0,
      },
    ],
    usageMetadata: {
      promptTokenCount: 10,
      candidatesTokenCount: 20,
      totalTokenCount: 30,
    },
  };
}

/** Build a Gemini API response with a function call */
function buildGeminiFunctionCallResponse(
  functionName: string,
  functionArgs: Record<string, unknown>,
): GeminiGenerateContentResponse {
  return {
    candidates: [
      {
        content: {
          role: 'model',
          parts: [
            {
              functionCall: {
                name: functionName,
                args: functionArgs,
              },
            },
          ],
        },
        finishReason: 'STOP',
        index: 0,
      },
    ],
    usageMetadata: {
      promptTokenCount: 15,
      candidatesTokenCount: 25,
      totalTokenCount: 40,
    },
  };
}

const defaultOptions: ChatOptions = {
  model: 'gemini-2.0-flash',
  maxTokens: 1024,
};

const defaultMessages: Message[] = [
  { role: 'user', content: 'Hello, Gemini!' },
];

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('GeminiProvider', () => {
  describe('constructor', () => {
    it('sets provider name to "gemini"', () => {
      const provider = new GeminiProvider({ apiKey: 'test-key' });
      expect(provider.name).toBe('gemini');
    });
  });

  describe('chat', () => {
    it('sends correct request to Gemini API', async () => {
      let capturedUrl = '';
      let capturedBody = '';

      vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
        capturedUrl = typeof url === 'string' ? url : url.toString();
        capturedBody = typeof init?.body === 'string' ? init.body : '';
        return new Response(JSON.stringify(buildGeminiTextResponse('Hello!')), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      const provider = new GeminiProvider({ apiKey: 'test-key-123' });
      await provider.chat(defaultMessages, defaultOptions);

      expect(capturedUrl).toContain('/models/gemini-2.0-flash:generateContent');
      expect(capturedUrl).toContain('key=test-key-123');

      const parsedBody = JSON.parse(capturedBody) as Record<string, unknown>;
      expect(parsedBody).toHaveProperty('contents');
      expect(parsedBody).toHaveProperty('generationConfig');
    });

    it('parses text response correctly', async () => {
      vi.stubGlobal('fetch', async () => {
        return new Response(
          JSON.stringify(buildGeminiTextResponse('Hello from Gemini!')),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      });

      const provider = new GeminiProvider({ apiKey: 'test-key' });
      const response = await provider.chat(defaultMessages, defaultOptions);

      expect(response.content).toHaveLength(1);
      expect(response.content[0].type).toBe('text');
      expect(response.content[0].text).toBe('Hello from Gemini!');
      expect(response.model).toBe('gemini-2.0-flash');
      expect(response.usage.inputTokens).toBe(10);
      expect(response.usage.outputTokens).toBe(20);
      expect(response.stopReason).toBe('end_turn');
    });

    it('parses tool call response correctly', async () => {
      vi.stubGlobal('fetch', async () => {
        return new Response(
          JSON.stringify(
            buildGeminiFunctionCallResponse('get_weather', { city: 'Tokyo' }),
          ),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      });

      const provider = new GeminiProvider({ apiKey: 'test-key' });
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
        tools,
      });

      expect(response.content).toHaveLength(1);
      expect(response.content[0].type).toBe('tool_use');
      expect(response.content[0].name).toBe('get_weather');
      expect(response.content[0].input).toEqual({ city: 'Tokyo' });
      expect(response.stopReason).toBe('tool_use');
    });

    it('maps system prompt to systemInstruction', async () => {
      let capturedBody = '';

      vi.stubGlobal('fetch', async (_url: string | URL | Request, init?: RequestInit) => {
        capturedBody = typeof init?.body === 'string' ? init.body : '';
        return new Response(
          JSON.stringify(buildGeminiTextResponse('Response')),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      });

      const provider = new GeminiProvider({ apiKey: 'test-key' });
      await provider.chat(defaultMessages, {
        ...defaultOptions,
        systemPrompt: 'You are a helpful assistant.',
      });

      const parsedBody = JSON.parse(capturedBody) as Record<string, unknown>;
      expect(parsedBody).toHaveProperty('systemInstruction');
      const sysInstruction = parsedBody.systemInstruction as { role: string; parts: Array<{ text: string }> };
      expect(sysInstruction.parts[0].text).toBe('You are a helpful assistant.');
    });

    it('maps tools to functionDeclarations format', async () => {
      let capturedBody = '';

      vi.stubGlobal('fetch', async (_url: string | URL | Request, init?: RequestInit) => {
        capturedBody = typeof init?.body === 'string' ? init.body : '';
        return new Response(
          JSON.stringify(buildGeminiTextResponse('Response')),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      });

      const provider = new GeminiProvider({ apiKey: 'test-key' });
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
          functionDeclarations: Array<{
            name: string;
            description: string;
            parameters: Record<string, unknown>;
          }>;
        }>;
      };
      expect(parsedBody.tools).toHaveLength(1);
      const declarations = parsedBody.tools![0].functionDeclarations;
      expect(declarations).toHaveLength(1);
      expect(declarations[0].name).toBe('search');
      expect(declarations[0].description).toBe('Search the web');
      expect(declarations[0].parameters).toHaveProperty('properties');
    });
  });

  describe('error handling', () => {
    it('throws ProviderError with retryable flag on rate limit (429)', async () => {
      vi.stubGlobal('fetch', async () => {
        return new Response(
          JSON.stringify({ error: { code: 429, message: 'Rate limited', status: 'RESOURCE_EXHAUSTED' } }),
          { status: 429, headers: { 'Content-Type': 'application/json' } },
        );
      });

      const provider = new GeminiProvider({ apiKey: 'test-key' });

      try {
        await provider.chat(defaultMessages, defaultOptions);
        expect.fail('Should have thrown');
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(ProviderError);
        const providerError = error as ProviderError;
        expect(providerError.retryable).toBe(true);
        expect(providerError.provider).toBe('gemini');
      }
    });

    it('throws non-retryable ProviderError on auth failure (401)', async () => {
      vi.stubGlobal('fetch', async () => {
        return new Response(
          JSON.stringify({ error: { code: 401, message: 'Invalid API key', status: 'UNAUTHENTICATED' } }),
          { status: 401, headers: { 'Content-Type': 'application/json' } },
        );
      });

      const provider = new GeminiProvider({ apiKey: 'bad-key' });

      try {
        await provider.chat(defaultMessages, defaultOptions);
        expect.fail('Should have thrown');
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(ProviderError);
        const providerError = error as ProviderError;
        expect(providerError.retryable).toBe(false);
        expect(providerError.message).toContain('Authentication failed');
      }
    });

    it('throws retryable ProviderError on network error', async () => {
      vi.stubGlobal('fetch', async () => {
        throw new TypeError('fetch failed: network error');
      });

      const provider = new GeminiProvider({ apiKey: 'test-key' });

      try {
        await provider.chat(defaultMessages, defaultOptions);
        expect.fail('Should have thrown');
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(ProviderError);
        const providerError = error as ProviderError;
        expect(providerError.retryable).toBe(true);
        expect(providerError.message).toContain('Network error');
      }
    });
  });

  describe('stop reason mapping', () => {
    it('maps STOP to end_turn', async () => {
      vi.stubGlobal('fetch', async () => {
        return new Response(
          JSON.stringify(buildGeminiTextResponse('Done', 'STOP')),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      });

      const provider = new GeminiProvider({ apiKey: 'test-key' });
      const response = await provider.chat(defaultMessages, defaultOptions);
      expect(response.stopReason).toBe('end_turn');
    });

    it('maps MAX_TOKENS to max_tokens', async () => {
      vi.stubGlobal('fetch', async () => {
        return new Response(
          JSON.stringify(buildGeminiTextResponse('Truncated', 'MAX_TOKENS')),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      });

      const provider = new GeminiProvider({ apiKey: 'test-key' });
      const response = await provider.chat(defaultMessages, defaultOptions);
      expect(response.stopReason).toBe('max_tokens');
    });

    it('maps SAFETY to end_turn', async () => {
      vi.stubGlobal('fetch', async () => {
        return new Response(
          JSON.stringify(buildGeminiTextResponse('Blocked', 'SAFETY')),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      });

      const provider = new GeminiProvider({ apiKey: 'test-key' });
      const response = await provider.chat(defaultMessages, defaultOptions);
      expect(response.stopReason).toBe('end_turn');
    });
  });

  describe('streaming', () => {
    it('yields correct chunks from SSE stream', async () => {
      const sseData = [
        'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"Hello"}]},"index":0}]}\n\n',
        'data: {"candidates":[{"content":{"role":"model","parts":[{"text":" World"}]},"index":0}]}\n\n',
        'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"!"}]},"finishReason":"STOP","index":0}]}\n\n',
      ];

      vi.stubGlobal('fetch', async () => {
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            for (const chunk of sseData) {
              controller.enqueue(encoder.encode(chunk));
            }
            controller.close();
          },
        });

        return new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      });

      const provider = new GeminiProvider({ apiKey: 'test-key' });
      const chunks: Array<{ type: string; text?: string }> = [];

      for await (const chunk of provider.chatStream(defaultMessages, defaultOptions)) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThanOrEqual(3);

      const textChunks = chunks.filter((chunkItem) => chunkItem.type === 'text_delta');
      expect(textChunks).toHaveLength(3);
      expect(textChunks[0].text).toBe('Hello');
      expect(textChunks[1].text).toBe(' World');
      expect(textChunks[2].text).toBe('!');

      const stopChunks = chunks.filter((chunkItem) => chunkItem.type === 'message_stop');
      expect(stopChunks.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('token counting', () => {
    it('counts tokens for a text string', () => {
      const provider = new GeminiProvider({ apiKey: 'test-key' });
      const tokenCount = provider.countTokens('Hello, world!');
      expect(tokenCount).toBeGreaterThan(0);
      expect(typeof tokenCount).toBe('number');
    });

    it('returns 0 for empty string', () => {
      const provider = new GeminiProvider({ apiKey: 'test-key' });
      expect(provider.countTokens('')).toBe(0);
    });
  });
});

describe('Gemini in pricing table', () => {
  it('gemini-2.0-flash exists and is small tier', () => {
    const pricing = MODEL_PRICING['gemini-2.0-flash'];
    expect(pricing).toBeDefined();
    expect(pricing.tier).toBe('small');
    expect(pricing.contextWindow).toBe(1_000_000);
  });

  it('gemini-2.0-pro exists and is medium tier', () => {
    const pricing = MODEL_PRICING['gemini-2.0-pro'];
    expect(pricing).toBeDefined();
    expect(pricing.tier).toBe('medium');
    expect(pricing.contextWindow).toBe(1_000_000);
  });

  it('gemini-1.5-pro exists and is medium tier', () => {
    const pricing = MODEL_PRICING['gemini-1.5-pro'];
    expect(pricing).toBeDefined();
    expect(pricing.tier).toBe('medium');
    expect(pricing.contextWindow).toBe(2_000_000);
  });
});

describe('Gemini in router', () => {
  it('router selects gemini-2.0-flash for small tier when only gemini is enabled', () => {
    const selection = selectModel('small', ['gemini']);
    expect(selection.model).toBe('gemini-2.0-flash');
    expect(selection.provider).toBe('gemini');
  });

  it('router selects gemini-2.0-pro for medium tier when only gemini is enabled', () => {
    const selection = selectModel('medium', ['gemini']);
    expect(selection.model).toBe('gemini-2.0-pro');
    expect(selection.provider).toBe('gemini');
  });

  it('router prefers anthropic over gemini for small tier', () => {
    const selection = selectModel('small', ['anthropic', 'gemini']);
    expect(selection.provider).toBe('anthropic');
  });
});
