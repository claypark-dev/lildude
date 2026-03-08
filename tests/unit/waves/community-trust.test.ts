import { describe, it, expect } from 'vitest';
import {
  computeTrustScore,
  getTrustTier,
  emptyTrustFactors,
  type TrustFactors,
} from '../../../src/waves/community-trust.js';

describe('community-trust', () => {
  describe('computeTrustScore', () => {
    it('returns 0 for empty factors', () => {
      const score = computeTrustScore(emptyTrustFactors());
      expect(score).toBe(0);
    });

    it('returns max 100 for perfect factors', () => {
      const factors: TrustFactors = {
        scanPassed: true,
        highFindings: 0,
        criticalFindings: 0,
        sandboxPassed: true,
        reviewCount: 20,
        averageRating: 5,
        installCount: 100000,
        authorPublishedCount: 10,
        daysSincePublish: 365,
      };
      expect(computeTrustScore(factors)).toBe(100);
    });

    it('gives 30 points for clean scan', () => {
      const factors: TrustFactors = {
        ...emptyTrustFactors(),
        scanPassed: true,
      };
      expect(computeTrustScore(factors)).toBe(30);
    });

    it('gives 0 for failed scan regardless of other factors', () => {
      const factors: TrustFactors = {
        ...emptyTrustFactors(),
        scanPassed: false,
        sandboxPassed: true,
      };
      expect(computeTrustScore(factors)).toBe(15); // only sandbox points
    });

    it('penalizes high findings from scan score', () => {
      const clean: TrustFactors = { ...emptyTrustFactors(), scanPassed: true };
      const withHigh: TrustFactors = { ...clean, highFindings: 2 };
      expect(computeTrustScore(withHigh)).toBe(10); // 30 - 20 = 10
    });

    it('clamps scan score to 0 on critical findings', () => {
      const factors: TrustFactors = {
        ...emptyTrustFactors(),
        scanPassed: true,
        criticalFindings: 1,
      };
      expect(computeTrustScore(factors)).toBe(0); // 30 - 30 = 0
    });

    it('gives 15 points for sandbox pass', () => {
      const factors: TrustFactors = {
        ...emptyTrustFactors(),
        sandboxPassed: true,
      };
      expect(computeTrustScore(factors)).toBe(15);
    });

    it('gives 0 for sandbox fail', () => {
      const factors: TrustFactors = {
        ...emptyTrustFactors(),
        sandboxPassed: false,
      };
      expect(computeTrustScore(factors)).toBe(0);
    });

    it('scales review count linearly up to 10 reviews', () => {
      const with5 = computeTrustScore({ ...emptyTrustFactors(), reviewCount: 5 });
      const with10 = computeTrustScore({ ...emptyTrustFactors(), reviewCount: 10 });
      const with20 = computeTrustScore({ ...emptyTrustFactors(), reviewCount: 20 });

      expect(with5).toBe(8);  // 5 * 1.5 = 7.5 → 8
      expect(with10).toBe(15); // 10 * 1.5 = 15
      expect(with20).toBe(15); // capped at 10 reviews
    });

    it('scales average rating proportionally', () => {
      const with3 = computeTrustScore({ ...emptyTrustFactors(), averageRating: 3 });
      const with5 = computeTrustScore({ ...emptyTrustFactors(), averageRating: 5 });

      expect(with3).toBe(9);  // (3/5) * 15 = 9
      expect(with5).toBe(15); // (5/5) * 15 = 15
    });

    it('uses logarithmic scaling for install count', () => {
      const with1 = computeTrustScore({ ...emptyTrustFactors(), installCount: 1 });
      const with100 = computeTrustScore({ ...emptyTrustFactors(), installCount: 100 });
      const with10000 = computeTrustScore({ ...emptyTrustFactors(), installCount: 10000 });

      expect(with1).toBe(2);    // log10(2) * 5 ≈ 1.5 → 2
      expect(with100).toBe(10); // log10(101) * 5 ≈ 10.02 → 10
      expect(with10000).toBe(10); // capped at 10
    });

    it('gives author history points', () => {
      const with3 = computeTrustScore({ ...emptyTrustFactors(), authorPublishedCount: 3 });
      const with5 = computeTrustScore({ ...emptyTrustFactors(), authorPublishedCount: 5 });
      const with10 = computeTrustScore({ ...emptyTrustFactors(), authorPublishedCount: 10 });

      expect(with3).toBe(6);  // 3 * 2 = 6
      expect(with5).toBe(10); // 5 * 2 = 10
      expect(with10).toBe(10); // capped at 10
    });

    it('gives age points slowly', () => {
      const with30 = computeTrustScore({ ...emptyTrustFactors(), daysSincePublish: 30 });
      const with150 = computeTrustScore({ ...emptyTrustFactors(), daysSincePublish: 150 });
      const with300 = computeTrustScore({ ...emptyTrustFactors(), daysSincePublish: 300 });

      expect(with30).toBe(1);  // 30/30 = 1
      expect(with150).toBe(5); // 150/30 = 5
      expect(with300).toBe(5); // capped at 5
    });

    it('never goes below 0', () => {
      const factors: TrustFactors = {
        scanPassed: false,
        highFindings: 10,
        criticalFindings: 5,
        sandboxPassed: false,
        reviewCount: 0,
        averageRating: 0,
        installCount: 0,
        authorPublishedCount: 0,
        daysSincePublish: 0,
      };
      expect(computeTrustScore(factors)).toBe(0);
    });

    it('never goes above 100', () => {
      const factors: TrustFactors = {
        scanPassed: true,
        highFindings: 0,
        criticalFindings: 0,
        sandboxPassed: true,
        reviewCount: 1000,
        averageRating: 5,
        installCount: 1000000,
        authorPublishedCount: 100,
        daysSincePublish: 10000,
      };
      expect(computeTrustScore(factors)).toBe(100);
    });

    it('combines multiple factors correctly', () => {
      const factors: TrustFactors = {
        scanPassed: true,
        highFindings: 0,
        criticalFindings: 0,
        sandboxPassed: true,
        reviewCount: 5,
        averageRating: 4,
        installCount: 50,
        authorPublishedCount: 2,
        daysSincePublish: 60,
      };
      // scan: 30, sandbox: 15, reviews: 7.5, rating: 12, installs: ~8.6, author: 4, age: 2
      const score = computeTrustScore(factors);
      expect(score).toBeGreaterThan(70);
      expect(score).toBeLessThan(85);
    });
  });

  describe('getTrustTier', () => {
    it('returns "trusted" for scores 80-100', () => {
      expect(getTrustTier(80)).toBe('trusted');
      expect(getTrustTier(100)).toBe('trusted');
      expect(getTrustTier(90)).toBe('trusted');
    });

    it('returns "community" for scores 50-79', () => {
      expect(getTrustTier(50)).toBe('community');
      expect(getTrustTier(79)).toBe('community');
      expect(getTrustTier(65)).toBe('community');
    });

    it('returns "new" for scores 20-49', () => {
      expect(getTrustTier(20)).toBe('new');
      expect(getTrustTier(49)).toBe('new');
      expect(getTrustTier(35)).toBe('new');
    });

    it('returns "unreviewed" for scores 0-19', () => {
      expect(getTrustTier(0)).toBe('unreviewed');
      expect(getTrustTier(19)).toBe('unreviewed');
      expect(getTrustTier(10)).toBe('unreviewed');
    });
  });

  describe('emptyTrustFactors', () => {
    it('returns all-zero/false factors', () => {
      const factors = emptyTrustFactors();
      expect(factors.scanPassed).toBe(false);
      expect(factors.highFindings).toBe(0);
      expect(factors.criticalFindings).toBe(0);
      expect(factors.sandboxPassed).toBe(false);
      expect(factors.reviewCount).toBe(0);
      expect(factors.averageRating).toBe(0);
      expect(factors.installCount).toBe(0);
      expect(factors.authorPublishedCount).toBe(0);
      expect(factors.daysSincePublish).toBe(0);
    });

    it('produces a score of 0', () => {
      expect(computeTrustScore(emptyTrustFactors())).toBe(0);
    });
  });
});
