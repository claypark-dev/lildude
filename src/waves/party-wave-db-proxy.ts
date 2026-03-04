/**
 * Read-only database proxy for party wave execution.
 * Wraps a SQLite connection and restricts access to only
 * party-wave-safe tables and operations.
 *
 * This prevents malicious or misconfigured party waves from
 * querying owner-private tables like conversation_logs, user_profile,
 * or the full knowledge table.
 */

import type BetterSqlite3 from 'better-sqlite3';
import { SecurityError } from '../errors.js';
import { createModuleLogger, securityLogger } from '../utils/logger.js';

const proxyLogger = createModuleLogger('party-wave-db-proxy');

/** Tables that party waves are allowed to read. */
const ALLOWED_READ_TABLES: ReadonlySet<string> = new Set([
  'task_delegations',
  'faq_entries',
  'event_rsvps',
  'document_requests',
  'party_wave_settings',
  'contacts',
  'contact_profiles',
  'waves_registry',
  'wave_categories',
]);

/** Tables that party waves can write to (insert/update only). */
const ALLOWED_WRITE_TABLES: ReadonlySet<string> = new Set([
  'task_delegations',
  'faq_entries',
  'event_rsvps',
  'document_requests',
]);

/** Tables that are explicitly BLOCKED — never accessible to party waves. */
const BLOCKED_TABLES: ReadonlySet<string> = new Set([
  'conversation_logs',
  'conversations',
  'knowledge',
  'knowledge_embeddings',
  'knowledge_fts',
  'user_profile',
  'config_store',
  'security_log',
  'approval_queue',
  'token_usage',
  'tasks',
  'api_keys',
  'oauth_tokens',
  'cron_jobs',
]);

/** SQL statement types we can detect. */
type SqlStatementType = 'select' | 'insert' | 'update' | 'delete' | 'other';

/**
 * Detect the type of SQL statement.
 * @param sql - The SQL string to analyze.
 * @returns The detected statement type.
 */
function detectStatementType(sql: string): SqlStatementType {
  const trimmed = sql.trim().toUpperCase();
  if (trimmed.startsWith('SELECT')) return 'select';
  if (trimmed.startsWith('INSERT')) return 'insert';
  if (trimmed.startsWith('UPDATE')) return 'update';
  if (trimmed.startsWith('DELETE')) return 'delete';
  return 'other';
}

/**
 * Extract table names referenced in a SQL statement.
 * Uses a simplified regex approach — not a full SQL parser,
 * but sufficient for the controlled wave execution environment.
 *
 * @param sql - The SQL string to analyze.
 * @returns Set of table names found.
 */
export function extractTableNames(sql: string): Set<string> {
  const tables = new Set<string>();

  // Match common table reference patterns
  const patterns = [
    /\bFROM\s+(\w+)/gi,
    /\bJOIN\s+(\w+)/gi,
    /\bINTO\s+(\w+)/gi,
    /\bUPDATE\s+(\w+)/gi,
    /\bTABLE\s+(\w+)/gi,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(sql)) !== null) {
      if (match[1]) {
        tables.add(match[1].toLowerCase());
      }
    }
  }

  return tables;
}

/**
 * Validate that a SQL statement only accesses allowed tables.
 *
 * @param sql - The SQL string to validate.
 * @param statementType - The type of SQL statement.
 * @throws SecurityError if the statement accesses blocked tables.
 */
function validateTableAccess(sql: string, statementType: SqlStatementType): void {
  const tables = extractTableNames(sql);

  for (const table of tables) {
    // Check explicit blocklist first
    if (BLOCKED_TABLES.has(table)) {
      securityLogger.warn(
        { table, statementType, sql: sql.substring(0, 100) },
        'Party wave attempted to access blocked table',
      );
      throw new SecurityError(`Party waves cannot access table "${table}"`);
    }

    // For writes, check the write allowlist
    if (statementType !== 'select') {
      if (!ALLOWED_WRITE_TABLES.has(table)) {
        securityLogger.warn(
          { table, statementType, sql: sql.substring(0, 100) },
          'Party wave attempted write to non-writable table',
        );
        throw new SecurityError(`Party waves cannot write to table "${table}"`);
      }
    } else {
      // For reads, check the read allowlist
      if (!ALLOWED_READ_TABLES.has(table)) {
        securityLogger.warn(
          { table, statementType, sql: sql.substring(0, 100) },
          'Party wave attempted to read non-allowed table',
        );
        throw new SecurityError(`Party waves cannot read table "${table}"`);
      }
    }
  }
}

/** Proxy interface that mirrors the subset of BetterSqlite3.Database party waves need. */
export interface PartyWaveDbProxy {
  /** Execute a read-only prepared statement query. */
  prepare(sql: string): { all(...params: unknown[]): unknown[]; get(...params: unknown[]): unknown; run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint } };
}

/**
 * Create a read-restricted database proxy for party wave execution.
 * Only allows queries against party-wave-safe tables.
 * Blocks access to owner-private tables.
 *
 * @param db - The real database connection.
 * @param waveName - Name of the party wave (for logging).
 * @param contactId - Contact ID (for logging).
 * @returns A proxy that restricts database access.
 */
export function createPartyWaveDbProxy(
  db: BetterSqlite3.Database,
  waveName: string,
  contactId: string,
): PartyWaveDbProxy {
  proxyLogger.debug(
    { waveName, contactId },
    'Created party wave database proxy',
  );

  return {
    prepare(sql: string) {
      const statementType = detectStatementType(sql);

      // Block DDL and other dangerous statement types
      if (statementType === 'other') {
        securityLogger.warn(
          { waveName, contactId, sql: sql.substring(0, 100) },
          'Party wave attempted non-CRUD SQL statement',
        );
        throw new SecurityError('Party waves can only execute SELECT, INSERT, UPDATE statements');
      }

      // Block DELETE entirely for party waves
      if (statementType === 'delete') {
        securityLogger.warn(
          { waveName, contactId, sql: sql.substring(0, 100) },
          'Party wave attempted DELETE statement',
        );
        throw new SecurityError('Party waves cannot delete data');
      }

      // Validate table access
      validateTableAccess(sql, statementType);

      proxyLogger.debug(
        { waveName, statementType, tables: [...extractTableNames(sql)] },
        'Party wave SQL statement validated',
      );

      // Delegate to real prepared statement
      const stmt = db.prepare(sql);
      return {
        all(...params: unknown[]) {
          return stmt.all(...params);
        },
        get(...params: unknown[]) {
          return stmt.get(...params);
        },
        run(...params: unknown[]) {
          return stmt.run(...params);
        },
      };
    },
  };
}

/**
 * Get the set of allowed read tables for testing.
 * @returns Readonly set of table names.
 */
export function getAllowedReadTables(): ReadonlySet<string> {
  return ALLOWED_READ_TABLES;
}

/**
 * Get the set of allowed write tables for testing.
 * @returns Readonly set of table names.
 */
export function getAllowedWriteTables(): ReadonlySet<string> {
  return ALLOWED_WRITE_TABLES;
}

/**
 * Get the set of blocked tables for testing.
 * @returns Readonly set of table names.
 */
export function getBlockedTables(): ReadonlySet<string> {
  return BLOCKED_TABLES;
}
