import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  listCategories,
  getCategory,
  getCategoriesWithCounts,
} from '../../../src/persistence/wave-categories.js';

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

describe('wave-categories DAL', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('listCategories', () => {
    it('returns all 9 seeded categories', () => {
      const categories = listCategories(db);
      expect(categories).toHaveLength(9);
    });

    it('returns categories sorted by sort_order ascending', () => {
      const categories = listCategories(db);
      const orders = categories.map((c) => c.sortOrder);
      const sorted = [...orders].sort((a, b) => a - b);
      expect(orders).toEqual(sorted);
    });

    it('maps rows to camelCase application objects', () => {
      const categories = listCategories(db);
      const first = categories[0];

      expect(first).toHaveProperty('id');
      expect(first).toHaveProperty('name');
      expect(first).toHaveProperty('displayName');
      expect(first).toHaveProperty('description');
      expect(first).toHaveProperty('icon');
      expect(first).toHaveProperty('sortOrder');
    });

    it('includes the expected category names', () => {
      const categories = listCategories(db);
      const names = categories.map((c) => c.name);

      expect(names).toContain('productivity');
      expect(names).toContain('communication');
      expect(names).toContain('utilities');
      expect(names).toContain('party');
      expect(names).toContain('developer');
    });
  });

  describe('getCategory', () => {
    it('returns a category by its name', () => {
      const category = getCategory(db, 'productivity');

      expect(category).not.toBeNull();
      expect(category!.name).toBe('productivity');
      expect(category!.displayName).toBe('Productivity');
      expect(category!.sortOrder).toBe(1);
    });

    it('returns the party category correctly', () => {
      const category = getCategory(db, 'party');

      expect(category).not.toBeNull();
      expect(category!.name).toBe('party');
      expect(category!.displayName).toBe('Party Waves');
    });

    it('returns null for an unknown category name', () => {
      const category = getCategory(db, 'non-existent-category');
      expect(category).toBeNull();
    });
  });

  describe('getCategoriesWithCounts', () => {
    it('includes wave counts from the provided map', () => {
      const countMap = new Map([
        ['productivity', 5],
        ['utilities', 3],
      ]);

      const categoriesWithCounts = getCategoriesWithCounts(db, countMap);
      const productivity = categoriesWithCounts.find((c) => c.name === 'productivity');
      const utilities = categoriesWithCounts.find((c) => c.name === 'utilities');

      expect(productivity).not.toBeUndefined();
      expect(productivity!.waveCount).toBe(5);
      expect(utilities).not.toBeUndefined();
      expect(utilities!.waveCount).toBe(3);
    });

    it('returns 0 for categories not present in the map', () => {
      const countMap = new Map<string, number>();

      const categoriesWithCounts = getCategoriesWithCounts(db, countMap);
      for (const cat of categoriesWithCounts) {
        expect(cat.waveCount).toBe(0);
      }
    });

    it('returns all 9 categories with count fields attached', () => {
      const categoriesWithCounts = getCategoriesWithCounts(db, new Map());
      expect(categoriesWithCounts).toHaveLength(9);
      for (const cat of categoriesWithCounts) {
        expect(cat).toHaveProperty('waveCount');
      }
    });
  });
});
