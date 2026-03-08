/**
 * Integration tests for context window management and wave performance.
 * Validates that the context builder stays within token budgets after
 * heavy usage, wave matching scales to 1000+ waves efficiently,
 * chat refresh loads history without blowing the context budget, and
 * rapid WebSocket reconnections do not corrupt conversation state.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { startApp, type AppContext } from '../../src/index.js';
import { ConfigSchema } from '../../src/config/schema.js';
import { createMockProvider, type MockProvider } from '../mocks/provider.js';
import {
  clearRegistry,
  registerWave,
  matchWave,
  getAllWaves,
} from '../../src/waves/registry.js';
import { createConversation } from '../../src/persistence/conversations.js';
import {
  appendConversationLog,
  getConversationLogs,
} from '../../src/persistence/conversation-logs.js';
import { buildContext } from '../../src/context/manager.js';
import { createDatabase, type DatabaseManager } from '../../src/persistence/db.js';
import { generateApiKey, storeApiKey } from '../../src/persistence/api-keys.js';
import type { Wave, WaveManifest } from '../../src/types/index.js';
import type { InjectOptions } from 'fastify';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'src', 'persistence', 'migrations');

/** Default token budget used by the context manager. */
const DEFAULT_TOKEN_BUDGET = 8000;

/** Create a minimal test config. */
function createTestConfig() {
  return ConfigSchema.parse({
    channels: { webchat: { enabled: false } },
    security: { level: 3 },
  });
}

/**
 * Build a minimal Wave object that satisfies the interface.
 * Each wave gets a unique name and a set of trigger keywords.
 */
function buildMockWave(name: string, triggers: string[]): Wave {
  const manifest: WaveManifest = {
    name,
    version: '1.0.0',
    description: `Mock wave: ${name}`,
    author: 'test',
    permissions: {
      domains: [],
      shell: [],
      directories: [],
      requiresBrowser: false,
      requiresOAuth: [],
    },
    triggers,
    deterministic: true,
    tools: [],
    minTier: 'basic',
    entryPoint: 'index.js',
  };

  return {
    manifest,
    async plan() {
      return {
        steps: [],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: {},
      };
    },
    async execute() {
      return { success: true, output: 'ok' };
    },
  };
}

