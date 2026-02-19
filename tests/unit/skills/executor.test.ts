import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  Skill,
  SkillManifest,
  SkillPlan,
  ToolResult,
  LLMProvider,
  ChatResponse,
  Message,
  ChatOptions,
  StreamChunk,
} from '../../../src/types/index.js';
import { executeSkill } from '../../../src/skills/executor.js';
import type { SkillExecutorDeps } from '../../../src/skills/executor.js';

// ─── Mock Helpers ────────────────────────────────────────────────────────────

/** Create a mock LLM provider that returns a configurable response. */
function createMockProvider(overrides: Partial<{
  chatResponse: ChatResponse;
  chatError: Error;
  tokenCount: number;
}> = {}): LLMProvider {
  const defaultResponse: ChatResponse = {
    content: [{ type: 'text', text: '{"ticker": "AAPL"}' }],
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
    countTokens: vi.fn().mockReturnValue(overrides.tokenCount ?? 100),
  };
}

/** Create a minimal test skill manifest with optional overrides. */
function createTestManifest(overrides: Partial<SkillManifest> = {}): SkillManifest {
  return {
    name: overrides.name ?? 'test-skill',
    version: '1.0.0',
    description: 'A test skill for unit testing',
    author: 'test-author',
    permissions: {
      domains: [],
      shell: [],
      directories: [],
      requiresBrowser: false,
      requiresOAuth: [],
    },
    triggers: overrides.triggers ?? ['test'],
    deterministic: overrides.deterministic ?? true,
    tools: overrides.tools ?? [
      { name: 'lookup', description: 'Look up data', parameters: { query: 'string' } },
    ],
    minTier: 'basic',
    entryPoint: 'index.js',
    ...overrides,
  };
}

/** Create a deterministic test skill with configurable behavior. */
function createDeterministicSkill(overrides: Partial<{
  executeResult: ToolResult;
  executeError: Error;
  validateResult: { valid: boolean; feedback?: string };
  validateError: Error;
  hasValidate: boolean;
}> = {}): Skill {
  const defaultResult: ToolResult = {
    success: true,
    output: 'Stock price for AAPL is $150.00',
  };

  const skill: Skill = {
    manifest: createTestManifest({ deterministic: true }),
    plan: vi.fn().mockResolvedValue({
      steps: [],
      estimatedCostUsd: 0,
      isDeterministic: true,
      extractedParams: {},
    }),
    execute: overrides.executeError
      ? vi.fn().mockRejectedValue(overrides.executeError)
      : vi.fn().mockResolvedValue(overrides.executeResult ?? defaultResult),
  };

  if (overrides.hasValidate !== false && (overrides.validateResult || overrides.validateError)) {
    skill.validate = overrides.validateError
      ? vi.fn().mockRejectedValue(overrides.validateError)
      : vi.fn().mockResolvedValue(overrides.validateResult ?? { valid: true });
  }

  return skill;
}

/** Create a non-deterministic test skill with configurable behavior. */
function createNonDeterministicSkill(overrides: Partial<{
  planResult: SkillPlan;
  planError: Error;
  executeResult: ToolResult;
  executeError: Error;
  hasValidate: boolean;
  validateResult: { valid: boolean; feedback?: string };
}> = {}): Skill {
  const defaultPlan: SkillPlan = {
    steps: [{ type: 'llm_call', description: 'Analyze input', params: {} }],
    estimatedCostUsd: 0.001,
    isDeterministic: false,
    extractedParams: { query: 'test' },
  };

  const defaultResult: ToolResult = {
    success: true,
    output: 'Analysis complete: everything looks good.',
  };

  const skill: Skill = {
    manifest: createTestManifest({ deterministic: false }),
    plan: overrides.planError
      ? vi.fn().mockRejectedValue(overrides.planError)
      : vi.fn().mockResolvedValue(overrides.planResult ?? defaultPlan),
    execute: overrides.executeError
      ? vi.fn().mockRejectedValue(overrides.executeError)
      : vi.fn().mockResolvedValue(overrides.executeResult ?? defaultResult),
  };

  if (overrides.hasValidate && overrides.validateResult) {
    skill.validate = vi.fn().mockResolvedValue(overrides.validateResult);
  }

  return skill;
}

