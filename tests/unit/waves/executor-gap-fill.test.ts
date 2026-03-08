import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  Wave,
  WaveManifest,
  WavePlan,
  ToolResult,
  LLMProvider,
  ChatResponse,
  Message,
  ChatOptions,
  StreamChunk,
} from '../../../src/types/index.js';
import { executeWave } from '../../../src/waves/executor.js';
import type { WaveExecutorDeps } from '../../../src/waves/executor.js';

// ─── Mock Helpers ────────────────────────────────────────────────────────────

function createMockProvider(overrides: Partial<{
  chatResponse: ChatResponse;
  chatError: Error;
}> = {}): LLMProvider {
  const defaultResponse: ChatResponse = {
    content: [{ type: 'text', text: '{}' }],
    model: 'claude-haiku-4-5-20251001',
    usage: { inputTokens: 100, outputTokens: 50 },
    stopReason: 'end_turn',
  };

  return {
    name: 'anthropic',
    chat: overrides.chatError
      ? vi.fn().mockRejectedValue(overrides.chatError)
      : vi.fn().mockResolvedValue(overrides.chatResponse ?? defaultResponse),
    chatStream: vi.fn() as unknown as (
      messages: Message[],
      options: ChatOptions,
    ) => AsyncGenerator<StreamChunk>,
    countTokens: vi.fn().mockReturnValue(100),
  };
}

function createTestManifest(): WaveManifest {
  return {
    name: 'test-wave',
    version: '1.0.0',
    description: 'A test wave for gap-fill testing',
    author: 'test',
    permissions: { domains: [], shell: [], directories: [], requiresBrowser: false, requiresOAuth: [] },
    triggers: ['test'],
    deterministic: true,
    tools: [
      {
        name: 'fetch_data',
        description: 'Fetch data with location and schedule',
        parameters: { location: 'string', cronSchedule: 'string', expiresAt: 'string' },
      },
    ],
    minTier: 'basic',
    entryPoint: 'index.js',
  };
}

function createWaveWithPartialRegex(regexParams: Record<string, unknown>): Wave {
  return {
    manifest: createTestManifest(),
    plan: vi.fn().mockResolvedValue({
      steps: [],
      estimatedCostUsd: 0,
      isDeterministic: true,
      extractedParams: regexParams,
    }),
    execute: vi.fn().mockResolvedValue({
      success: true,
      output: 'Data fetched successfully',
    } as ToolResult),
  };
}

