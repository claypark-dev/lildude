import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase } from '../../../src/persistence/db.js';
import { readFile, writeFile, listDirectory } from '../../../src/tools/filesystem.js';
import { getRecentSecurityLogs } from '../../../src/persistence/security-log.js';
import type { DatabaseManager } from '../../../src/persistence/db.js';
import type BetterSqlite3 from 'better-sqlite3';
import { mkdtemp, rm, writeFile as fsWriteFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

function createTestDb(): DatabaseManager {
  const dbManager = createDatabase(':memory:');
  dbManager.runMigrations();
  return dbManager;
}

describe('filesystem tools', () => {
  let dbManager: DatabaseManager;
  let db: BetterSqlite3.Database;
  let tempDir: string;

  beforeEach(async () => {
    dbManager = createTestDb();
    db = dbManager.db;
    // Use home directory for temp dir — macOS tmpdir() returns /var/folders/
    // which is blocked by the /var always-blocked directory rule
    const testBase = join(homedir(), '.lil-dude-test');
    await mkdir(testBase, { recursive: true });
    tempDir = await mkdtemp(join(testBase, 'fs-'));
  });

  afterEach(async () => {
    try {
      dbManager.close();
    } catch {
      // best-effort cleanup
    }
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  });

  describe('readFile', () => {
    it('blocks reading /etc/passwd (always-blocked path)', async () => {
      const result = await readFile(db, '/etc/passwd', 5);

      expect(result.success).toBe(false);
      expect(result.error).toContain('denied');
      expect(result.metadata?.riskLevel).toBe('critical');

      const logs = getRecentSecurityLogs(db, 1);
      expect(logs).toHaveLength(1);
      expect(logs[0].allowed).toBe(false);
      expect(logs[0].actionType).toBe('file_read');
    });

    it('blocks reading /etc/shadow', async () => {
      const result = await readFile(db, '/etc/shadow', 5);

      expect(result.success).toBe(false);
      expect(result.error).toContain('denied');
    });

    it('blocks reading /usr/bin/secret', async () => {
      const result = await readFile(db, '/usr/bin/secret', 5);

      expect(result.success).toBe(false);
      expect(result.error).toContain('denied');
    });

    it('blocks reading /root/.ssh/id_rsa', async () => {
      const result = await readFile(db, '/root/.ssh/id_rsa', 5);

      expect(result.success).toBe(false);
      expect(result.error).toContain('denied');
    });

    it('allows reading files in allowed directories at level 5', async () => {
      const testFile = join(tempDir, 'test.txt');
      await fsWriteFile(testFile, 'hello from test', 'utf-8');

      // Level 5 allows everything not always-blocked
      const result = await readFile(db, testFile, 5);

      expect(result.success).toBe(true);
      expect(result.output).toBe('hello from test');
      expect(result.metadata?.fileSize).toBeDefined();

      const logs = getRecentSecurityLogs(db, 1);
      expect(logs).toHaveLength(1);
      expect(logs[0].allowed).toBe(true);
      expect(logs[0].actionType).toBe('file_read');
    });

    it('requires approval for unknown paths at level 2-3', async () => {
      const testFile = join(tempDir, 'test.txt');
      await fsWriteFile(testFile, 'content', 'utf-8');

      const result = await readFile(db, testFile, 2);

      expect(result.success).toBe(false);
      expect(result.error).toContain('approval');
      expect(result.metadata?.needsApproval).toBe(true);
    });

    it('handles non-existent file gracefully', async () => {
      const result = await readFile(db, join(tempDir, 'nonexistent.txt'), 5);

      expect(result.success).toBe(false);
      expect(result.error).toContain('error');
    });

    it('logs read operations to security log', async () => {
      const testFile = join(tempDir, 'logged.txt');
      await fsWriteFile(testFile, 'logged content', 'utf-8');

      await readFile(db, testFile, 5, 'task-read-1');

      const logs = getRecentSecurityLogs(db, 1);
      expect(logs).toHaveLength(1);
      expect(logs[0].taskId).toBe('task-read-1');
      expect(logs[0].actionDetail).toBe(testFile);
    });
  });

  describe('writeFile', () => {
    it('blocks writing to /etc/hosts', async () => {
      const result = await writeFile(db, '/etc/hosts', 'malicious content', 5);

      expect(result.success).toBe(false);
      expect(result.error).toContain('denied');
    });

    it('blocks writing to /usr/local/bin/evil', async () => {
      const result = await writeFile(db, '/usr/bin/evil', 'malicious', 5);

      expect(result.success).toBe(false);
      expect(result.error).toContain('denied');
    });

    it('blocks writing to system directories', async () => {
      const result = await writeFile(db, '/System/Library/evil.plist', 'bad', 5);

      expect(result.success).toBe(false);
      expect(result.error).toContain('denied');
    });

    it('allows writing to temp directories at level 5', async () => {
      const testFile = join(tempDir, 'output.txt');

      const result = await writeFile(db, testFile, 'written content', 5);

      expect(result.success).toBe(true);
      expect(result.output).toContain('written successfully');
      expect(result.metadata?.bytesWritten).toBeGreaterThan(0);

      const logs = getRecentSecurityLogs(db, 1);
      expect(logs).toHaveLength(1);
      expect(logs[0].allowed).toBe(true);
      expect(logs[0].actionType).toBe('file_write');
    });

    it('requires approval for unknown paths at level 2-3', async () => {
      const testFile = join(tempDir, 'output.txt');

      const result = await writeFile(db, testFile, 'content', 2);

      expect(result.success).toBe(false);
      expect(result.error).toContain('approval');
      expect(result.metadata?.needsApproval).toBe(true);
    });

    it('logs write operations to security log', async () => {
      const testFile = join(tempDir, 'logged-write.txt');

      await writeFile(db, testFile, 'content', 5, 'task-write-1');

      const logs = getRecentSecurityLogs(db, 1);
      expect(logs).toHaveLength(1);
      expect(logs[0].taskId).toBe('task-write-1');
      expect(logs[0].actionType).toBe('file_write');
    });
  });

  describe('listDirectory', () => {
    it('blocks listing /etc', async () => {
      const result = await listDirectory(db, '/etc', 5);

      expect(result.success).toBe(false);
      expect(result.error).toContain('denied');
    });

    it('blocks listing /root', async () => {
      const result = await listDirectory(db, '/root', 5);

      expect(result.success).toBe(false);
      expect(result.error).toContain('denied');
    });

    it('blocks listing /var', async () => {
      const result = await listDirectory(db, '/var', 5);

      expect(result.success).toBe(false);
      expect(result.error).toContain('denied');
    });

    it('allows listing temp directories at level 5', async () => {
      // Create some test files in the temp directory
      await fsWriteFile(join(tempDir, 'file1.txt'), 'a', 'utf-8');
      await fsWriteFile(join(tempDir, 'file2.txt'), 'b', 'utf-8');

      const result = await listDirectory(db, tempDir, 5);

      expect(result.success).toBe(true);
      expect(result.output).toContain('file1.txt');
      expect(result.output).toContain('file2.txt');
      expect(result.metadata?.entryCount).toBe(2);

      const logs = getRecentSecurityLogs(db, 1);
      expect(logs).toHaveLength(1);
      expect(logs[0].allowed).toBe(true);
      expect(logs[0].actionType).toBe('directory_list');
    });

    it('handles non-existent directory gracefully', async () => {
      const result = await listDirectory(db, join(tempDir, 'nonexistent'), 5);

      expect(result.success).toBe(false);
      expect(result.error).toContain('error');
    });

    it('requires approval for unknown paths at level 2-3', async () => {
      const result = await listDirectory(db, tempDir, 2);

      expect(result.success).toBe(false);
      expect(result.error).toContain('approval');
      expect(result.metadata?.needsApproval).toBe(true);
    });

    it('logs listing operations to security log', async () => {
      await listDirectory(db, tempDir, 5, 'task-list-1');

      const logs = getRecentSecurityLogs(db, 1);
      expect(logs).toHaveLength(1);
      expect(logs[0].taskId).toBe('task-list-1');
      expect(logs[0].actionDetail).toBe(tempDir);
    });
  });
});
