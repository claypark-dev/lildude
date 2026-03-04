/**
 * Tests for the voice-enhanced channel wiring in startup.ts.
 * Validates that inbound audio is transcribed and outbound TTS
 * is generated when voice conditions are met.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConfigSchema } from '../../../src/config/schema.js';
import type { Config } from '../../../src/config/schema.js';
import type { ChannelAdapter, ChannelConfig, ChannelMessage, SendOptions } from '../../../src/types/index.js';
import { wireChannelsToAgentLoop } from '../../../src/startup.js';

// Mock the voice middleware
vi.mock('../../../src/voice/voice-middleware.js', () => ({
  processInboundVoice: vi.fn(),
  generateOutboundVoice: vi.fn(),
}));

// Silence loggers
vi.mock('../../../src/utils/logger.js', () => ({
  createModuleLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }),
  channelLogger: { child: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }) },
  securityLogger: { info: vi.fn(), warn: vi.fn() },
}));

/** Create a mock channel adapter. */
function createMockAdapter(): ChannelAdapter & { triggerMessage: (msg: ChannelMessage) => Promise<void> } {
  let handler: ((msg: ChannelMessage) => Promise<void>) | undefined;

  return {
    name: 'TestAdapter',
    type: 'webchat',
    async connect(_config: ChannelConfig): Promise<void> { /* noop */ },
    onMessage(h: (msg: ChannelMessage) => Promise<void>): void {
      handler = h;
    },
    send: vi.fn(),
    async disconnect(): Promise<void> { /* noop */ },
    isConnected(): boolean { return true; },
    async triggerMessage(msg: ChannelMessage): Promise<void> {
      if (handler) await handler(msg);
    },
  };
}

/** Create a mock agent loop. */
function createMockAgentLoop() {
  return {
    processMessage: vi.fn().mockResolvedValue({
      responseText: 'Hello from the agent',
      tokensUsed: { input: 100, output: 50 },
      costUsd: 0.01,
      toolCallCount: 0,
      roundTrips: 1,
    }),
  };
}

/** Create a mock channel manager. */
function createMockChannelManager(adapters: ChannelAdapter[]) {
  return {
    getConnectedAdapters: () => adapters,
    registerAdapter: vi.fn(),
    getAdapter: vi.fn(),
    getAllAdapters: () => adapters,
  };
}

function makeConfig(): Config {
  return ConfigSchema.parse({
    voice: {
      enabled: true,
      synthesis: { enabled: true, backend: 'say' },
    },
  });
}

