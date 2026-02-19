import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase } from '../../../src/persistence/db.js';
import { createTask } from '../../../src/persistence/tasks.js';
import {
  createApproval,
  getApproval,
  getPendingApprovals,
  approveRequest,
  denyRequest,
  expireOldApprovals,
  getApprovalsByTask,
} from '../../../src/persistence/approvals.js';
import type { DatabaseManager } from '../../../src/persistence/db.js';
import type BetterSqlite3 from 'better-sqlite3';

function createTestDb() {
  const dbManager = createDatabase(':memory:');
  dbManager.runMigrations();
  return dbManager;
}

describe('approvals DAL', () => {
  let dbManager: DatabaseManager;
  let db: BetterSqlite3.Database;
  let taskId: string;

  beforeEach(() => {
    dbManager = createTestDb();
    db = dbManager.db;
    const task = createTask(db, { type: 'automation', description: 'Test task' });
    taskId = task.id;
  });

  afterEach(() => {
    try {
      dbManager.close();
    } catch {
      // best-effort cleanup
    }
  });

  it('createApproval creates with id', () => {
    const futureDate = new Date('2099-01-01T00:00:00Z');
    const approval = createApproval(db, {
      taskId,
      actionType: 'shell_command',
      actionDetail: 'rm -rf /tmp/cache',
      description: 'Clear temporary cache directory',
      riskLevel: 'medium',
      expiresAt: futureDate,
    });

    expect(approval.id).toBeDefined();
    expect(typeof approval.id).toBe('string');
    expect(approval.taskId).toBe(taskId);
    expect(approval.actionType).toBe('shell_command');
    expect(approval.actionDetail).toBe('rm -rf /tmp/cache');
    expect(approval.description).toBe('Clear temporary cache directory');
    expect(approval.riskLevel).toBe('medium');
    expect(approval.status).toBe('pending');
    expect(approval.channelType).toBeUndefined();
    expect(approval.channelId).toBeUndefined();
    expect(approval.requestedAt).toBeInstanceOf(Date);
    expect(approval.respondedAt).toBeUndefined();
    expect(approval.expiresAt).toBeInstanceOf(Date);
  });

  it('createApproval stores optional channel fields', () => {
    const approval = createApproval(db, {
      taskId,
      actionType: 'api_call',
      actionDetail: 'POST /deploy',
      description: 'Deploy to production',
      riskLevel: 'critical',
      channelType: 'discord',
      channelId: 'channel-123',
      expiresAt: new Date('2099-01-01T00:00:00Z'),
    });

    expect(approval.channelType).toBe('discord');
    expect(approval.channelId).toBe('channel-123');
    expect(approval.riskLevel).toBe('critical');
  });

  it('getApproval returns the request', () => {
    const created = createApproval(db, {
      taskId,
      actionType: 'shell_command',
      actionDetail: 'rm file',
      description: 'Remove a file',
      riskLevel: 'low',
      expiresAt: new Date('2099-01-01T00:00:00Z'),
    });

    const retrieved = getApproval(db, created.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.id).toBe(created.id);
    expect(retrieved!.actionType).toBe('shell_command');
    expect(retrieved!.status).toBe('pending');
  });

  it('getApproval returns undefined for nonexistent id', () => {
    const result = getApproval(db, 'nonexistent-id');
    expect(result).toBeUndefined();
  });

  it('getPendingApprovals returns only pending', () => {
    const approval1 = createApproval(db, {
      taskId,
      actionType: 'shell_command',
      actionDetail: 'action-1',
      description: 'First action',
      riskLevel: 'low',
      expiresAt: new Date('2099-01-01T00:00:00Z'),
    });
    createApproval(db, {
      taskId,
      actionType: 'shell_command',
      actionDetail: 'action-2',
      description: 'Second action',
      riskLevel: 'medium',
      expiresAt: new Date('2099-01-01T00:00:00Z'),
    });

    // Approve the first one
    approveRequest(db, approval1.id);

    const pending = getPendingApprovals(db);
    expect(pending).toHaveLength(1);
    expect(pending[0].actionDetail).toBe('action-2');
  });

  it('approveRequest changes status to approved', () => {
    const approval = createApproval(db, {
      taskId,
      actionType: 'file_access',
      actionDetail: '/etc/hosts',
      description: 'Read hosts file',
      riskLevel: 'high',
      expiresAt: new Date('2099-01-01T00:00:00Z'),
    });

    approveRequest(db, approval.id);

    const updated = getApproval(db, approval.id);
    expect(updated).toBeDefined();
    expect(updated!.status).toBe('approved');
    expect(updated!.respondedAt).toBeInstanceOf(Date);
  });

  it('denyRequest changes status to denied', () => {
    const approval = createApproval(db, {
      taskId,
      actionType: 'file_access',
      actionDetail: '/etc/shadow',
      description: 'Read shadow file',
      riskLevel: 'critical',
      expiresAt: new Date('2099-01-01T00:00:00Z'),
    });

    denyRequest(db, approval.id);

    const updated = getApproval(db, approval.id);
    expect(updated).toBeDefined();
    expect(updated!.status).toBe('denied');
    expect(updated!.respondedAt).toBeInstanceOf(Date);
  });

  it('expireOldApprovals expires old pending requests', () => {
    // Create an approval that already expired
    const pastDate = new Date('2020-01-01T00:00:00Z');
    createApproval(db, {
      taskId,
      actionType: 'shell_command',
      actionDetail: 'old-action',
      description: 'Expired action',
      riskLevel: 'low',
      expiresAt: pastDate,
    });

    // Create an approval that has not expired
    const futureDate = new Date('2099-01-01T00:00:00Z');
    createApproval(db, {
      taskId,
      actionType: 'shell_command',
      actionDetail: 'future-action',
      description: 'Future action',
      riskLevel: 'low',
      expiresAt: futureDate,
    });

    const expiredCount = expireOldApprovals(db);
    expect(expiredCount).toBe(1);

    const pending = getPendingApprovals(db);
    expect(pending).toHaveLength(1);
    expect(pending[0].actionDetail).toBe('future-action');
  });

  it('expireOldApprovals does not expire already resolved requests', () => {
    const pastDate = new Date('2020-01-01T00:00:00Z');
    const approval = createApproval(db, {
      taskId,
      actionType: 'shell_command',
      actionDetail: 'already-approved',
      description: 'Already approved action',
      riskLevel: 'low',
      expiresAt: pastDate,
    });

    // Approve it before trying to expire
    approveRequest(db, approval.id);

    const expiredCount = expireOldApprovals(db);
    expect(expiredCount).toBe(0);

    const retrieved = getApproval(db, approval.id);
    expect(retrieved!.status).toBe('approved');
  });

  it('getApprovalsByTask returns approvals for task', () => {
    createApproval(db, {
      taskId,
      actionType: 'shell_command',
      actionDetail: 'action-1',
      description: 'First action',
      riskLevel: 'low',
      expiresAt: new Date('2099-01-01T00:00:00Z'),
    });
    createApproval(db, {
      taskId,
      actionType: 'shell_command',
      actionDetail: 'action-2',
      description: 'Second action',
      riskLevel: 'medium',
      expiresAt: new Date('2099-01-01T00:00:00Z'),
    });

    // Create a different task and its approval
    const otherTask = createTask(db, { type: 'chat', description: 'Other task' });
    createApproval(db, {
      taskId: otherTask.id,
      actionType: 'shell_command',
      actionDetail: 'other-action',
      description: 'Other task action',
      riskLevel: 'low',
      expiresAt: new Date('2099-01-01T00:00:00Z'),
    });

    const approvals = getApprovalsByTask(db, taskId);
    expect(approvals).toHaveLength(2);
    approvals.forEach((approval) => {
      expect(approval.taskId).toBe(taskId);
    });
  });

  it('getApprovalsByTask returns empty array for unknown task', () => {
    const approvals = getApprovalsByTask(db, 'nonexistent-task');
    expect(approvals).toHaveLength(0);
  });
});
