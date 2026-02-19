import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import { createDatabase, type DatabaseManager } from '../../../src/persistence/db.js';

/** Resolve the real migrations directory shipped with the source. */
const MIGRATIONS_DIR = join(__dirname, '..', '..', '..', 'src', 'persistence', 'migrations');

describe('DatabaseManager', () => {
  let tmpDir: string;
  let dbPath: string;
  let manager: DatabaseManager | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(os.tmpdir(), 'lildude-db-test-'));
    dbPath = join(tmpDir, 'test.db');
    manager = undefined;
  });

  afterEach(() => {
    try {
      manager?.close();
    } catch {
      // best-effort cleanup
    }
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  });

  it('creates a database file at the given path', () => {
    manager = createDatabase(dbPath, MIGRATIONS_DIR);
    expect(manager.db).toBeDefined();
  });

  it('enables WAL journal mode', () => {
    manager = createDatabase(dbPath, MIGRATIONS_DIR);
    const journalMode = manager.db.pragma('journal_mode', { simple: true });
    expect(journalMode).toBe('wal');
  });

  it('enables foreign keys', () => {
    manager = createDatabase(dbPath, MIGRATIONS_DIR);
    const fkEnabled = manager.db.pragma('foreign_keys', { simple: true });
    expect(fkEnabled).toBe(1);
  });

  it('runs migrations successfully', () => {
    manager = createDatabase(dbPath, MIGRATIONS_DIR);
    expect(() => manager!.runMigrations()).not.toThrow();
  });

  it('creates the migrations tracking table', () => {
    manager = createDatabase(dbPath, MIGRATIONS_DIR);
    manager.runMigrations();

    const tables = manager.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='migrations'")
      .all() as Array<{ name: string }>;

    expect(tables).toHaveLength(1);
    expect(tables[0].name).toBe('migrations');
  });

  it('records applied migrations in the migrations table', () => {
    manager = createDatabase(dbPath, MIGRATIONS_DIR);
    manager.runMigrations();

    const applied = manager.db
      .prepare('SELECT name FROM migrations ORDER BY id')
      .all() as Array<{ name: string }>;

    expect(applied.length).toBeGreaterThanOrEqual(1);
    expect(applied[0].name).toBe('001_initial.sql');
  });

  it('creates all expected tables after initial migration', () => {
    manager = createDatabase(dbPath, MIGRATIONS_DIR);
    manager.runMigrations();

    const expectedTables = [
      'migrations',
      'config_store',
      'tasks',
      'token_usage',
      'conversations',
      'conversation_logs',
      'knowledge',
      'cron_jobs',
      'security_log',
      'approval_queue',
      'skills_registry',
    ];

    const tables = manager.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>;

    const tableNames = tables.map((row) => row.name);

    for (const expected of expectedTables) {
      expect(tableNames).toContain(expected);
    }
  });

  it('creates expected indexes after initial migration', () => {
    manager = createDatabase(dbPath, MIGRATIONS_DIR);
    manager.runMigrations();

    const expectedIndexes = [
      'idx_token_usage_task',
      'idx_token_usage_created',
      'idx_conv_logs_conv',
      'idx_knowledge_cat_key',
      'idx_knowledge_category',
      'idx_security_log_created',
    ];

    const indexes = manager.db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' ORDER BY name")
      .all() as Array<{ name: string }>;

    const indexNames = indexes.map((row) => row.name);

    for (const expected of expectedIndexes) {
      expect(indexNames).toContain(expected);
    }
  });

  it('is idempotent: running migrations twice does not error', () => {
    manager = createDatabase(dbPath, MIGRATIONS_DIR);
    manager.runMigrations();
    expect(() => manager!.runMigrations()).not.toThrow();
  });

  it('does not duplicate migration records when run twice', () => {
    manager = createDatabase(dbPath, MIGRATIONS_DIR);
    manager.runMigrations();
    manager.runMigrations();

    const applied = manager.db
      .prepare('SELECT name FROM migrations')
      .all() as Array<{ name: string }>;

    const uniqueNames = new Set(applied.map((row) => row.name));
    expect(applied.length).toBe(uniqueNames.size);
  });

  it('applies only new migrations on subsequent runs', () => {
    const customMigrationsDir = join(tmpDir, 'migrations');
    mkdirSync(customMigrationsDir);

    // Write first migration
    writeFileSync(
      join(customMigrationsDir, '001_first.sql'),
      'CREATE TABLE IF NOT EXISTS test_one (id INTEGER PRIMARY KEY);',
    );

    manager = createDatabase(dbPath, customMigrationsDir);
    manager.runMigrations();

    // Verify first migration applied
    const afterFirst = manager.db
      .prepare('SELECT name FROM migrations')
      .all() as Array<{ name: string }>;
    expect(afterFirst).toHaveLength(1);

    // Add second migration
    writeFileSync(
      join(customMigrationsDir, '002_second.sql'),
      'CREATE TABLE IF NOT EXISTS test_two (id INTEGER PRIMARY KEY);',
    );

    manager.runMigrations();

    // Both should now be applied
    const afterSecond = manager.db
      .prepare('SELECT name FROM migrations ORDER BY id')
      .all() as Array<{ name: string }>;
    expect(afterSecond).toHaveLength(2);
    expect(afterSecond[0].name).toBe('001_first.sql');
    expect(afterSecond[1].name).toBe('002_second.sql');

    // Both tables should exist
    const tables = manager.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'test_%'")
      .all() as Array<{ name: string }>;
    expect(tables).toHaveLength(2);
  });

  it('close() works without error', () => {
    manager = createDatabase(dbPath, MIGRATIONS_DIR);
    expect(() => manager!.close()).not.toThrow();
    manager = undefined; // prevent afterEach from double-closing
  });

  it('throws PersistenceError for an invalid database path', () => {
    expect(() =>
      createDatabase('/nonexistent/deeply/nested/path/test.db', MIGRATIONS_DIR),
    ).toThrow('Failed to open database');
  });

  it('throws PersistenceError when migrations directory does not exist', () => {
    manager = createDatabase(dbPath, '/nonexistent/migrations/dir');
    expect(() => manager!.runMigrations()).toThrow('Failed to read migration files');
  });

  it('throws PersistenceError for invalid SQL in a migration', () => {
    const badMigrationsDir = join(tmpDir, 'bad-migrations');
    mkdirSync(badMigrationsDir);
    writeFileSync(
      join(badMigrationsDir, '001_bad.sql'),
      'THIS IS NOT VALID SQL AT ALL;',
    );

    manager = createDatabase(dbPath, badMigrationsDir);
    expect(() => manager!.runMigrations()).toThrow('Migration "001_bad.sql" failed');
  });

  it('enforces foreign key constraints after migration', () => {
    manager = createDatabase(dbPath, MIGRATIONS_DIR);
    manager.runMigrations();

    // Inserting a token_usage record with a non-existent task_id should fail
    const insertStmt = manager.db.prepare(
      `INSERT INTO token_usage (task_id, provider, model, input_tokens, output_tokens, cost_usd)
       VALUES ('nonexistent-task', 'anthropic', 'claude-3', 100, 50, 0.01)`,
    );

    expect(() => insertStmt.run()).toThrow();
  });

  it('allows valid data insertion after migration', () => {
    manager = createDatabase(dbPath, MIGRATIONS_DIR);
    manager.runMigrations();

    // Insert a task first
    manager.db.prepare(
      `INSERT INTO tasks (id, status, type, description)
       VALUES ('task-001', 'pending', 'chat', 'Test task')`,
    ).run();

    // Then insert token_usage referencing that task
    manager.db.prepare(
      `INSERT INTO token_usage (task_id, provider, model, input_tokens, output_tokens, cost_usd)
       VALUES ('task-001', 'anthropic', 'claude-3', 100, 50, 0.01)`,
    ).run();

    const usage = manager.db
      .prepare('SELECT * FROM token_usage WHERE task_id = ?')
      .get('task-001') as Record<string, unknown>;

    expect(usage).toBeDefined();
    expect(usage.provider).toBe('anthropic');
    expect(usage.input_tokens).toBe(100);
  });

  it('enforces CHECK constraints on task status', () => {
    manager = createDatabase(dbPath, MIGRATIONS_DIR);
    manager.runMigrations();

    const insertInvalid = manager.db.prepare(
      `INSERT INTO tasks (id, status, type) VALUES ('task-bad', 'invalid_status', 'chat')`,
    );

    expect(() => insertInvalid.run()).toThrow();
  });

  it('works with an in-memory database', () => {
    manager = createDatabase(':memory:', MIGRATIONS_DIR);
    manager.runMigrations();

    const tables = manager.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as Array<{ name: string }>;

    expect(tables.length).toBeGreaterThan(0);
  });

  it('handles an empty migrations directory gracefully', () => {
    const emptyMigrationsDir = join(tmpDir, 'empty-migrations');
    mkdirSync(emptyMigrationsDir);

    manager = createDatabase(dbPath, emptyMigrationsDir);
    expect(() => manager!.runMigrations()).not.toThrow();
  });
});