describe('Context Window Management & Wave Performance E2E', () => {
  let dbManager: DatabaseManager;

  beforeEach(() => {
    dbManager = createDatabase(':memory:', MIGRATIONS_DIR);
    dbManager.runMigrations();
    clearRegistry();
  });

  afterEach(() => {
    clearRegistry();
    try {
      dbManager.close();
    } catch {
      // best-effort cleanup
    }
  });

  // ── Context Budget After Many Messages ──────────────────────────────

  describe('context builder stays within token budget after many messages', () => {
    it('totalTokens stays under 8000 after 100 user+assistant messages', async () => {
      const conversationId = 'conv-100-msgs';

      createConversation(dbManager.db, {
        id: conversationId,
        channelType: 'webchat',
        channelId: 'test-channel',
      });

      // Insert 100 message pairs (user + assistant = 200 log entries)
      for (let i = 0; i < 100; i++) {
        appendConversationLog(dbManager.db, {
          conversationId,
          role: 'user',
          content: `User message number ${i}: This is a moderately long message to simulate real conversation content with enough tokens to stress the context builder's trimming logic.`,
          tokenCount: 30,
        });
        appendConversationLog(dbManager.db, {
          conversationId,
          role: 'assistant',
          content: `Assistant reply number ${i}: Here is a helpful response that includes some detail to ensure we accumulate a meaningful number of tokens across the conversation history.`,
          tokenCount: 30,
        });
      }

      const result = await buildContext(
        dbManager.db,
        conversationId,
        'What did we discuss earlier?',
      );

      expect(result.totalTokens).toBeLessThan(DEFAULT_TOKEN_BUDGET);
      expect(result.messages.length).toBeGreaterThan(0);
      // The last message should be the current user message
      const lastMessage = result.messages[result.messages.length - 1];
      expect(lastMessage.role).toBe('user');
      expect(lastMessage.content).toContain('What did we discuss earlier?');
    });

    it('totalTokens stays under budget after 200 messages with large content', async () => {
      const conversationId = 'conv-200-large';

      createConversation(dbManager.db, {
        id: conversationId,
        channelType: 'webchat',
        channelId: 'test-channel',
      });

      // Insert 200 messages with substantial content (~100 tokens each)
      const longContent = 'The quick brown fox jumps over the lazy dog. '.repeat(10);
      for (let i = 0; i < 200; i++) {
        const role = i % 2 === 0 ? 'user' : 'assistant';
        appendConversationLog(dbManager.db, {
          conversationId,
          role,
          content: `[${i}] ${longContent}`,
          tokenCount: 100,
        });
      }

      const result = await buildContext(
        dbManager.db,
        conversationId,
        'Summarize everything.',
      );

      expect(result.totalTokens).toBeLessThan(DEFAULT_TOKEN_BUDGET);
      // Should have trimmed most of the history
      expect(result.messages.length).toBeLessThan(200);
    });

    it('custom targetTokenBudget is respected', async () => {
      const conversationId = 'conv-custom-budget';
      const customBudget = 4000;

      createConversation(dbManager.db, {
        id: conversationId,
        channelType: 'webchat',
        channelId: 'test-channel',
      });

      for (let i = 0; i < 50; i++) {
        appendConversationLog(dbManager.db, {
          conversationId,
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: `Message ${i}: Some conversation content for budget testing purposes.`,
          tokenCount: 20,
        });
      }

      const result = await buildContext(
        dbManager.db,
        conversationId,
        'Continue the conversation.',
        { targetTokenBudget: customBudget },
      );

      expect(result.totalTokens).toBeLessThan(customBudget);
    });
  });

  // ── Wave Matching Performance ────────────────────────────────────────

  describe('wave matching performance with 1000+ waves', () => {
    it('matchWave with 1000 registered waves completes in < 100ms', () => {
      // Register 1000 waves with unique trigger keywords
      for (let i = 0; i < 1000; i++) {
        const waveName = `perf-wave-${i}`;
        const triggers = [`trigger-${i}`, `keyword-${i}`, `action-${i}`];
        registerWave(waveName, buildMockWave(waveName, triggers));
      }

      expect(getAllWaves().size).toBe(1000);

      // Warm up to avoid first-call JIT overhead
      matchWave('trigger-500');

      const startTime = performance.now();
      const result = matchWave('trigger-500');
      const elapsedMs = performance.now() - startTime;

      expect(elapsedMs).toBeLessThan(100);
      expect(result).not.toBeNull();
      expect(result!.wave.manifest.name).toBe('perf-wave-500');
      expect(result!.score).toBeGreaterThan(0);
    });

    it('matchWave returns null quickly when no triggers match', () => {
      for (let i = 0; i < 1000; i++) {
        registerWave(`miss-wave-${i}`, buildMockWave(`miss-wave-${i}`, [`zzz-${i}`]));
      }

      const startTime = performance.now();
      const result = matchWave('hello world how are you');
      const elapsedMs = performance.now() - startTime;

      expect(elapsedMs).toBeLessThan(100);
      expect(result).toBeNull();
    });

    it('matchWave handles overlapping triggers across many waves correctly', () => {
      // Register 1000 waves where some share the keyword "search"
      for (let i = 0; i < 1000; i++) {
        const triggers = i < 10
          ? ['search', `specific-${i}`]
          : [`unrelated-${i}`];
        registerWave(`overlap-wave-${i}`, buildMockWave(`overlap-wave-${i}`, triggers));
      }

      const startTime = performance.now();
      const result = matchWave('search for specific-5 data');
      const elapsedMs = performance.now() - startTime;

      expect(elapsedMs).toBeLessThan(100);
      expect(result).not.toBeNull();
      // The wave with the most trigger coverage should win
      expect(result!.wave.manifest.triggers).toContain('specific-5');
    });
  });

  // ── Chat Refresh: History Load + Context Budget ──────────────────────

  describe('chat refresh loads history and context stays within budget', () => {
    it('getConversationLogs returns all stored messages in order', () => {
      const conversationId = 'conv-refresh';

      createConversation(dbManager.db, {
        id: conversationId,
        channelType: 'webchat',
        channelId: 'refresh-channel',
      });

      for (let i = 0; i < 20; i++) {
        appendConversationLog(dbManager.db, {
          conversationId,
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: `Message ${i}`,
          tokenCount: 5,
        });
      }

      const logs = getConversationLogs(dbManager.db, conversationId, 100);

      expect(logs.length).toBe(20);
      // Verify ascending order (oldest first)
      for (let i = 1; i < logs.length; i++) {
        expect(logs[i].id).toBeGreaterThan(logs[i - 1].id);
      }
      // Verify content round-trips correctly
      expect(logs[0].content).toBe('Message 0');
      expect(logs[0].role).toBe('user');
      expect(logs[19].content).toBe('Message 19');
      expect(logs[19].role).toBe('assistant');
    });

    it('buildContext after loading history keeps totalTokens within budget', async () => {
      const conversationId = 'conv-refresh-budget';

      createConversation(dbManager.db, {
        id: conversationId,
        channelType: 'webchat',
        channelId: 'refresh-channel',
      });

      // Simulate a conversation that was loaded on chat refresh
      for (let i = 0; i < 80; i++) {
        appendConversationLog(dbManager.db, {
          conversationId,
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: `Refreshed message ${i} with moderate content to test context trimming after reload.`,
          tokenCount: 25,
        });
      }

      // After refresh, user sends a new message
      const result = await buildContext(
        dbManager.db,
        conversationId,
        'I just refreshed the page. Can you catch me up?',
      );

      expect(result.totalTokens).toBeLessThan(DEFAULT_TOKEN_BUDGET);
      expect(result.systemPrompt.length).toBeGreaterThan(0);
      // Ensure at least the user message is included
      expect(result.messages.some((msg) => msg.content.includes('I just refreshed'))).toBe(true);
    });

    it('buildContext for nonexistent conversation does not throw', async () => {
      // When a user opens a fresh tab, the conversation may not exist yet
      const result = await buildContext(
        dbManager.db,
        'conv-does-not-exist',
        'Hello, first message!',
      );

      expect(result.totalTokens).toBeLessThan(DEFAULT_TOKEN_BUDGET);
      expect(result.messages.length).toBe(1);
      expect(result.messages[0].role).toBe('user');
      expect(result.messages[0].content).toBe('Hello, first message!');
    });
  });

  // ── Rapid WebSocket Reconnections ────────────────────────────────────

  describe('rapid WebSocket reconnections do not corrupt conversation state', () => {
    let appContext: AppContext | undefined;
    let mockProvider: MockProvider;
    let testApiKey: string;

    function authedInject(opts: InjectOptions) {
      return appContext!.gateway.app.inject({
        ...opts,
        headers: {
          ...opts.headers,
          authorization: `Bearer ${testApiKey}`,
        },
      });
    }

    beforeEach(async () => {
      mockProvider = createMockProvider('anthropic');
      mockProvider.setDefault({
        content: [{ type: 'text', text: 'OK' }],
        model: 'claude-haiku-4-5-20251001',
        usage: { inputTokens: 10, outputTokens: 5 },
        stopReason: 'end_turn',
      });

      const config = createTestConfig();

      appContext = await startApp({
        config,
        dbPath: ':memory:',
        migrationsDir: MIGRATIONS_DIR,
        provider: mockProvider,
        skipHardwareDetection: true,
        skipGatewayListen: true,
        skipSignalHandlers: true,
      });

      clearRegistry();

      testApiKey = generateApiKey();
      storeApiKey(appContext.dbManager.db, testApiKey, 'context-e2e-test');
    });

    afterEach(async () => {
      clearRegistry();
      if (appContext) {
        try {
          await appContext.gateway.stop();
        } catch {
          // best-effort cleanup
        }
        try {
          appContext.dbManager.close();
        } catch {
          // best-effort cleanup
        }
        appContext = undefined;
      }
    });

    it('conversation log integrity is maintained after 10 rapid reconnection simulations', async () => {
      const conversationId = 'conv-reconnect';

      createConversation(appContext!.dbManager.db, {
        id: conversationId,
        channelType: 'webchat',
        channelId: 'ws-client-1',
      });

      // Seed with initial messages
      for (let i = 0; i < 10; i++) {
        appendConversationLog(appContext!.dbManager.db, {
          conversationId,
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: `Pre-reconnect message ${i}`,
          tokenCount: 10,
        });
      }

      // Simulate 10 rapid reconnections: each time a client reconnects,
      // it requests chat.history via the REST API equivalent
      const historyRequests: Promise<unknown>[] = [];
      for (let attempt = 0; attempt < 10; attempt++) {
        historyRequests.push(
          authedInject({
            method: 'GET',
            url: '/api/v1/conversations',
          }),
        );
      }

      const responses = await Promise.all(historyRequests);

      // All requests should succeed (no corruption or crashes)
      for (const response of responses) {
        const res = response as { statusCode: number };
        expect(res.statusCode).toBe(200);
      }

      // Verify conversation logs are intact after all reconnections
      const logs = getConversationLogs(appContext!.dbManager.db, conversationId, 100);
      expect(logs.length).toBe(10);

      // Verify ordering is still correct
      for (let i = 1; i < logs.length; i++) {
        expect(logs[i].id).toBeGreaterThan(logs[i - 1].id);
      }
    });

    it('concurrent message appends during reconnection do not lose data', async () => {
      const conversationId = 'conv-concurrent-append';

      createConversation(appContext!.dbManager.db, {
        id: conversationId,
        channelType: 'webchat',
        channelId: 'ws-client-2',
      });

      // Simulate concurrent appends that might happen during rapid reconnections
      const appendPromises: Promise<unknown>[] = [];
      for (let i = 0; i < 20; i++) {
        appendPromises.push(
          Promise.resolve(
            appendConversationLog(appContext!.dbManager.db, {
              conversationId,
              role: i % 2 === 0 ? 'user' : 'assistant',
              content: `Concurrent message ${i}`,
              tokenCount: 8,
            }),
          ),
        );
      }

      await Promise.all(appendPromises);

      // All 20 messages should be stored
      const logs = getConversationLogs(appContext!.dbManager.db, conversationId, 100);
      expect(logs.length).toBe(20);

      // Verify content integrity (all messages present)
      const contents = new Set(logs.map((log) => log.content));
      for (let i = 0; i < 20; i++) {
        expect(contents.has(`Concurrent message ${i}`)).toBe(true);
      }
    });

    it('context build after rapid reconnections stays within budget', async () => {
      const conversationId = 'conv-reconnect-budget';

      createConversation(appContext!.dbManager.db, {
        id: conversationId,
        channelType: 'webchat',
        channelId: 'ws-client-3',
      });

      // Seed conversation with enough messages to stress budget
      for (let i = 0; i < 60; i++) {
        appendConversationLog(appContext!.dbManager.db, {
          conversationId,
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: `Reconnection stress message ${i}: Additional filler content to push the token count and test trimming under load.`,
          tokenCount: 25,
        });
      }

      // Simulate rapid reconnections by building context concurrently
      const contextPromises: Promise<{ totalTokens: number; messages: unknown[] }>[] = [];
      for (let attempt = 0; attempt < 5; attempt++) {
        contextPromises.push(
          buildContext(
            appContext!.dbManager.db,
            conversationId,
            `Reconnection attempt ${attempt}: what happened?`,
          ),
        );
      }

      const results = await Promise.all(contextPromises);

      // Every context build should stay within budget
      for (const result of results) {
        expect(result.totalTokens).toBeLessThan(DEFAULT_TOKEN_BUDGET);
        expect(result.messages.length).toBeGreaterThan(0);
      }
    });
  });
});
