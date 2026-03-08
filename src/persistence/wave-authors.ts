/**
 * Wave authors DAL.
 * Tracks community author profiles linked to GitHub identity.
 */

import type BetterSqlite3 from 'better-sqlite3';
import { PersistenceError } from '../errors.js';
import { persistenceLogger } from '../utils/logger.js';

/** Application-level author profile. */
export interface WaveAuthor {
  githubUsername: string;
  displayName: string | null;
  avatarUrl: string | null;
  publishedCount: number;
  totalInstalls: number;
  averageRating: number;
  joinedAt: Date;
  updatedAt: Date;
}

/** Raw DB row. */
interface AuthorDbRow {
  github_username: string;
  display_name: string | null;
  avatar_url: string | null;
  published_count: number;
  total_installs: number;
  average_rating: number;
  joined_at: string;
  updated_at: string;
}

/**
 * Map a raw DB row to an application-level WaveAuthor.
 * @param row - The raw database row.
 * @returns The mapped WaveAuthor.
 */
function mapRow(row: AuthorDbRow): WaveAuthor {
  return {
    githubUsername: row.github_username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    publishedCount: row.published_count,
    totalInstalls: row.total_installs,
    averageRating: row.average_rating,
    joinedAt: new Date(row.joined_at),
    updatedAt: new Date(row.updated_at),
  };
}

/**
 * Get or create an author profile.
 * @param db - Database connection.
 * @param githubUsername - The GitHub username.
 * @param displayName - Optional display name.
 * @param avatarUrl - Optional avatar URL.
 * @returns The author profile.
 */
export function upsertAuthor(
  db: BetterSqlite3.Database,
  githubUsername: string,
  displayName?: string,
  avatarUrl?: string,
): WaveAuthor {
  try {
    db.prepare(
      `INSERT INTO wave_authors (github_username, display_name, avatar_url)
       VALUES (?, ?, ?)
       ON CONFLICT(github_username) DO UPDATE SET
         display_name = COALESCE(excluded.display_name, wave_authors.display_name),
         avatar_url = COALESCE(excluded.avatar_url, wave_authors.avatar_url),
         updated_at = datetime('now')`,
    ).run(githubUsername, displayName ?? null, avatarUrl ?? null);

    const row = db.prepare(
      'SELECT * FROM wave_authors WHERE github_username = ?',
    ).get(githubUsername) as AuthorDbRow;

    persistenceLogger.debug({ githubUsername }, 'Author upserted');
    return mapRow(row);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to upsert author: ${message}`);
  }
}

/**
 * Get an author profile by GitHub username.
 * @param db - Database connection.
 * @param githubUsername - The GitHub username.
 * @returns The author profile, or null if not found.
 */
export function getAuthor(
  db: BetterSqlite3.Database,
  githubUsername: string,
): WaveAuthor | null {
  try {
    const row = db.prepare(
      'SELECT * FROM wave_authors WHERE github_username = ?',
    ).get(githubUsername) as AuthorDbRow | undefined;
    return row ? mapRow(row) : null;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get author: ${message}`);
  }
}

/**
 * Increment an author's published count.
 * @param db - Database connection.
 * @param githubUsername - The GitHub username.
 */
export function incrementPublishedCount(
  db: BetterSqlite3.Database,
  githubUsername: string,
): void {
  try {
    db.prepare(
      `UPDATE wave_authors
       SET published_count = published_count + 1, updated_at = datetime('now')
       WHERE github_username = ?`,
    ).run(githubUsername);
    persistenceLogger.debug({ githubUsername }, 'Published count incremented');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to increment published count: ${message}`);
  }
}

/**
 * Update an author's aggregate stats.
 * @param db - Database connection.
 * @param githubUsername - The GitHub username.
 * @param totalInstalls - New total install count.
 * @param averageRating - New average rating.
 */
export function updateAuthorStats(
  db: BetterSqlite3.Database,
  githubUsername: string,
  totalInstalls: number,
  averageRating: number,
): void {
  try {
    db.prepare(
      `UPDATE wave_authors
       SET total_installs = ?, average_rating = ?, updated_at = datetime('now')
       WHERE github_username = ?`,
    ).run(totalInstalls, averageRating, githubUsername);
    persistenceLogger.debug({ githubUsername }, 'Author stats updated');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to update author stats: ${message}`);
  }
}

/**
 * List all known authors, ordered by published count descending.
 * @param db - Database connection.
 * @param limit - Maximum results (default 50).
 * @returns Array of author profiles.
 */
export function listAuthors(
  db: BetterSqlite3.Database,
  limit: number = 50,
): WaveAuthor[] {
  try {
    const rows = db.prepare(
      'SELECT * FROM wave_authors ORDER BY published_count DESC LIMIT ?',
    ).all(limit) as AuthorDbRow[];
    return rows.map(mapRow);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to list authors: ${message}`);
  }
}
