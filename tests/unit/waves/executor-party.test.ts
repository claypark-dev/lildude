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
  Contact,
} from '../../../src/types/index.js';
import type { WaveExecutorDeps, WaveExecutionResult } from '../../../src/waves/executor.js';

// ─── Module Mocks ────────────────────────────────────────────────────────────

vi.mock('../../../src/providers/router.js', () => ({
  selectModel: vi.fn().mockReturnValue({
    provider: 'mock',
    model: 'mock-model',
    tier: 'small',
    estimatedCostUsd: 0.001,
    reasoning: 'test',
  }),
}));

vi.mock('../../../src/cost/pricing.js', () => ({
  calculateCost: vi.fn().mockReturnValue(0.001),
}));

vi.mock('../../../src/cost/budget.js', () => ({
  canAfford: vi.fn().mockReturnValue(true),
}));

// Import after mocks are declared
import { executePartyWave } from '../../../src/waves/executor-party.js';
import { canAfford } from '../../../src/cost/budget.js';
import { calculateCost } from '../../../src/cost/pricing.js';
import { selectModel } from '../../../src/providers/router.js';

// ─── Test Fixtures ───────────────────────────────────────────────────────────

const testContact: Contact = {
  id: 'ext-1',
  name: 'External User',
  phone: null,
  email: null,
  trustLevel: 'trusted',
  isFavorite: false,
  notes: null,
  permittedWaves: [],
  channelIds: {},
  rateLimitPerHour: 10,
  budgetCapUsd: 0,
  tags: [],
  lastContactedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

/** Create a mock LLM provider with configurable chat response. */
function createMockProvider(overrides: Partial<{
  chatResponse: ChatResponse;
  chatError: Error;
  tokenCount: number;
}> = {}): LLMProvider {
  const defaultResponse: ChatResponse = {
    content: [{ type: 'text', text: '{}' }],
    model: 'mock-model',
    usage: { inputTokens: 10, outputTokens: 5 },
    stopReason: 'end_turn',
  };

  return {
    name: 'mock',
    chat: overrides.chatError
      ? vi.fn().mockRejectedValue(overrides.chatError)
      : vi.fn().mockResolvedValue(overrides.chatResponse ?? defaultResponse),
    chatStream: vi.fn() as unknown as (
      messages: Message[],
      options: ChatOptions,
    ) => AsyncGenerator<StreamChunk>,
    countTokens: vi.fn().mockReturnValue(overrides.tokenCount ?? 10),
  };
}

/** Create a deterministic party wave with configurable behavior. */
function createPartyWave(overrides: Partial<{
  name: string;
  executeResult: ToolResult;
  executeError: Error;
  validateResult: { valid: boolean; feedback?: string };
  hasValidate: boolean;
  deterministic: boolean;
  planResult: WavePlan;
  planError: Error;
}> = {}): Wave {
  const defaultResult: ToolResult = {
    success: true,
    output: 'Meeting scheduled successfully',
  };

  const manifest: WaveManifest = {
    name: overrides.name ?? 'party-scheduler',
    version: '1.0.0',
    description: 'A party wave for scheduling',
    author: 'test',
    permissions: {
      domains: [],
      shell: [],
      directories: [],
      requiresBrowser: false,
      requiresOAuth: [],
    },
    triggers: ['schedule', 'meeting'],
    deterministic: overrides.deterministic ?? true,
    tools: [
      { name: 'schedule', description: 'Schedule a meeting', parameters: { time: 'string' } },
    ],
    minTier: 'basic',
    entryPoint: 'index.js',
    safetyTier: 'observe',
    waveCategory: 'party',
  };

  const defaultPlan: WavePlan = {
    steps: [{ type: 'api_call', description: 'Schedule', params: {} }],
    estimatedCostUsd: 0.001,
    isDeterministic: overrides.deterministic ?? true,
    extractedParams: {},
  };

  const wave: Wave = {
    manifest,
    plan: overrides.planError
      ? vi.fn().mockRejectedValue(overrides.planError)
      : vi.fn().mockResolvedValue(overrides.planResult ?? defaultPlan),
    execute: overrides.executeError
      ? vi.fn().mockRejectedValue(overrides.executeError)
      : vi.fn().mockResolvedValue(overrides.executeResult ?? defaultResult),
  };

  if (overrides.hasValidate && overrides.validateResult) {
    wave.validate = vi.fn().mockResolvedValue(overrides.validateResult);
  }

  return wave;
}

/** Create mock WaveExecutorDeps with an external contact by default. */
function createMockDeps(overrides: {
  provider?: LLMProvider;
  taskBudgetUsd?: number;
  taskSpentUsd?: number;
  externalContact?: Contact;
  omitContact?: boolean;
} = {}): WaveExecutorDeps {
  const deps: WaveExecutorDeps = {
    db: {} as WaveExecutorDeps['db'],
    provider: overrides.provider ?? createMockProvider(),
    taskBudgetUsd: overrides.taskBudgetUsd ?? 1.00,
    taskSpentUsd: overrides.taskSpentUsd ?? 0,
    enabledProviders: ['mock'],
  };

  // Only set externalContact if not explicitly omitted
  if (!overrides.omitContact) {
    deps.externalContact = overrides.externalContact ?? testContact;
  }

  return deps;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('executePartyWave', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Reset mock implementations to defaults after restoreAllMocks clears them
    vi.mocked(canAfford).mockReturnValue(true);
    vi.mocked(calculateCost).mockReturnValue(0.001);
    vi.mocked(selectModel).mockReturnValue({
      provider: 'mock',
      model: 'mock-model',
      tier: 'small',
      estimatedCostUsd: 0.001,
      reasoning: 'test',
    });
  });

  // ─── Missing External Contact ─────────────────────────────────────────

  it('returns failure when externalContact is missing', async () => {
    const wave = createPartyWave();
    const deps = createMockDeps({ omitContact: true });

    const result = await executePartyWave(wave, 'schedule a meeting', deps);

    expect(result.success).toBe(false);
    expect(result.output).toContain('requires an external contact');
    expect(result.llmCallCount).toBe(0);
  });

  it('returns failure output that includes the wave name when contact is missing', async () => {
    const wave = createPartyWave({ name: 'party-greet' });
    const deps = createMockDeps({ omitContact: true });

    const result = await executePartyWave(wave, 'hello', deps);

    expect(result.success).toBe(false);
    expect(result.output).toContain('party-greet');
  });

  // ─── Successful Deterministic Execution ───────────────────────────────

  it('successfully executes a deterministic party wave', async () => {
    const wave = createPartyWave({
      executeResult: { success: true, output: 'Meeting booked for 3pm' },
    });
    const deps = createMockDeps();

    const result = await executePartyWave(wave, 'schedule a meeting at 3pm', deps);

    expect(result.success).toBe(true);
    expect(result.wasDeterministic).toBe(true);
    expect(result.llmCallCount).toBe(1);
    expect(wave.execute).toHaveBeenCalledTimes(1);
  });

  it('calls the LLM provider for parameter extraction in deterministic mode', async () => {
    const mockProvider = createMockProvider();
    const wave = createPartyWave();
    const deps = createMockDeps({ provider: mockProvider });

    await executePartyWave(wave, 'schedule a meeting', deps);

    expect(mockProvider.chat).toHaveBeenCalledTimes(1);
  });

  it('tracks token usage from extraction call', async () => {
    const mockProvider = createMockProvider({
      chatResponse: {
        content: [{ type: 'text', text: '{"time": "3pm"}' }],
        model: 'mock-model',
        usage: { inputTokens: 200, outputTokens: 80 },
        stopReason: 'end_turn',
      },
    });
    const wave = createPartyWave();
    const deps = createMockDeps({ provider: mockProvider });

    const result = await executePartyWave(wave, 'schedule at 3pm', deps);

    expect(result.tokensUsed.input).toBe(200);
    expect(result.tokensUsed.output).toBe(80);
  });

  // ─── Output Sanitization ──────────────────────────────────────────────

  it('sanitizes email addresses from party wave output', async () => {
    const wave = createPartyWave({
      executeResult: {
        success: true,
        output: 'Meeting confirmed. Sent invite to owner@example.com',
      },
    });
    const deps = createMockDeps();

    const result = await executePartyWave(wave, 'schedule a meeting', deps);

    expect(result.success).toBe(true);
    expect(result.output).not.toContain('owner@example.com');
    expect(result.output).toContain('[redacted]');
  });

  it('sanitizes phone numbers from party wave output', async () => {
    const wave = createPartyWave({
      executeResult: {
        success: true,
        output: 'Contact the owner at +1-555-123-4567 to confirm.',
      },
    });
    const deps = createMockDeps();

    const result = await executePartyWave(wave, 'share contact info', deps);

    expect(result.success).toBe(true);
    expect(result.output).not.toContain('555-123-4567');
    expect(result.output).toContain('[redacted]');
  });

  it('sanitizes API key-like patterns from party wave output', async () => {
    const wave = createPartyWave({
      executeResult: {
        success: true,
        output: 'Error: authentication failed for token_abc123def456ghi789jkl012mno345',
      },
    });
    const deps = createMockDeps();

    const result = await executePartyWave(wave, 'check status', deps);

    expect(result.success).toBe(true);
    expect(result.output).not.toContain('token_abc123def456ghi789jkl012mno345');
    expect(result.output).toContain('[redacted]');
  });

  it('does not sanitize output when execution fails', async () => {
    const wave = createPartyWave({
      executeResult: {
        success: false,
        output: 'Failed to schedule meeting',
      },
    });
    const deps = createMockDeps();

    const result = await executePartyWave(wave, 'schedule a meeting', deps);

    // Sanitization only applies to successful results
    expect(result.success).toBe(false);
    expect(result.output).toBe('Failed to schedule meeting');
  });

  // ─── Budget Checks ────────────────────────────────────────────────────

  it('returns budget exceeded failure when canAfford returns false', async () => {
    vi.mocked(canAfford).mockReturnValue(false);

    const wave = createPartyWave();
    const deps = createMockDeps({ taskBudgetUsd: 0.0001, taskSpentUsd: 0.0001 });

    const result = await executePartyWave(wave, 'schedule a meeting', deps);

    expect(result.success).toBe(false);
    expect(result.output).toContain('Budget exceeded');
    expect(result.llmCallCount).toBe(0);
  });

  it('includes wave name in budget exceeded message', async () => {
    vi.mocked(canAfford).mockReturnValue(false);

    const wave = createPartyWave({ name: 'party-expense' });
    const deps = createMockDeps();

    const result = await executePartyWave(wave, 'do something expensive', deps);

    expect(result.success).toBe(false);
    expect(result.output).toContain('party-expense');
  });

  // ─── Error Handling ───────────────────────────────────────────────────

  it('handles wave.execute() throwing an error gracefully', async () => {
    const wave = createPartyWave({
      executeError: new Error('External API timeout'),
    });
    const deps = createMockDeps();

    const result = await executePartyWave(wave, 'schedule a meeting', deps);

    expect(result.success).toBe(false);
    expect(result.output).toContain('execution failed');
    expect(result.output).toContain('External API timeout');
  });

  it('handles LLM provider chat failure gracefully', async () => {
    const failingProvider = createMockProvider({
      chatError: new Error('Rate limit exceeded'),
    });
    const wave = createPartyWave();
    const deps = createMockDeps({ provider: failingProvider });

    const result = await executePartyWave(wave, 'schedule a meeting', deps);

    expect(result.success).toBe(false);
    expect(result.output).toContain('execution failed');
    expect(result.output).toContain('Rate limit exceeded');
  });

  it('returns zero cost and tokens on failure', async () => {
    const wave = createPartyWave({
      executeError: new Error('Boom'),
    });
    const deps = createMockDeps();

    const result = await executePartyWave(wave, 'schedule a meeting', deps);

    expect(result.success).toBe(false);
    expect(result.costUsd).toBe(0);
    expect(result.tokensUsed.input).toBe(0);
    expect(result.tokensUsed.output).toBe(0);
    expect(result.llmCallCount).toBe(0);
  });

  // ─── Non-Deterministic Party Wave ─────────────────────────────────────

  it('executes a non-deterministic party wave using plan and execute', async () => {
    const wave = createPartyWave({
      deterministic: false,
      planResult: {
        steps: [{ type: 'llm_call', description: 'Plan meeting', params: {} }],
        estimatedCostUsd: 0.002,
        isDeterministic: false,
        extractedParams: {},
      },
      executeResult: { success: true, output: 'Complex meeting arranged' },
    });
    const deps = createMockDeps();

    const result = await executePartyWave(wave, 'plan a complex meeting', deps);

    expect(result.success).toBe(true);
    expect(result.wasDeterministic).toBe(false);
    expect(result.llmCallCount).toBe(2);
    expect(wave.plan).toHaveBeenCalledTimes(1);
    expect(wave.execute).toHaveBeenCalledTimes(1);
  });
});