function createMockDeps(overrides: Partial<{
  provider: LLMProvider;
  taskBudgetUsd: number;
  taskSpentUsd: number;
}> = {}): WaveExecutorDeps {
  return {
    db: {} as WaveExecutorDeps['db'],
    provider: overrides.provider ?? createMockProvider(),
    taskBudgetUsd: overrides.taskBudgetUsd ?? 1.00,
    taskSpentUsd: overrides.taskSpentUsd ?? 0,
    enabledProviders: ['anthropic'],
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('LLM gap-fill for partial regex extraction', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('does not call LLM when regex extracts all params (no nulls)', async () => {
    const mockProvider = createMockProvider();
    const wave = createWaveWithPartialRegex({
      location: 'Seattle',
      cronSchedule: '*/30 * * * *',
      expiresAt: '2026-03-05T12:00:00Z',
    });
    const deps = createMockDeps({ provider: mockProvider });

    const result = await executeWave(wave, 'weather for Seattle every 30 min for 2 hours', deps);

    expect(result.success).toBe(true);
    expect(result.llmCallCount).toBe(0);
    expect(mockProvider.chat).not.toHaveBeenCalled();
  });

  it('calls LLM to fill null params when regex partially extracts', async () => {
    const mockProvider = createMockProvider({
      chatResponse: {
        content: [{ type: 'text', text: '{"cronSchedule": "*/30 * * * *", "expiresAt": "2026-03-05T12:00:00Z"}' }],
        model: 'claude-haiku-4-5-20251001',
        usage: { inputTokens: 300, outputTokens: 80 },
        stopReason: 'end_turn',
      },
    });

    const wave = createWaveWithPartialRegex({
      location: 'Seattle',
      cronSchedule: null,
      expiresAt: null,
    });
    const deps = createMockDeps({ provider: mockProvider });

    const result = await executeWave(wave, 'weather for Seattle every 30 min for 2 hours', deps);

    expect(result.success).toBe(true);
    expect(result.llmCallCount).toBe(1);
    expect(mockProvider.chat).toHaveBeenCalledTimes(1);

    // Verify the filled params are passed to execute()
    const planArg = (wave.execute as ReturnType<typeof vi.fn>).mock.calls[0][0] as WavePlan;
    expect(planArg.extractedParams.location).toBe('Seattle');
    expect(planArg.extractedParams.cronSchedule).toBe('*/30 * * * *');
    expect(planArg.extractedParams.expiresAt).toBe('2026-03-05T12:00:00Z');
  });

  it('preserves regex-extracted values (LLM cannot override them)', async () => {
    const mockProvider = createMockProvider({
      chatResponse: {
        // LLM tries to return location too, but it should be ignored
        content: [{ type: 'text', text: '{"cronSchedule": "0 * * * *", "location": "Portland"}' }],
        model: 'claude-haiku-4-5-20251001',
        usage: { inputTokens: 300, outputTokens: 80 },
        stopReason: 'end_turn',
      },
    });

    const wave = createWaveWithPartialRegex({
      location: 'Seattle',
      cronSchedule: null,
    });
    const deps = createMockDeps({ provider: mockProvider });

    await executeWave(wave, 'weather for Seattle every hour', deps);

    const planArg = (wave.execute as ReturnType<typeof vi.fn>).mock.calls[0][0] as WavePlan;
    // Regex value preserved — LLM cannot override
    expect(planArg.extractedParams.location).toBe('Seattle');
    // LLM filled the gap
    expect(planArg.extractedParams.cronSchedule).toBe('0 * * * *');
  });

  it('falls back to full LLM extraction when regex returns no useful params', async () => {
    const mockProvider = createMockProvider({
      chatResponse: {
        content: [{ type: 'text', text: '{"location": "Seattle", "cronSchedule": "*/30 * * * *"}' }],
        model: 'claude-haiku-4-5-20251001',
        usage: { inputTokens: 300, outputTokens: 80 },
        stopReason: 'end_turn',
      },
    });

    const wave = createWaveWithPartialRegex({});
    const deps = createMockDeps({ provider: mockProvider });

    const result = await executeWave(wave, 'weather for Seattle every 30 min', deps);

    // Falls through to full LLM extraction (existing behavior)
    expect(result.llmCallCount).toBe(1);
    expect(mockProvider.chat).toHaveBeenCalledTimes(1);
  });

  it('skips gap-fill when budget is insufficient and continues with partial params', async () => {
    const mockProvider = createMockProvider();
    const wave = createWaveWithPartialRegex({
      location: 'Seattle',
      cronSchedule: null,
    });
    const deps = createMockDeps({
      provider: mockProvider,
      taskBudgetUsd: 0.0001,
      taskSpentUsd: 0.00009,
    });

    const result = await executeWave(wave, 'weather for Seattle every 30 min', deps);

    // Gap-fill skipped due to budget — but wave still executes with partial params
    expect(result.success).toBe(true);
    expect(mockProvider.chat).not.toHaveBeenCalled();

    const planArg = (wave.execute as ReturnType<typeof vi.fn>).mock.calls[0][0] as WavePlan;
    expect(planArg.extractedParams.location).toBe('Seattle');
    expect(planArg.extractedParams.cronSchedule).toBeNull();
  });

  it('keeps param null when LLM also returns null (genuinely absent)', async () => {
    const mockProvider = createMockProvider({
      chatResponse: {
        content: [{ type: 'text', text: '{"cronSchedule": null, "expiresAt": null}' }],
        model: 'claude-haiku-4-5-20251001',
        usage: { inputTokens: 300, outputTokens: 40 },
        stopReason: 'end_turn',
      },
    });

    const wave = createWaveWithPartialRegex({
      location: 'Seattle',
      cronSchedule: null,
      expiresAt: null,
    });
    const deps = createMockDeps({ provider: mockProvider });

    const result = await executeWave(wave, 'weather in Seattle', deps);

    expect(result.success).toBe(true);
    expect(result.llmCallCount).toBe(1);

    const planArg = (wave.execute as ReturnType<typeof vi.fn>).mock.calls[0][0] as WavePlan;
    expect(planArg.extractedParams.location).toBe('Seattle');
    // LLM confirmed these are genuinely absent
    expect(planArg.extractedParams.cronSchedule).toBeNull();
    expect(planArg.extractedParams.expiresAt).toBeNull();
  });

  it('tracks tokens and cost from gap-fill LLM call', async () => {
    const mockProvider = createMockProvider({
      chatResponse: {
        content: [{ type: 'text', text: '{"cronSchedule": "*/15 * * * *"}' }],
        model: 'claude-haiku-4-5-20251001',
        usage: { inputTokens: 400, outputTokens: 30 },
        stopReason: 'end_turn',
      },
    });

    const wave = createWaveWithPartialRegex({
      location: 'Seattle',
      cronSchedule: null,
    });
    const deps = createMockDeps({ provider: mockProvider });

    const result = await executeWave(wave, 'weather for Seattle every 15 min', deps);

    expect(result.tokensUsed.input).toBe(400);
    expect(result.tokensUsed.output).toBe(30);
    expect(result.costUsd).toBeGreaterThan(0);
    expect(result.llmCallCount).toBe(1);
  });

  it('sends targeted prompt with null keys and already-extracted context', async () => {
    const mockProvider = createMockProvider({
      chatResponse: {
        content: [{ type: 'text', text: '{"expiresAt": "2026-03-05T13:00:00Z"}' }],
        model: 'claude-haiku-4-5-20251001',
        usage: { inputTokens: 300, outputTokens: 50 },
        stopReason: 'end_turn',
      },
    });

    const wave = createWaveWithPartialRegex({
      location: 'Seattle',
      cronSchedule: '*/30 * * * *',
      expiresAt: null,
    });
    const deps = createMockDeps({ provider: mockProvider });

    await executeWave(wave, 'weather for Seattle every 30 min for 1 hour', deps);

    // Verify the LLM was called with a targeted prompt
    const chatCall = (mockProvider.chat as ReturnType<typeof vi.fn>).mock.calls[0];
    const systemPrompt = chatCall[1].systemPrompt as string;

    // Should mention already-extracted params
    expect(systemPrompt).toContain('already extracted');
    expect(systemPrompt).toContain('Seattle');
    // Should target only the missing param
    expect(systemPrompt).toContain('expiresAt');
  });

  it('handles LLM returning malformed JSON gracefully', async () => {
    const mockProvider = createMockProvider({
      chatResponse: {
        content: [{ type: 'text', text: 'I could not parse that request' }],
        model: 'claude-haiku-4-5-20251001',
        usage: { inputTokens: 300, outputTokens: 40 },
        stopReason: 'end_turn',
      },
    });

    const wave = createWaveWithPartialRegex({
      location: 'Seattle',
      cronSchedule: null,
    });
    const deps = createMockDeps({ provider: mockProvider });

    const result = await executeWave(wave, 'weather for Seattle every 30 min', deps);

    // Should still succeed — gap-fill returns empty, params stay as-is
    expect(result.success).toBe(true);
    const planArg = (wave.execute as ReturnType<typeof vi.fn>).mock.calls[0][0] as WavePlan;
    expect(planArg.extractedParams.location).toBe('Seattle');
    expect(planArg.extractedParams.cronSchedule).toBeNull();
  });
});