/** Create mock SkillExecutorDeps with optional overrides. */
function createMockDeps(overrides: Partial<{
  provider: LLMProvider;
  taskBudgetUsd: number;
  taskSpentUsd: number;
}> = {}): SkillExecutorDeps {
  return {
    db: {} as SkillExecutorDeps['db'],
    provider: overrides.provider ?? createMockProvider(),
    taskBudgetUsd: overrides.taskBudgetUsd ?? 1.00,
    taskSpentUsd: overrides.taskSpentUsd ?? 0,
    enabledProviders: ['anthropic'],
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('skill executor', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('deterministic execution', () => {
    it('executes with exactly 1 LLM call for parameter extraction', async () => {
      const mockProvider = createMockProvider();
      const skill = createDeterministicSkill();
      const deps = createMockDeps({ provider: mockProvider });

      const result = await executeSkill(skill, 'check stock AAPL', deps);

      expect(result.success).toBe(true);
      expect(result.wasDeterministic).toBe(true);
      expect(result.llmCallCount).toBe(1);
      expect(mockProvider.chat).toHaveBeenCalledTimes(1);
    });

    it('returns correct output from skill.execute()', async () => {
      const skill = createDeterministicSkill({
        executeResult: { success: true, output: 'AAPL is at $175.50' },
      });
      const deps = createMockDeps();

      const result = await executeSkill(skill, 'check stock AAPL', deps);

      expect(result.success).toBe(true);
      expect(result.output).toBe('AAPL is at $175.50');
    });

    it('tracks token usage from the extraction LLM call', async () => {
      const mockProvider = createMockProvider({
        chatResponse: {
          content: [{ type: 'text', text: '{"ticker": "MSFT"}' }],
          model: 'claude-haiku-4-5-20251001',
          usage: { inputTokens: 200, outputTokens: 80 },
          stopReason: 'end_turn',
        },
      });
      const skill = createDeterministicSkill();
      const deps = createMockDeps({ provider: mockProvider });

      const result = await executeSkill(skill, 'check stock MSFT', deps);

      expect(result.tokensUsed.input).toBe(200);
      expect(result.tokensUsed.output).toBe(80);
    });

    it('passes extracted parameters to skill.execute() via the plan', async () => {
      const mockProvider = createMockProvider({
        chatResponse: {
          content: [{ type: 'text', text: '{"ticker": "GOOG", "exchange": "NASDAQ"}' }],
          model: 'claude-haiku-4-5-20251001',
          usage: { inputTokens: 100, outputTokens: 50 },
          stopReason: 'end_turn',
        },
      });
      const skill = createDeterministicSkill();
      const deps = createMockDeps({ provider: mockProvider });

      await executeSkill(skill, 'check stock GOOG on NASDAQ', deps);

      expect(skill.execute).toHaveBeenCalledTimes(1);
      const planArg = (skill.execute as ReturnType<typeof vi.fn>).mock.calls[0][0] as SkillPlan;
      expect(planArg.extractedParams).toEqual({ ticker: 'GOOG', exchange: 'NASDAQ' });
      expect(planArg.isDeterministic).toBe(true);
    });

    it('handles malformed JSON response by using empty params', async () => {
      const mockProvider = createMockProvider({
        chatResponse: {
          content: [{ type: 'text', text: 'not valid json at all' }],
          model: 'claude-haiku-4-5-20251001',
          usage: { inputTokens: 100, outputTokens: 50 },
          stopReason: 'end_turn',
        },
      });
      const skill = createDeterministicSkill();
      const deps = createMockDeps({ provider: mockProvider });

      const result = await executeSkill(skill, 'check stock AAPL', deps);

      // Should still succeed — empty params is a valid fallback
      expect(result.success).toBe(true);
      const planArg = (skill.execute as ReturnType<typeof vi.fn>).mock.calls[0][0] as SkillPlan;
      expect(planArg.extractedParams).toEqual({});
    });

    it('extracts JSON from markdown-wrapped response', async () => {
      const mockProvider = createMockProvider({
        chatResponse: {
          content: [{ type: 'text', text: 'Here is the result:\n```json\n{"ticker": "TSLA"}\n```' }],
          model: 'claude-haiku-4-5-20251001',
          usage: { inputTokens: 100, outputTokens: 50 },
          stopReason: 'end_turn',
        },
      });
      const skill = createDeterministicSkill();
      const deps = createMockDeps({ provider: mockProvider });

      await executeSkill(skill, 'check stock TSLA', deps);

      const planArg = (skill.execute as ReturnType<typeof vi.fn>).mock.calls[0][0] as SkillPlan;
      expect(planArg.extractedParams).toEqual({ ticker: 'TSLA' });
    });
  });

  describe('non-deterministic execution', () => {
    it('uses full planning path with skill.plan() and skill.execute()', async () => {
      const skill = createNonDeterministicSkill();
      const deps = createMockDeps();

      const result = await executeSkill(skill, 'analyze my portfolio', deps);

      expect(result.success).toBe(true);
      expect(result.wasDeterministic).toBe(false);
      expect(result.llmCallCount).toBe(2);
      expect(skill.plan).toHaveBeenCalledTimes(1);
      expect(skill.execute).toHaveBeenCalledTimes(1);
    });

    it('passes the plan result from skill.plan() to skill.execute()', async () => {
      const customPlan: SkillPlan = {
        steps: [
          { type: 'api_call', description: 'Fetch portfolio', params: { userId: '123' } },
          { type: 'llm_call', description: 'Analyze data', params: {} },
        ],
        estimatedCostUsd: 0.002,
        isDeterministic: false,
        extractedParams: { userId: '123' },
      };
      const skill = createNonDeterministicSkill({ planResult: customPlan });
      const deps = createMockDeps();

      await executeSkill(skill, 'analyze my portfolio', deps);

      expect(skill.execute).toHaveBeenCalledWith(customPlan);
    });
  });

  describe('budget checks', () => {
    it('prevents execution when task budget is already exceeded', async () => {
      const skill = createDeterministicSkill();
      const deps = createMockDeps({
        taskBudgetUsd: 0.01,
        taskSpentUsd: 0.01,
      });

      const result = await executeSkill(skill, 'check stock AAPL', deps);

      expect(result.success).toBe(false);
      expect(result.output).toContain('Budget exceeded');
      expect(result.llmCallCount).toBe(0);
    });

    it('prevents non-deterministic execution when planning budget is exceeded', async () => {
      const skill = createNonDeterministicSkill();
      const deps = createMockDeps({
        taskBudgetUsd: 0.0001,
        taskSpentUsd: 0,
      });

      const result = await executeSkill(skill, 'analyze my portfolio', deps);

      expect(result.success).toBe(false);
      expect(result.output).toContain('Budget exceeded');
    });

    it('prevents non-deterministic execution when plan.estimatedCostUsd exceeds budget', async () => {
      const expensivePlan: SkillPlan = {
        steps: [{ type: 'llm_call', description: 'Analyze', params: {} }],
        estimatedCostUsd: 10.00,
        isDeterministic: false,
        extractedParams: {},
      };
      const skill = createNonDeterministicSkill({ planResult: expensivePlan });
      const deps = createMockDeps({ taskBudgetUsd: 1.00 });

      const result = await executeSkill(skill, 'analyze my portfolio', deps);

      expect(result.success).toBe(false);
      expect(result.output).toContain('Budget exceeded');
      // plan() was called but execute() should NOT be called
      expect(skill.plan).toHaveBeenCalledTimes(1);
      expect(skill.execute).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('handles LLM call failure during parameter extraction', async () => {
      const mockProvider = createMockProvider({
        chatError: new Error('API rate limit exceeded'),
      });
      const skill = createDeterministicSkill();
      const deps = createMockDeps({ provider: mockProvider });

      const result = await executeSkill(skill, 'check stock AAPL', deps);

      expect(result.success).toBe(false);
      expect(result.output).toContain('execution failed');
      expect(result.output).toContain('API rate limit exceeded');
    });

    it('handles skill.execute() failure for deterministic skills', async () => {
      const skill = createDeterministicSkill({
        executeError: new Error('API endpoint unavailable'),
      });
      const deps = createMockDeps();

      const result = await executeSkill(skill, 'check stock AAPL', deps);

      expect(result.success).toBe(false);
      expect(result.output).toContain('execution failed');
      expect(result.output).toContain('API endpoint unavailable');
    });

    it('handles skill.plan() failure for non-deterministic skills', async () => {
      const skill = createNonDeterministicSkill({
        planError: new Error('Planning service unavailable'),
      });
      const deps = createMockDeps();

      const result = await executeSkill(skill, 'analyze my portfolio', deps);

      expect(result.success).toBe(false);
      expect(result.output).toContain('execution failed');
    });

    it('handles skill.execute() failure for non-deterministic skills', async () => {
      const skill = createNonDeterministicSkill({
        executeError: new Error('Execution timed out'),
      });
      const deps = createMockDeps();

      const result = await executeSkill(skill, 'analyze my portfolio', deps);

      expect(result.success).toBe(false);
      expect(result.output).toContain('execution failed');
    });
  });

  describe('validation', () => {
    it('runs validate() when skill has it and result is valid', async () => {
      const skill = createDeterministicSkill({
        hasValidate: true,
        validateResult: { valid: true },
      });
      const deps = createMockDeps();

      const result = await executeSkill(skill, 'check stock AAPL', deps);

      expect(result.success).toBe(true);
      expect(skill.validate).toHaveBeenCalledTimes(1);
    });

    it('includes validation feedback when validation fails', async () => {
      const skill = createDeterministicSkill({
        hasValidate: true,
        validateResult: { valid: false, feedback: 'Stale data detected' },
      });
      const deps = createMockDeps();

      const result = await executeSkill(skill, 'check stock AAPL', deps);

      expect(result.success).toBe(false);
      expect(result.output).toContain('Validation feedback: Stale data detected');
    });

    it('treats validation error as valid and continues', async () => {
      const skill = createDeterministicSkill({
        hasValidate: true,
        validateError: new Error('Validator crashed'),
      });
      const deps = createMockDeps();

      const result = await executeSkill(skill, 'check stock AAPL', deps);

      // Validation errors are logged but treated as valid
      expect(result.success).toBe(true);
    });

    it('skips validation when skill has no validate method', async () => {
      const skill = createDeterministicSkill();
      // skill.validate is undefined by default
      const deps = createMockDeps();

      const result = await executeSkill(skill, 'check stock AAPL', deps);

      expect(result.success).toBe(true);
      expect(skill.validate).toBeUndefined();
    });

    it('runs validate() for non-deterministic skills too', async () => {
      const skill = createNonDeterministicSkill({
        hasValidate: true,
        validateResult: { valid: true },
      });
      const deps = createMockDeps();

      const result = await executeSkill(skill, 'analyze data', deps);

      expect(result.success).toBe(true);
      expect(skill.validate).toHaveBeenCalledTimes(1);
    });
  });

  describe('token usage tracking', () => {
    it('reports correct token usage for deterministic execution', async () => {
      const mockProvider = createMockProvider({
        chatResponse: {
          content: [{ type: 'text', text: '{"query": "test"}' }],
          model: 'claude-haiku-4-5-20251001',
          usage: { inputTokens: 350, outputTokens: 120 },
          stopReason: 'end_turn',
        },
      });
      const skill = createDeterministicSkill();
      const deps = createMockDeps({ provider: mockProvider });

      const result = await executeSkill(skill, 'test query', deps);

      expect(result.tokensUsed.input).toBe(350);
      expect(result.tokensUsed.output).toBe(120);
      expect(result.costUsd).toBeGreaterThan(0);
    });

    it('reports zero tokens for non-deterministic execution (tokens tracked by skill)', async () => {
      const skill = createNonDeterministicSkill();
      const deps = createMockDeps();

      const result = await executeSkill(skill, 'analyze data', deps);

      // Non-deterministic skills track their own tokens internally
      expect(result.tokensUsed.input).toBe(0);
      expect(result.tokensUsed.output).toBe(0);
      // Cost comes from the plan's estimatedCostUsd
      expect(result.costUsd).toBeGreaterThan(0);
    });

    it('reports zero cost when budget check fails before LLM call', async () => {
      const skill = createDeterministicSkill();
      const deps = createMockDeps({
        taskBudgetUsd: 0.0001,
        taskSpentUsd: 0.0001,
      });

      const result = await executeSkill(skill, 'check stock AAPL', deps);

      expect(result.costUsd).toBe(0);
      expect(result.tokensUsed.input).toBe(0);
      expect(result.tokensUsed.output).toBe(0);
    });
  });
});
