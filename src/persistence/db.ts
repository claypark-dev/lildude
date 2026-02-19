/**
 * SQLite database manager with migration runner.
 * Opens a better-sqlite3 connection, configures WAL mode and foreign keys,
 * and runs pending .sql migrations from the migrations directory.
 * See HLD Section 10.
 */

import Database from 'better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { persistenceLogger } from '../utils/logger.js';
import { PersistenceError } from '../errors.js';

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_MIGRATIONS_DIR = join(MODULE_DIR, 'migrations');

/** Represents a managed SQLite database connection with migration support. */
export interface DatabaseManager {
  /** The underlying better-sqlite3 Database instance for use by DAL modules. */
  readonly db: BetterSqlite3.Database;

  /**
   * Run all pending SQL migrations from the migrations directory.
   * Migrations are executed in filename order within a transaction.
   * Already-applied migrations (tracked in the `migrations` table) are skipped.
   * @throws {PersistenceError} If any migration fails to apply.
   */
  runMigrations(): void;

  /**
   * Close the database connection.
   * @throws {PersistenceError} If the connection cannot be closed cleanly.
   */
  close(): void;
}

interface MigrationFile {
  name: string;
  sql: string;
}

/**
 * Create and configure a SQLite database at the given path.
 * Enables WAL journal mode and foreign key enforcement.
 * @param dbPath - Filesystem path for the SQLite database file (or ':memory:' for in-memory).
 * @param migrationsDir - Optional path to the directory containing .sql migration files.
 *                        Defaults to the bundled `migrations/` directory.
 * @returns A configured {@link DatabaseManager} instance.
 * @throws {PersistenceError} If the database cannot be opened or configured.
 */
export function createDatabase(
  dbPath: string,
  migrationsDir: string = DEFAULT_MIGRATIONS_DIR,
): DatabaseManager {
  let database: BetterSqlite3.Database;

  try {
    database = new Database(dbPath);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to open database at "${dbPath}": ${message}`);
  }

  try {
    database.pragma('journal_mode = WAL');
    database.pragma('foreign_keys = ON');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    database.close();
    throw new PersistenceError(`Failed to configure database pragmas: ${message}`);
  }

  persistenceLogger.info({ dbPath }, 'Database connection opened');

  return {
    get db(): BetterSqlite3.Database {
      return database;
    },

    runMigrations(): void {
      ensureMigrationsTable(database);

      const migrationFiles = readMigrationFiles(migrationsDir);
      const appliedNames = getAppliedMigrations(database);
      const pendingMigrations = migrationFiles.filter(
        (migration) => !appliedNames.has(migration.name),
      );

      if (pendingMigrations.length === 0) {
        persistenceLogger.info('No pending migrations');
        return;
      }

      persistenceLogger.info(
        { count: pendingMigrations.length },
        'Running pending migrations',
      );

      const applyAll = database.transaction(() => {
        for (const migration of pendingMigrations) {
          try {
            database.exec(migration.sql);
            database.prepare(
              'INSERT INTO migrations (name) VALUES (?)',
            ).run(migration.name);
            persistenceLogger.info({ migration: migration.name }, 'Migration applied');
          } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            throw new PersistenceError(
              `Migration "${migration.name}" failed: ${errorMessage}`,
            );
          }
        }
      });

      try {
        applyAll();
      } catch (error: unknown) {
        if (error instanceof PersistenceError) {
          throw error;
        }
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new PersistenceError(`Migration transaction failed: ${errorMessage}`);
      }

      persistenceLogger.info(
        { applied: pendingMigrations.length },
        'All migrations applied successfully',
      );
    },

    close(): void {
      try {
        database.close();
        persistenceLogger.info('Database connection closed');
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        throw new PersistenceError(`Failed to close database: ${message}`);
      }
    },
  };
}

/**
 * Ensure the migrations tracking table exists.
 * @param database - The open database connection.
 */
function ensureMigrationsTable(database: BetterSqlite3.Database): void {
  try {
    database.exec(`
      CREATE TABLE IF NOT EXISTS migrations (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to create migrations table: ${message}`);
  }
}

/**
 * Read and sort all .sql migration files from the given directory.
 * @param migrationsDir - Path to the migrations directory.
 * @returns Sorted array of migration file names and their SQL content.
 */
function readMigrationFiles(migrationsDir: string): MigrationFile[] {
  try {
    const files = readdirSync(migrationsDir)
      .filter((filename) => filename.endsWith('.sql'))
      .sort();

    return files.map((filename) => ({
      name: filename,
      sql: readFileSync(join(migrationsDir, filename), 'utf-8'),
    }));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(
      `Failed to read migration files from "${migrationsDir}": ${message}`,
    );
  }
}

/**
 * Query the set of already-applied migration names from the database.
 * @param database - The open database connection.
 * @returns A Set of migration filenames that have been applied.
 */
function getAppliedMigrations(database: BetterSqlite3.Database): Set<string> {
  try {
    const rows = database
      .prepare('SELECT name FROM migrations')
      .all() as Array<{ name: string }>;

    return new Set(rows.map((row) => row.name));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to read applied migrations: ${message}`);
  }
}
