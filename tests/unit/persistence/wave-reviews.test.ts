import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  addReview,
  getReviews,
  getAverageRating,
  getAllAverageRatings,
} from '../../../src/persistence/wave-reviews.js';

const MIGRATIONS_DIR = join(process.cwd(), 'src/persistence/migrations');

function runMigrations(db: Database.Database): void {
  const files = [
    '001_initial.sql',
    '003_waves_foundation.sql',
    '007_wave_hub.sql',
    '014_waves_hub_enhanced.sql',
  ];
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
    db.exec(sql);
  }
}

describe('wave-reviews DAL', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('addReview', () => {
    it('creates a review with default reviewer when not specified', () => {
      const review = addReview(db, { waveName: 'weather-checker', rating: 4 });

      expect(review.id).toMatch(/^rev_/);
      expect(review.waveName).toBe('weather-checker');
      expect(review.rating).toBe(4);
      expect(review.reviewer).toBe('owner');
      expect(review.comment).toBeNull();
      expect(review.createdAt).toBeInstanceOf(Date);
    });

    it('creates a review with a comment and custom reviewer', () => {
      const review = addReview(db, {
        waveName: 'email-reader',
        rating: 5,
        comment: 'Excellent wave!',
        reviewer: 'alice',
      });

      expect(review.waveName).toBe('email-reader');
      expect(review.rating).toBe(5);
      expect(review.comment).toBe('Excellent wave!');
      expect(review.reviewer).toBe('alice');
    });

    it('rejects a rating of 0', () => {
      expect(() => addReview(db, { waveName: 'test-wave', rating: 0 })).toThrow(
        'Rating must be an integer between 1 and 5',
      );
    });

    it('rejects a rating of 6', () => {
      expect(() => addReview(db, { waveName: 'test-wave', rating: 6 })).toThrow(
        'Rating must be an integer between 1 and 5',
      );
    });

    it('rejects a non-integer rating', () => {
      expect(() => addReview(db, { waveName: 'test-wave', rating: 3.5 })).toThrow(
        'Rating must be an integer between 1 and 5',
      );
    });

    it('allows multiple reviews for the same wave', () => {
      addReview(db, { waveName: 'multi-review-wave', rating: 3 });
      addReview(db, { waveName: 'multi-review-wave', rating: 5 });

      const reviews = getReviews(db, 'multi-review-wave');
      expect(reviews).toHaveLength(2);
    });
  });

  describe('getReviews', () => {
    it('returns all reviews for a wave', () => {
      addReview(db, { waveName: 'popular-wave', rating: 5 });
      addReview(db, { waveName: 'popular-wave', rating: 4, comment: 'Great!' });
      addReview(db, { waveName: 'popular-wave', rating: 3 });

      const reviews = getReviews(db, 'popular-wave');
      expect(reviews).toHaveLength(3);
    });

    it('returns empty array for a wave with no reviews', () => {
      const reviews = getReviews(db, 'unreviewed-wave');
      expect(reviews).toHaveLength(0);
    });

    it('respects the limit parameter', () => {
      for (let idx = 0; idx < 10; idx++) {
        addReview(db, { waveName: 'busy-wave', rating: ((idx % 5) + 1) });
      }

      const reviews = getReviews(db, 'busy-wave', 3);
      expect(reviews).toHaveLength(3);
    });

    it('returns all reviews ordered by created_at descending', () => {
      addReview(db, { waveName: 'ordered-wave', rating: 2 });
      addReview(db, { waveName: 'ordered-wave', rating: 5 });

      const reviews = getReviews(db, 'ordered-wave');
      expect(reviews).toHaveLength(2);

      // Verify ordering is descending by created_at (dates must be non-ascending)
      for (let idx = 0; idx < reviews.length - 1; idx++) {
        expect(reviews[idx].createdAt.getTime()).toBeGreaterThanOrEqual(
          reviews[idx + 1].createdAt.getTime(),
        );
      }
    });
  });

  describe('getAverageRating', () => {
    it('computes average from multiple reviews', () => {
      addReview(db, { waveName: 'rated-wave', rating: 4 });
      addReview(db, { waveName: 'rated-wave', rating: 5 });
      addReview(db, { waveName: 'rated-wave', rating: 3 });

      const aggregate = getAverageRating(db, 'rated-wave');
      expect(aggregate).not.toBeNull();
      expect(aggregate!.waveName).toBe('rated-wave');
      // (4 + 5 + 3) / 3 = 4.0
      expect(aggregate!.averageRating).toBeCloseTo(4.0, 1);
      expect(aggregate!.ratingCount).toBe(3);
    });

    it('returns null for a wave with no reviews', () => {
      const aggregate = getAverageRating(db, 'no-reviews-wave');
      expect(aggregate).toBeNull();
    });

    it('rounds average rating to one decimal place', () => {
      addReview(db, { waveName: 'rounding-wave', rating: 4 });
      addReview(db, { waveName: 'rounding-wave', rating: 5 });

      const aggregate = getAverageRating(db, 'rounding-wave');
      // (4 + 5) / 2 = 4.5
      expect(aggregate!.averageRating).toBe(4.5);
    });
  });

  describe('getAllAverageRatings', () => {
    it('returns aggregate ratings for all reviewed waves', () => {
      addReview(db, { waveName: 'wave-alpha', rating: 5 });
      addReview(db, { waveName: 'wave-beta', rating: 3 });
      addReview(db, { waveName: 'wave-gamma', rating: 4 });

      const aggregates = getAllAverageRatings(db);
      expect(aggregates).toHaveLength(3);

      const names = aggregates.map((a) => a.waveName);
      expect(names).toContain('wave-alpha');
      expect(names).toContain('wave-beta');
      expect(names).toContain('wave-gamma');
    });

    it('returns empty array when no reviews exist', () => {
      const aggregates = getAllAverageRatings(db);
      expect(aggregates).toHaveLength(0);
    });

    it('sorts results by average rating descending', () => {
      addReview(db, { waveName: 'low-rated', rating: 2 });
      addReview(db, { waveName: 'high-rated', rating: 5 });
      addReview(db, { waveName: 'mid-rated', rating: 3 });

      const aggregates = getAllAverageRatings(db);
      expect(aggregates[0].waveName).toBe('high-rated');
      expect(aggregates[aggregates.length - 1].waveName).toBe('low-rated');
    });

    it('includes correct ratingCount per wave', () => {
      addReview(db, { waveName: 'counted-wave', rating: 4 });
      addReview(db, { waveName: 'counted-wave', rating: 5 });

      const aggregates = getAllAverageRatings(db);
      const counted = aggregates.find((a) => a.waveName === 'counted-wave');
      expect(counted).not.toBeUndefined();
      expect(counted!.ratingCount).toBe(2);
    });
  });
});
