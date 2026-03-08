import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  upsertAuthor,
  getAuthor,
  incrementPublishedCount,
  updateAuthorStats,
  listAuthors,
} from '../../../src/persistence/wave-authors.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  const migrationSql = readFileSync(
    join(__dirname, '../../../src/persistence/migrations/018_community_publishing.sql'),
    'utf-8',
  );
  db.exec(migrationSql);
  return db;
}

describe('wave-authors', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  describe('upsertAuthor', () => {
    it('creates a new author profile', () => {
      const author = upsertAuthor(db, 'testuser', 'Test User', 'https://avatar.example.com');
      expect(author.githubUsername).toBe('testuser');
      expect(author.displayName).toBe('Test User');
      expect(author.avatarUrl).toBe('https://avatar.example.com');
      expect(author.publishedCount).toBe(0);
    });

    it('updates existing author without overwriting non-null fields', () => {
      upsertAuthor(db, 'testuser', 'Original Name', 'https://avatar.com');
      const updated = upsertAuthor(db, 'testuser', 'New Name');
      expect(updated.displayName).toBe('New Name');
      expect(updated.avatarUrl).toBe('https://avatar.com'); // preserved
    });

    it('creates author with minimal info', () => {
      const author = upsertAuthor(db, 'minimal');
      expect(author.githubUsername).toBe('minimal');
      expect(author.displayName).toBeNull();
      expect(author.avatarUrl).toBeNull();
    });
  });

  describe('getAuthor', () => {
    it('returns author by username', () => {
      upsertAuthor(db, 'testuser', 'Test User');
      const author = getAuthor(db, 'testuser');
      expect(author).not.toBeNull();
      expect(author!.githubUsername).toBe('testuser');
    });

    it('returns null for nonexistent author', () => {
      expect(getAuthor(db, 'nobody')).toBeNull();
    });
  });

  describe('incrementPublishedCount', () => {
    it('increments the count', () => {
      upsertAuthor(db, 'testuser');
      incrementPublishedCount(db, 'testuser');
      incrementPublishedCount(db, 'testuser');
      const author = getAuthor(db, 'testuser');
      expect(author!.publishedCount).toBe(2);
    });
  });

  describe('updateAuthorStats', () => {
    it('updates total installs and average rating', () => {
      upsertAuthor(db, 'testuser');
      updateAuthorStats(db, 'testuser', 100, 4.5);
      const author = getAuthor(db, 'testuser');
      expect(author!.totalInstalls).toBe(100);
      expect(author!.averageRating).toBe(4.5);
    });
  });

  describe('listAuthors', () => {
    it('returns authors sorted by published count', () => {
      upsertAuthor(db, 'user-a');
      upsertAuthor(db, 'user-b');
      incrementPublishedCount(db, 'user-b');
      incrementPublishedCount(db, 'user-b');
      incrementPublishedCount(db, 'user-a');

      const authors = listAuthors(db);
      expect(authors.length).toBe(2);
      expect(authors[0].githubUsername).toBe('user-b');
      expect(authors[0].publishedCount).toBe(2);
    });

    it('returns empty array when no authors exist', () => {
      expect(listAuthors(db)).toEqual([]);
    });

    it('respects limit parameter', () => {
      upsertAuthor(db, 'user-a');
      upsertAuthor(db, 'user-b');
      upsertAuthor(db, 'user-c');
      expect(listAuthors(db, 2).length).toBe(2);
    });
  });
});
