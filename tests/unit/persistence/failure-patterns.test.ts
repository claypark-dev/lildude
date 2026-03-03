import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase } from '../../../src/persistence/db.js';
import {
  recordFailurePattern,
  findFailurePatterns,
  recordResolution,
  getTopFailureTypes,
} from '../../../src/persistence/failure-patterns.js';
import type { DatabaseManager } from '../../../src/persistence/db.js';
import type BetterSqlite3 from 'better-sqlite3';

function createTestDb() {
  const dbManager = createDatabase(':memory:');
  dbManager.runMigrations();
  return dbManager;
}

describe('failure-patterns DAL', () => {
  let dbManager: DatabaseManager;
  let db: BetterSqlite3.Database;

  beforeEach(() => {
    dbManager = createTestDb();
    db = dbManager.db;
  });

  afterEach(() => {
    try {
      dbManager.close();
    } catch {
      // best-effort cleanup
    }
  });

  it('recordFailurePattern creates a new pattern', () => {
    const patternId = recordFailurePattern(db, {
      intent: 'send email to John',
      waveName: 'email-sender',
      errorType: 'api_error',
      errorMessage: 'Gmail API returned 403',
      model: 'claude-3-haiku',
      provider: 'anthropic',
    });

    expect(patternId).toBeGreaterThan(0);
  });

  it('recordFailurePattern upserts on same intent + error_type', () => {
    const firstId = recordFailurePattern(db, {
      intent: 'send email to John',
      errorType: 'api_error',
      errorMessage: 'First failure',
    });

    const secondId = recordFailurePattern(db, {
      intent: 'send email to John',
      errorType: 'api_error',
      errorMessage: 'Second failure',
    });

    // Same record should be updated, not a new one
    expect(secondId).toBe(firstId);

    const patterns = findFailurePatterns(db, 'send email to John');
    expect(patterns).toHaveLength(1);
    expect(patterns[0].occurrenceCount).toBe(2);
    expect(patterns[0].errorMessage).toBe('Second failure');
  });

  it('recordFailurePattern creates separate records for different error types', () => {
    recordFailurePattern(db, {
      intent: 'send email',
      errorType: 'api_error',
      errorMessage: 'API failure',
    });

    recordFailurePattern(db, {
      intent: 'send email',
      errorType: 'timeout',
      errorMessage: 'Request timed out',
    });

    const patterns = findFailurePatterns(db, 'send email');
    expect(patterns).toHaveLength(2);
  });

  it('findFailurePatterns returns patterns ordered by occurrence count', () => {
    recordFailurePattern(db, {
      intent: 'check weather',
      errorType: 'timeout',
      errorMessage: 'Timeout 1',
    });
    // Record same pattern 2 more times
    recordFailurePattern(db, {
      intent: 'check weather',
      errorType: 'timeout',
      errorMessage: 'Timeout 2',
    });
    recordFailurePattern(db, {
      intent: 'check weather',
      errorType: 'timeout',
      errorMessage: 'Timeout 3',
    });

    recordFailurePattern(db, {
      intent: 'check weather',
      errorType: 'api_error',
      errorMessage: 'API error',
    });

    const patterns = findFailurePatterns(db, 'check weather');
    expect(patterns).toHaveLength(2);
    expect(patterns[0].errorType).toBe('timeout');
    expect(patterns[0].occurrenceCount).toBe(3);
    expect(patterns[1].errorType).toBe('api_error');
    expect(patterns[1].occurrenceCount).toBe(1);
  });

  it('findFailurePatterns returns empty array for unknown intent', () => {
    const patterns = findFailurePatterns(db, 'nonexistent intent');
    expect(patterns).toHaveLength(0);
  });

  it('findFailurePatterns respects limit', () => {
    for (let idx = 0; idx < 10; idx++) {
      recordFailurePattern(db, {
        intent: 'test',
        errorType: `error_type_${idx}`,
        errorMessage: `Error ${idx}`,
      });
    }

    const patterns = findFailurePatterns(db, 'test', 3);
    expect(patterns).toHaveLength(3);
  });

  it('recordResolution stores resolution text', () => {
    const patternId = recordFailurePattern(db, {
      intent: 'send email',
      errorType: 'auth_error',
      errorMessage: 'Token expired',
    });

    recordResolution(db, patternId, 'Refreshed OAuth token before retrying');

    const patterns = findFailurePatterns(db, 'send email');
    expect(patterns).toHaveLength(1);
    expect(patterns[0].resolution).toBe('Refreshed OAuth token before retrying');
  });

  it('getTopFailureTypes returns types grouped by error_type', () => {
    // Record failures with today's date
    recordFailurePattern(db, {
      intent: 'task a',
      errorType: 'api_error',
      errorMessage: 'API failed',
    });
    recordFailurePattern(db, {
      intent: 'task b',
      errorType: 'api_error',
      errorMessage: 'API failed again',
    });
    recordFailurePattern(db, {
      intent: 'task c',
      errorType: 'timeout',
      errorMessage: 'Timed out',
    });

    const todayStr = new Date().toISOString().slice(0, 10);
    const topTypes = getTopFailureTypes(db, todayStr, 5);
    expect(topTypes.length).toBeGreaterThanOrEqual(2);

    const apiErrorType = topTypes.find((t) => t.type === 'api_error');
    const timeoutType = topTypes.find((t) => t.type === 'timeout');
    expect(apiErrorType).toBeDefined();
    expect(timeoutType).toBeDefined();
  });

  it('getTopFailureTypes returns empty array for a day with no failures', () => {
    const topTypes = getTopFailureTypes(db, '2000-01-01');
    expect(topTypes).toHaveLength(0);
  });

  it('recordFailurePattern preserves metadata fields', () => {
    recordFailurePattern(db, {
      intent: 'test intent',
      toolName: 'shell_exec',
      waveName: 'deploy-wave',
      errorType: 'sandbox_violation',
      errorMessage: 'Command not allowed',
      model: 'claude-3-sonnet',
      provider: 'anthropic',
    });

    const patterns = findFailurePatterns(db, 'test intent');
    expect(patterns).toHaveLength(1);
    expect(patterns[0].toolName).toBe('shell_exec');
    expect(patterns[0].waveName).toBe('deploy-wave');
    expect(patterns[0].model).toBe('claude-3-sonnet');
    expect(patterns[0].provider).toBe('anthropic');
    expect(patterns[0].resolution).toBeNull();
  });
});
