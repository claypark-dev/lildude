import { describe, it, expect } from 'vitest';
import { estimateTaskCost, KILL_CONDITIONS } from '../../../src/cost/estimator.js';
import { BudgetExceededError } from '../../../src/errors.js';

describe('estimateTaskCost', () => {
  it('returns a CostEstimate for simple_chat', () => {
    const estimate = estimateTaskCost('simple_chat', 'gpt-4o-mini');
    expect(estimate.estimatedCostUsd).toBeGreaterThan(0);
    expect(estimate.breakdown.inputTokens).toBeGreaterThan(0);
    expect(estimate.breakdown.outputTokens).toBeGreaterThan(0);
    expect(estimate.breakdown.roundTrips).toBe(1);
    expect(estimate.breakdown.model).toBe('gpt-4o-mini');
  });

  it('returns a CostEstimate for skill_execution', () => {
    const estimate = estimateTaskCost('skill_execution', 'claude-haiku-4-5-20251001');
    expect(estimate.estimatedCostUsd).toBeGreaterThan(0);
    expect(estimate.breakdown.roundTrips).toBe(2);
  });

  it('returns a CostEstimate for browser_task', () => {
    const estimate = estimateTaskCost('browser_task', 'claude-sonnet-4-5-20250929');
    expect(estimate.estimatedCostUsd).toBeGreaterThan(0);
    expect(estimate.breakdown.roundTrips).toBe(4);
  });

  it('returns a CostEstimate for complex_analysis', () => {
    const estimate = estimateTaskCost('complex_analysis', 'gpt-4o');
    expect(estimate.estimatedCostUsd).toBeGreaterThan(0);
    expect(estimate.breakdown.roundTrips).toBe(3);
  });

  it('returns a CostEstimate for summarization', () => {
    const estimate = estimateTaskCost('summarization', 'gpt-4.1');
    expect(estimate.estimatedCostUsd).toBeGreaterThan(0);
    expect(estimate.breakdown.roundTrips).toBe(1);
  });

  it('defaults to simple_chat heuristics for unknown task type', () => {
    const unknownEstimate = estimateTaskCost('unknown_task_type', 'gpt-4o-mini');
    const simpleChatEstimate = estimateTaskCost('simple_chat', 'gpt-4o-mini');
    expect(unknownEstimate.estimatedCostUsd).toBe(simpleChatEstimate.estimatedCostUsd);
    expect(unknownEstimate.breakdown.roundTrips).toBe(simpleChatEstimate.breakdown.roundTrips);
    expect(unknownEstimate.breakdown.inputTokens).toBe(simpleChatEstimate.breakdown.inputTokens);
    expect(unknownEstimate.breakdown.outputTokens).toBe(simpleChatEstimate.breakdown.outputTokens);
  });

  it('throws BudgetExceededError for unknown model', () => {
    expect(() => estimateTaskCost('simple_chat', 'nonexistent-model')).toThrow(BudgetExceededError);
  });

  it('returns 0 cost for Ollama models (free local inference)', () => {
    const estimate = estimateTaskCost('simple_chat', 'ollama/llama3.2');
    expect(estimate.estimatedCostUsd).toBe(0);
    expect(estimate.breakdown.inputTokens).toBeGreaterThan(0);
    expect(estimate.breakdown.outputTokens).toBeGreaterThan(0);
  });

  it('higher-tier models cost more for same task', () => {
    const smallEstimate = estimateTaskCost('simple_chat', 'gpt-4o-mini');
    const largeEstimate = estimateTaskCost('simple_chat', 'claude-opus-4-6');
    expect(largeEstimate.estimatedCostUsd).toBeGreaterThan(smallEstimate.estimatedCostUsd);
  });
});

describe('KILL_CONDITIONS', () => {
  it('has maxRoundTrips set to 20', () => {
    expect(KILL_CONDITIONS.maxRoundTrips).toBe(20);
  });

  it('has maxTokensPerTask set to 100_000', () => {
    expect(KILL_CONDITIONS.maxTokensPerTask).toBe(100_000);
  });

  it('has maxDurationMs set to 30 minutes', () => {
    expect(KILL_CONDITIONS.maxDurationMs).toBe(30 * 60_000);
  });

  it('has maxConsecutiveErrors set to 5', () => {
    expect(KILL_CONDITIONS.maxConsecutiveErrors).toBe(5);
  });

  it('all values are positive numbers', () => {
    for (const value of Object.values(KILL_CONDITIONS)) {
      expect(value).toBeGreaterThan(0);
    }
  });
});
