import { describe, it, expect } from 'vitest';
import { applyTemporalDecay } from '../../../src/memory/temporal-decay.js';

/** Milliseconds per day, matching the source constant. */
const MS_PER_DAY = 86_400_000;

/** Helper: create a Date that is `daysAgo` days before `now`. */
function daysBeforeNow(daysAgo: number, now: number): Date {
  return new Date(now - daysAgo * MS_PER_DAY);
}

describe('applyTemporalDecay', () => {
  const now = Date.now();

  it('returns 1.0 for an entry accessed just now (0 days ago)', () => {
    const lastAccessed = new Date(now);
    expect(applyTemporalDecay(lastAccessed, now)).toBeCloseTo(1.0, 5);
  });

  it('returns ~0.817 for an entry accessed 10 days ago', () => {
    const lastAccessed = daysBeforeNow(10, now);
    const decay = applyTemporalDecay(lastAccessed, now);
    // 0.98^10 = 0.81707...
    expect(decay).toBeCloseTo(0.817, 2);
  });

  it('returns ~0.545 for an entry accessed 30 days ago', () => {
    const lastAccessed = daysBeforeNow(30, now);
    const decay = applyTemporalDecay(lastAccessed, now);
    // 0.98^30 = 0.5455...
    expect(decay).toBeCloseTo(0.545, 2);
  });

  it('returns the floor (0.1) for an entry accessed 365 days ago', () => {
    const lastAccessed = daysBeforeNow(365, now);
    const decay = applyTemporalDecay(lastAccessed, now);
    // 0.98^365 = 0.000618... which is below 0.1 floor
    expect(decay).toBe(0.1);
  });

  it('never returns below MIN_DECAY_FACTOR (0.1)', () => {
    const lastAccessed = daysBeforeNow(10000, now);
    const decay = applyTemporalDecay(lastAccessed, now);
    expect(decay).toBe(0.1);
  });

  it('returns a value between 0.1 and 1.0 for any input', () => {
    const testDays = [0, 1, 5, 10, 30, 60, 90, 180, 365, 730];
    for (const days of testDays) {
      const decay = applyTemporalDecay(daysBeforeNow(days, now), now);
      expect(decay).toBeGreaterThanOrEqual(0.1);
      expect(decay).toBeLessThanOrEqual(1.0);
    }
  });

  it('returns 1.0 when lastAccessed is in the future (clamped to 0 days)', () => {
    // Math.max(0, ...) prevents negative days
    const futureDate = new Date(now + 5 * MS_PER_DAY);
    const decay = applyTemporalDecay(futureDate, now);
    expect(decay).toBeCloseTo(1.0, 5);
  });

  it('decays monotonically — older entries have lower factors', () => {
    const decay1 = applyTemporalDecay(daysBeforeNow(1, now), now);
    const decay10 = applyTemporalDecay(daysBeforeNow(10, now), now);
    const decay30 = applyTemporalDecay(daysBeforeNow(30, now), now);
    const decay90 = applyTemporalDecay(daysBeforeNow(90, now), now);

    expect(decay1).toBeGreaterThan(decay10);
    expect(decay10).toBeGreaterThan(decay30);
    expect(decay30).toBeGreaterThan(decay90);
  });

  it('defaults to Date.now() if second argument is omitted', () => {
    const recentDate = new Date(Date.now() - 1000); // 1 second ago
    const decay = applyTemporalDecay(recentDate);
    // Should be very close to 1.0 since it's only 1 second old
    expect(decay).toBeCloseTo(1.0, 3);
  });

  it('handles fractional days correctly', () => {
    // 12 hours = 0.5 days
    const halfDayAgo = new Date(now - 0.5 * MS_PER_DAY);
    const decay = applyTemporalDecay(halfDayAgo, now);
    // 0.98^0.5 ≈ 0.98995
    expect(decay).toBeCloseTo(Math.pow(0.98, 0.5), 4);
  });
});
