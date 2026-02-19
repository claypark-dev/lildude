import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase } from '../../../src/persistence/db.js';
import {
  appendSecurityLog,
  getRecentSecurityLogs,
  getSecurityLogsByAction,
  getSecurityLogsByAllowed,
  countSecurityLogs,
} from '../../../src/persistence/security-log.js';
import type { DatabaseManager } from '../../../src/persistence/db.js';
import type BetterSqlite3 from 'better-sqlite3';

function createTestDb() {
  const dbManager = createDatabase(':memory:');
  dbManager.runMigrations();
  return dbManager;
}

describe('security-log DAL', () => {
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

  it('appendSecurityLog creates an entry', () => {
    const entry = appendSecurityLog(db, {
      actionType: 'shell_command',
      actionDetail: 'ls -la /tmp',
      allowed: true,
      securityLevel: 1,
      reason: 'Low-risk read-only command',
      taskId: 'task-abc',
    });

    expect(entry.id).toBeDefined();
    expect(entry.actionType).toBe('shell_command');
    expect(entry.actionDetail).toBe('ls -la /tmp');
    expect(entry.allowed).toBe(true);
    expect(entry.securityLevel).toBe(1);
    expect(entry.reason).toBe('Low-risk read-only command');
    expect(entry.taskId).toBe('task-abc');
    expect(entry.createdAt).toBeInstanceOf(Date);
  });

  it('appendSecurityLog stores entry with optional fields omitted', () => {
    const entry = appendSecurityLog(db, {
      actionType: 'file_access',
      actionDetail: '/etc/passwd',
      allowed: false,
      securityLevel: 5,
    });

    expect(entry.reason).toBeNull();
    expect(entry.taskId).toBeNull();
  });

  it('getRecentSecurityLogs returns entries most recent first', () => {
    appendSecurityLog(db, {
      actionType: 'shell_command',
      actionDetail: 'first',
      allowed: true,
      securityLevel: 1,
    });
    appendSecurityLog(db, {
      actionType: 'shell_command',
      actionDetail: 'second',
      allowed: true,
      securityLevel: 1,
    });
    appendSecurityLog(db, {
      actionType: 'shell_command',
      actionDetail: 'third',
      allowed: true,
      securityLevel: 1,
    });

    const logs = getRecentSecurityLogs(db);
    expect(logs).toHaveLength(3);
    // Most recent first
    expect(logs[0].actionDetail).toBe('third');
    expect(logs[1].actionDetail).toBe('second');
    expect(logs[2].actionDetail).toBe('first');
  });

  it('getRecentSecurityLogs respects limit and offset', () => {
    for (let idx = 0; idx < 10; idx++) {
      appendSecurityLog(db, {
        actionType: 'shell_command',
        actionDetail: `entry-${idx}`,
        allowed: true,
        securityLevel: 1,
      });
    }

    const firstPage = getRecentSecurityLogs(db, 3, 0);
    expect(firstPage).toHaveLength(3);
    expect(firstPage[0].actionDetail).toBe('entry-9');

    const secondPage = getRecentSecurityLogs(db, 3, 3);
    expect(secondPage).toHaveLength(3);
    expect(secondPage[0].actionDetail).toBe('entry-6');
  });

  it('getSecurityLogsByAction filters by action type', () => {
    appendSecurityLog(db, {
      actionType: 'shell_command',
      actionDetail: 'ls',
      allowed: true,
      securityLevel: 1,
    });
    appendSecurityLog(db, {
      actionType: 'file_access',
      actionDetail: '/tmp/test',
      allowed: true,
      securityLevel: 2,
    });
    appendSecurityLog(db, {
      actionType: 'shell_command',
      actionDetail: 'cat file',
      allowed: true,
      securityLevel: 1,
    });

    const shellLogs = getSecurityLogsByAction(db, 'shell_command');
    expect(shellLogs).toHaveLength(2);
    shellLogs.forEach((log) => {
      expect(log.actionType).toBe('shell_command');
    });

    const fileLogs = getSecurityLogsByAction(db, 'file_access');
    expect(fileLogs).toHaveLength(1);
  });

  it('getSecurityLogsByAllowed filters by allowed status', () => {
    appendSecurityLog(db, {
      actionType: 'shell_command',
      actionDetail: 'ls',
      allowed: true,
      securityLevel: 1,
    });
    appendSecurityLog(db, {
      actionType: 'shell_command',
      actionDetail: 'rm -rf /',
      allowed: false,
      securityLevel: 5,
    });
    appendSecurityLog(db, {
      actionType: 'shell_command',
      actionDetail: 'cat file',
      allowed: true,
      securityLevel: 1,
    });

    const allowedLogs = getSecurityLogsByAllowed(db, true);
    expect(allowedLogs).toHaveLength(2);
    allowedLogs.forEach((log) => {
      expect(log.allowed).toBe(true);
    });

    const deniedLogs = getSecurityLogsByAllowed(db, false);
    expect(deniedLogs).toHaveLength(1);
    expect(deniedLogs[0].allowed).toBe(false);
  });

  it('countSecurityLogs counts all entries', () => {
    expect(countSecurityLogs(db)).toBe(0);

    appendSecurityLog(db, {
      actionType: 'shell_command',
      actionDetail: 'ls',
      allowed: true,
      securityLevel: 1,
    });
    appendSecurityLog(db, {
      actionType: 'file_access',
      actionDetail: '/tmp',
      allowed: false,
      securityLevel: 3,
    });

    expect(countSecurityLogs(db)).toBe(2);
  });

  it('countSecurityLogs counts entries since a given date', () => {
    appendSecurityLog(db, {
      actionType: 'shell_command',
      actionDetail: 'ls',
      allowed: true,
      securityLevel: 1,
    });

    // Count since far in the past should include all
    const countAll = countSecurityLogs(db, new Date('2000-01-01'));
    expect(countAll).toBe(1);

    // Count since far in the future should include none
    const countNone = countSecurityLogs(db, new Date('2099-01-01'));
    expect(countNone).toBe(0);
  });
});
