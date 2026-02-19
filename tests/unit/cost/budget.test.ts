import { describe, it, expect } from 'vitest';
import {
  canAfford,
  isWithinMonthlyBudget,
  isApproachingBudget,
} from '../../../src/cost/budget.js';

describe('canAfford', () => {
  it('returns true when task spending plus estimate is under budget', () => {
    expect(canAfford(0.10, 0.50, 0.05)).toBe(true);
  });

  it('returns true when task spending plus estimate exactly equals budget', () => {
    expect(canAfford(0.40, 0.50, 0.10)).toBe(true);
  });

  it('returns false when task spending plus estimate exceeds budget', () => {
    expect(canAfford(0.45, 0.50, 0.10)).toBe(false);
  });

  it('returns true when no money has been spent yet', () => {
    expect(canAfford(0, 1.00, 0.50)).toBe(true);
  });

  it('returns false when budget is already fully spent', () => {
    expect(canAfford(0.50, 0.50, 0.01)).toBe(false);
  });

  it('returns true when estimated cost is zero', () => {
    expect(canAfford(0.30, 0.50, 0)).toBe(true);
  });
});

describe('isWithinMonthlyBudget', () => {
  it('returns true when monthly spending plus estimate is under limit', () => {
    expect(isWithinMonthlyBudget(5.00, 20.00, 1.00)).toBe(true);
  });

  it('returns true when monthly spending plus estimate exactly equals limit', () => {
    expect(isWithinMonthlyBudget(19.00, 20.00, 1.00)).toBe(true);
  });

  it('returns false when monthly spending plus estimate exceeds limit', () => {
    expect(isWithinMonthlyBudget(19.50, 20.00, 1.00)).toBe(false);
  });

  it('returns true at the start of a fresh month', () => {
    expect(isWithinMonthlyBudget(0, 20.00, 0.50)).toBe(true);
  });

  it('returns false when monthly limit is already reached', () => {
    expect(isWithinMonthlyBudget(20.00, 20.00, 0.01)).toBe(false);
  });
});

describe('isApproachingBudget', () => {
  it('returns true when spending is at the threshold', () => {
    // 80% of $20 = $16, spending exactly $16
    expect(isApproachingBudget(16.00, 20.00, 0.8)).toBe(true);
  });

  it('returns true when spending exceeds the threshold', () => {
    expect(isApproachingBudget(18.00, 20.00, 0.8)).toBe(true);
  });

  it('returns false when spending is below the threshold', () => {
    expect(isApproachingBudget(10.00, 20.00, 0.8)).toBe(false);
  });

  it('returns false when no money has been spent', () => {
    expect(isApproachingBudget(0, 20.00, 0.8)).toBe(false);
  });

  it('returns true when threshold is 0 and any spending has occurred', () => {
    expect(isApproachingBudget(0.01, 20.00, 0)).toBe(true);
  });

  it('works with 100% threshold', () => {
    expect(isApproachingBudget(19.99, 20.00, 1.0)).toBe(false);
    expect(isApproachingBudget(20.00, 20.00, 1.0)).toBe(true);
  });
});
