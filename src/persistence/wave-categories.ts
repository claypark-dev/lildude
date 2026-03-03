/**
 * Wave categories DAL.
 * Manages browsing/filtering categories for the Waves Hub.
 */

import type BetterSqlite3 from 'better-sqlite3';
import { PersistenceError } from '../errors.js';

/** Application-level wave category. */
export interface WaveCategory {
  id: string;
  name: string;
  displayName: string;
  description: string | null;
  icon: string | null;
  sortOrder: number;
}

/** Wave category with count of waves. */
export interface WaveCategoryWithCount extends WaveCategory {
  waveCount: number;
}

/** Raw DB row. */
interface WaveCategoryDbRow {
  id: string;
  name: string;
  display_name: string;
  description: string | null;
  icon: string | null;
  sort_order: number;
}

/**
 * Map a raw DB row to an application-level WaveCategory.
 * @param row - The raw database row.
 * @returns The mapped WaveCategory.
 */
function mapRow(row: WaveCategoryDbRow): WaveCategory {
  return {
    id: row.id,
    name: row.name,
    displayName: row.display_name,
    description: row.description,
    icon: row.icon,
    sortOrder: row.sort_order,
  };
}

/**
 * List all wave categories ordered by sort_order.
 * @param db - Database connection.
 * @returns Array of wave categories.
 */
export function listCategories(
  db: BetterSqlite3.Database,
): WaveCategory[] {
  try {
    const rows = db.prepare(
      'SELECT * FROM wave_categories ORDER BY sort_order',
    ).all() as WaveCategoryDbRow[];
    return rows.map(mapRow);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to list wave categories: ${message}`);
  }
}

/**
 * Get a single category by name.
 * @param db - Database connection.
 * @param name - Category name.
 * @returns The category, or null if not found.
 */
export function getCategory(
  db: BetterSqlite3.Database,
  name: string,
): WaveCategory | null {
  try {
    const row = db.prepare(
      'SELECT * FROM wave_categories WHERE name = ?',
    ).get(name) as WaveCategoryDbRow | undefined;
    return row ? mapRow(row) : null;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get wave category: ${message}`);
  }
}

/**
 * Get all categories with wave counts.
 * Counts how many registry entries are associated with each category.
 *
 * @param db - Database connection.
 * @param waveCategoryCounts - Map of category name to wave count (pre-computed).
 * @returns Array of categories with counts.
 */
export function getCategoriesWithCounts(
  db: BetterSqlite3.Database,
  waveCategoryCounts: Map<string, number>,
): WaveCategoryWithCount[] {
  try {
    const categories = listCategories(db);
    return categories.map((cat) => ({
      ...cat,
      waveCount: waveCategoryCounts.get(cat.name) ?? 0,
    }));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get categories with counts: ${message}`);
  }
}
