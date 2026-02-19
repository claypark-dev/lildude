import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createDatabase } from '../../../src/persistence/db.js';
import { createTask } from '../../../src/persistence/tasks.js';
import {
  createApproval as createApprovalDal,
  getApproval,
  getPendingApprovals,
} from '../../../src/persistence/approvals.js';
import { ApprovalQueue } from '../../../src/orchestrator/approval.js';
import type { DatabaseManager } from '../../../src/persistence/db.js';
import type BetterSqlite3 from 'better-sqlite3';

function createTestDb(): DatabaseManager {
  const dbManager = createDatabase(':memory:');
  dbManager.runMigrations();
  return dbManager;
}

describe('ApprovalQueue', () => {
  let dbManager: DatabaseManager;
  let db: BetterSqlite3.Database;
  let taskId: string;
  let queue: ApprovalQueue;

  beforeEach(() => {
    dbManager = createTestDb();
    db = dbManager.db;
    const task = createTask(db, { type: 'automation', description: 'test task', modelUsed: 'test' });
    taskId = task.id;
    queue = new ApprovalQueue(db);
  });

  afterEach(() => {
    try {
      dbManager.close();
    } catch {
      // best-effort cleanup
    }
  });

  describe('requestApproval', () => {
    it('resolves with approved: true when user says "yes"', async () => {
      const approvalPromise = queue.requestApproval({
        taskId,
        actionType: 'shell_command',
        actionDetail: 'rm -rf /tmp/cache',
        description: 'Clear cache',
        riskLevel: 'medium',
        timeoutMs: 5000,
      });

      // Simulate user response after a short delay
      await sleep(50);
      const responseResult = await queue.handleResponse('yes');
      expect(responseResult.matched).toBe(true);

      const result = await approvalPromise;
      expect(result.approved).toBe(true);
      expect(result.approval.status).toBe('approved');
      expect(result.approval.actionType).toBe('shell_command');
    });

    it('resolves with approved: false when user says "no"', async () => {
      const approvalPromise = queue.requestApproval({
        taskId,
        actionType: 'shell_command',
        actionDetail: 'rm important-file',
        description: 'Delete file',
        riskLevel: 'high',
        timeoutMs: 5000,
      });

      await sleep(50);
      const responseResult = await queue.handleResponse('no');
      expect(responseResult.matched).toBe(true);

      const result = await approvalPromise;
      expect(result.approved).toBe(false);
      expect(result.approval.status).toBe('denied');
    });

    it('expires after timeout', async () => {
      const result = await queue.requestApproval({
        taskId,
        actionType: 'shell_command',
        actionDetail: 'echo hello',
        description: 'Test echo',
        riskLevel: 'low',
        timeoutMs: 100,
      });

      expect(result.approved).toBe(false);
      expect(result.approval.status).toBe('expired');
    });

    it('calls the onRequest callback with the approval', async () => {
      const onRequestSpy = vi.fn().mockResolvedValue(undefined);

      const approvalPromise = queue.requestApproval({
        taskId,
        actionType: 'api_call',
        actionDetail: 'POST /deploy',
        description: 'Deploy to production',
        riskLevel: 'critical',
        timeoutMs: 5000,
        onRequest: onRequestSpy,
      });

      await sleep(50);
      expect(onRequestSpy).toHaveBeenCalledOnce();
      const callArg = onRequestSpy.mock.calls[0][0];
      expect(callArg.taskId).toBe(taskId);
      expect(callArg.actionType).toBe('api_call');
      expect(callArg.status).toBe('pending');

      // Clean up by responding
      await queue.handleResponse('approve');
      await approvalPromise;
    });

    it('continues even if onRequest callback fails', async () => {
      const failingCallback = vi.fn().mockRejectedValue(new Error('notification failed'));

      const approvalPromise = queue.requestApproval({
        taskId,
        actionType: 'shell_command',
        actionDetail: 'test',
        description: 'test',
        riskLevel: 'low',
        timeoutMs: 5000,
        onRequest: failingCallback,
      });

      await sleep(50);
      await queue.handleResponse('yes');

      const result = await approvalPromise;
      expect(result.approved).toBe(true);
      expect(failingCallback).toHaveBeenCalledOnce();
    });

    it('stores channel information on the approval', async () => {
      const approvalPromise = queue.requestApproval({
        taskId,
        actionType: 'shell_command',
        actionDetail: 'test',
        description: 'test',
        riskLevel: 'low',
        channelType: 'discord',
        channelId: 'channel-abc',
        timeoutMs: 5000,
      });

      await sleep(50);
      const pending = getPendingApprovals(db);
      expect(pending.length).toBeGreaterThanOrEqual(1);
      const latestPending = pending[pending.length - 1];
      expect(latestPending.channelType).toBe('discord');
      expect(latestPending.channelId).toBe('channel-abc');

      await queue.handleResponse('yes', 'discord', 'channel-abc');
      await approvalPromise;
    });
  });

  describe('handleResponse', () => {
    it('returns matched: false when no pending approvals', async () => {
      const result = await queue.handleResponse('yes');
      expect(result.matched).toBe(false);
      expect(result.approvalId).toBeUndefined();
    });

    it('returns matched: false for unrecognized response', async () => {
      // Create a pending approval first
      const approvalPromise = queue.requestApproval({
        taskId,
        actionType: 'shell_command',
        actionDetail: 'test',
        description: 'test',
        riskLevel: 'low',
        timeoutMs: 5000,
      });

      await sleep(50);
      const result = await queue.handleResponse('maybe');
      expect(result.matched).toBe(false);

      // Clean up
      await queue.handleResponse('yes');
      await approvalPromise;
    });

    it('matches the most recent pending approval when multiple exist', async () => {
      const task2 = createTask(db, { type: 'automation', description: 'test2', modelUsed: 'test' });

      const promise1 = queue.requestApproval({
        taskId,
        actionType: 'shell_command',
        actionDetail: 'first-action',
        description: 'First action',
        riskLevel: 'low',
        timeoutMs: 5000,
      });

      await sleep(50);

      const promise2 = queue.requestApproval({
        taskId: task2.id,
        actionType: 'shell_command',
        actionDetail: 'second-action',
        description: 'Second action',
        riskLevel: 'medium',
        timeoutMs: 5000,
      });

      await sleep(50);

      // The most recent (second) should be matched
      const result = await queue.handleResponse('yes');
      expect(result.matched).toBe(true);
      expect(result.approvalId).toBeDefined();

      // Verify the second one was approved
      const approvedRecord = getApproval(db, result.approvalId!);
      expect(approvedRecord).toBeDefined();
      expect(approvedRecord!.actionDetail).toBe('second-action');
      expect(approvedRecord!.status).toBe('approved');

      // Clean up: approve the first one too
      await queue.handleResponse('yes');
      await Promise.all([promise1, promise2]);
    });

    it('filters by channelType and channelId', async () => {
      const promise1 = queue.requestApproval({
        taskId,
        actionType: 'shell_command',
        actionDetail: 'discord-action',
        description: 'Discord action',
        riskLevel: 'low',
        channelType: 'discord',
        channelId: 'ch-1',
        timeoutMs: 5000,
      });

      await sleep(50);

      const task2 = createTask(db, { type: 'automation', description: 'test2', modelUsed: 'test' });
      const promise2 = queue.requestApproval({
        taskId: task2.id,
        actionType: 'shell_command',
        actionDetail: 'telegram-action',
        description: 'Telegram action',
        riskLevel: 'low',
        channelType: 'telegram',
        channelId: 'ch-2',
        timeoutMs: 5000,
      });

      await sleep(50);

      // Respond filtering by discord channel — should match the discord one
      const result = await queue.handleResponse('yes', 'discord', 'ch-1');
      expect(result.matched).toBe(true);

      const approvedRecord = getApproval(db, result.approvalId!);
      expect(approvedRecord!.actionDetail).toBe('discord-action');

      // Clean up
      await queue.handleResponse('yes', 'telegram', 'ch-2');
      await Promise.all([promise1, promise2]);
    });

    it('returns matched: false when channel filter matches nothing', async () => {
      const approvalPromise = queue.requestApproval({
        taskId,
        actionType: 'shell_command',
        actionDetail: 'test',
        description: 'test',
        riskLevel: 'low',
        channelType: 'discord',
        channelId: 'ch-1',
        timeoutMs: 5000,
      });

      await sleep(50);

      const result = await queue.handleResponse('yes', 'telegram', 'ch-99');
      expect(result.matched).toBe(false);

      // Clean up
      await queue.handleResponse('yes', 'discord', 'ch-1');
      await approvalPromise;
    });

    it('recognizes various affirmative responses', async () => {
      const affirmatives = ['yes', 'y', 'approve', 'ok', 'sure'];

      for (const response of affirmatives) {
        const task = createTask(db, { type: 'automation', description: `test-${response}`, modelUsed: 'test' });
        const approvalPromise = queue.requestApproval({
          taskId: task.id,
          actionType: 'shell_command',
          actionDetail: `action-${response}`,
          description: `Test ${response}`,
          riskLevel: 'low',
          timeoutMs: 5000,
        });

        await sleep(50);
        const result = await queue.handleResponse(response);
        expect(result.matched).toBe(true);

        const approval = await approvalPromise;
        expect(approval.approved).toBe(true);
      }
    });

    it('recognizes various denial responses', async () => {
      const denials = ['no', 'n', 'deny', 'reject'];

      for (const response of denials) {
        const task = createTask(db, { type: 'automation', description: `test-${response}`, modelUsed: 'test' });
        const approvalPromise = queue.requestApproval({
          taskId: task.id,
          actionType: 'shell_command',
          actionDetail: `action-${response}`,
          description: `Test ${response}`,
          riskLevel: 'low',
          timeoutMs: 5000,
        });

        await sleep(50);
        const result = await queue.handleResponse(response);
        expect(result.matched).toBe(true);

        const approval = await approvalPromise;
        expect(approval.approved).toBe(false);
      }
    });

    it('handles case-insensitive and whitespace-padded responses', async () => {
      const approvalPromise = queue.requestApproval({
        taskId,
        actionType: 'shell_command',
        actionDetail: 'test',
        description: 'test',
        riskLevel: 'low',
        timeoutMs: 5000,
      });

      await sleep(50);
      const result = await queue.handleResponse('  YES  ');
      expect(result.matched).toBe(true);

      const approval = await approvalPromise;
      expect(approval.approved).toBe(true);
    });
  });

  describe('expireStale', () => {
    it('expires old approvals and returns the count', () => {
      // Create an already-expired approval using the DAL directly
      const pastDate = new Date('2020-01-01T00:00:00Z');
      createApprovalDal(db, {
        taskId,
        actionType: 'shell_command',
        actionDetail: 'expired-action',
        description: 'Already expired',
        riskLevel: 'low',
        expiresAt: pastDate,
      });

      const expiredCount = queue.expireStale();
      expect(expiredCount).toBe(1);

      const pending = getPendingApprovals(db);
      expect(pending).toHaveLength(0);
    });

    it('returns 0 when no approvals are stale', () => {
      const expiredCount = queue.expireStale();
      expect(expiredCount).toBe(0);
    });

    it('does not expire future approvals', async () => {
      const approvalPromise = queue.requestApproval({
        taskId,
        actionType: 'shell_command',
        actionDetail: 'future-action',
        description: 'Still valid',
        riskLevel: 'low',
        timeoutMs: 60_000,
      });

      await sleep(50);

      const expiredCount = queue.expireStale();
      expect(expiredCount).toBe(0);

      const pending = getPendingApprovals(db);
      expect(pending).toHaveLength(1);

      // Clean up
      await queue.handleResponse('yes');
      await approvalPromise;
    });
  });
});

/** Helper to sleep for a given number of milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