function makeMessage(overrides?: Partial<ChannelMessage>): ChannelMessage {
  return {
    id: 'msg-1',
    channelType: 'webchat',
    channelId: 'ch-1',
    userId: 'user-1',
    text: 'Hello',
    attachments: [],
    timestamp: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('wireChannelsToAgentLoop with voice', () => {
  it('calls processInboundVoice with the message', async () => {
    const { processInboundVoice, generateOutboundVoice } = await import(
      '../../../src/voice/voice-middleware.js'
    );
    vi.mocked(processInboundVoice).mockResolvedValue({
      text: 'Hello',
      hadAudio: false,
      transcribedCount: 0,
    });
    vi.mocked(generateOutboundVoice).mockResolvedValue({
      audioAttachment: null,
    });

    const adapter = createMockAdapter();
    const agentLoop = createMockAgentLoop();
    const manager = createMockChannelManager([adapter]);
    const config = makeConfig();

    wireChannelsToAgentLoop(manager as never, agentLoop as never, config, () => 'full');

    const msg = makeMessage();
    await adapter.triggerMessage(msg);

    expect(processInboundVoice).toHaveBeenCalledWith(msg, config, 'full');
  });

  it('passes transcribed text to agent loop', async () => {
    const { processInboundVoice, generateOutboundVoice } = await import(
      '../../../src/voice/voice-middleware.js'
    );
    vi.mocked(processInboundVoice).mockResolvedValue({
      text: '[Voice message]: What is the weather',
      hadAudio: true,
      transcribedCount: 1,
    });
    vi.mocked(generateOutboundVoice).mockResolvedValue({
      audioAttachment: null,
    });

    const adapter = createMockAdapter();
    const agentLoop = createMockAgentLoop();
    const manager = createMockChannelManager([adapter]);

    wireChannelsToAgentLoop(manager as never, agentLoop as never, makeConfig(), () => 'full');

    await adapter.triggerMessage(makeMessage());

    expect(agentLoop.processMessage).toHaveBeenCalledWith(
      'ch-1',
      '[Voice message]: What is the weather',
      'webchat',
    );
  });

  it('generates outbound voice when inbound had audio', async () => {
    const { processInboundVoice, generateOutboundVoice } = await import(
      '../../../src/voice/voice-middleware.js'
    );
    vi.mocked(processInboundVoice).mockResolvedValue({
      text: 'Transcribed text',
      hadAudio: true,
      transcribedCount: 1,
    });
    vi.mocked(generateOutboundVoice).mockResolvedValue({
      audioAttachment: {
        data: Buffer.alloc(2048),
        format: 'wav',
        mimeType: 'audio/wav',
        durationSec: 1.5,
      },
    });

    const adapter = createMockAdapter();
    const agentLoop = createMockAgentLoop();
    const manager = createMockChannelManager([adapter]);
    const config = makeConfig();

    wireChannelsToAgentLoop(manager as never, agentLoop as never, config, () => 'full');

    await adapter.triggerMessage(makeMessage());

    expect(generateOutboundVoice).toHaveBeenCalledWith(
      'Hello from the agent',
      true,
      config,
      'full',
    );

    // Verify send was called with audio attachment
    expect(adapter.send).toHaveBeenCalledWith(
      'ch-1',
      'Hello from the agent',
      expect.objectContaining({
        audioAttachment: expect.objectContaining({
          format: 'wav',
          mimeType: 'audio/wav',
        }),
      }),
    );
  });

  it('sends text-only when no audio response generated', async () => {
    const { processInboundVoice, generateOutboundVoice } = await import(
      '../../../src/voice/voice-middleware.js'
    );
    vi.mocked(processInboundVoice).mockResolvedValue({
      text: 'Hello',
      hadAudio: false,
      transcribedCount: 0,
    });
    vi.mocked(generateOutboundVoice).mockResolvedValue({
      audioAttachment: null,
    });

    const adapter = createMockAdapter();
    const agentLoop = createMockAgentLoop();
    const manager = createMockChannelManager([adapter]);

    wireChannelsToAgentLoop(manager as never, agentLoop as never, makeConfig(), () => 'standard');

    await adapter.triggerMessage(makeMessage());

    expect(adapter.send).toHaveBeenCalledWith(
      'ch-1',
      'Hello from the agent',
      { audioAttachment: undefined },
    );
  });

  it('sends error message on agent loop failure', async () => {
    const { processInboundVoice } = await import(
      '../../../src/voice/voice-middleware.js'
    );
    vi.mocked(processInboundVoice).mockResolvedValue({
      text: 'Hello',
      hadAudio: false,
      transcribedCount: 0,
    });

    const adapter = createMockAdapter();
    const agentLoop = createMockAgentLoop();
    agentLoop.processMessage.mockRejectedValue(new Error('Agent crashed'));

    const manager = createMockChannelManager([adapter]);

    wireChannelsToAgentLoop(manager as never, agentLoop as never, makeConfig(), () => 'full');

    await adapter.triggerMessage(makeMessage());

    expect(adapter.send).toHaveBeenCalledWith(
      'ch-1',
      expect.stringContaining('something went wrong'),
    );
  });

  it('uses current tier from getTier callback', async () => {
    const { processInboundVoice, generateOutboundVoice } = await import(
      '../../../src/voice/voice-middleware.js'
    );
    vi.mocked(processInboundVoice).mockResolvedValue({
      text: 'Hello',
      hadAudio: false,
      transcribedCount: 0,
    });
    vi.mocked(generateOutboundVoice).mockResolvedValue({
      audioAttachment: null,
    });

    const adapter = createMockAdapter();
    const agentLoop = createMockAgentLoop();
    const manager = createMockChannelManager([adapter]);

    let currentTier: 'lite' | 'standard' | 'full' = 'lite';
    wireChannelsToAgentLoop(manager as never, agentLoop as never, makeConfig(), () => currentTier);

    await adapter.triggerMessage(makeMessage());
    expect(processInboundVoice).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'lite');

    currentTier = 'full';
    await adapter.triggerMessage(makeMessage());
    expect(processInboundVoice).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'full');
  });
});
