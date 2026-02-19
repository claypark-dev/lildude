/**
 * Non-blocking approval queue orchestrator.
 * Manages approval workflows by creating requests, polling for responses,
 * and handling user decisions (approve/deny) with automatic expiration.
 * See HLD Section S1.I.3.
 */

import type BetterSqlite3 from 'better-sqlite3';
import {
  createApproval,
  getApproval,
  getPendingApprovals,
  approveRequest,
  denyRequest,
  expireOldApprovals,
} from '../persistence/approvals.js';
import type { ApprovalRequest, RiskLevel } from '../types/index.js';
import { orchestratorLogger } from '../utils/logger.js';

/** Default timeout for approval requests: 5 minutes. */
const DEFAULT_TIMEOUT_MS = 300_000;

/** Polling interval for checking approval status changes. */
const POLL_INTERVAL_MS = 500;

/** Set of affirmative response strings that approve a request. */
const APPROVE_RESPONSES: ReadonlySet<string> = new Set([
  'yes', 'y', 'approve', 'ok', 'sure',
]);

/** Set of negative response strings that deny a request. */
const DENY_RESPONSES: ReadonlySet<string> = new Set([
  'no', 'n', 'deny', 'reject',
]);

/** Options for requesting approval of an action. */
export interface RequestApprovalOptions {
  taskId: string;
  actionType: string;
  actionDetail: string;
  description: string;
  riskLevel: RiskLevel;
  channelType?: string;
  channelId?: string;
  timeoutMs?: number;
  onRequest?: (approval: ApprovalRequest) => Promise<void>;
}

/** Result of an approval request after it resolves. */
export interface ApprovalResult {
  approved: boolean;
  approval: ApprovalRequest;
}

/** Result of handling a user response to a pending approval. */
export interface HandleResponseResult {
  matched: boolean;
  approvalId?: string;
}

/**
 * Non-blocking approval queue that manages the lifecycle of approval requests.
 * Creates requests in the database, polls for status changes, and processes
 * user responses to approve or deny pending actions.
 */
export class ApprovalQueue {
  private readonly db: BetterSqlite3.Database;

  constructor(db: BetterSqlite3.Database) {
    this.db = db;
  }

  /**
   * Request approval for an action. Returns a Promise that resolves
   * when the user responds or the request expires.
   * @param options - The approval request parameters.
   * @returns A promise resolving with whether the action was approved and the approval record.
   */
  async requestApproval(options: RequestApprovalOptions): Promise<ApprovalResult> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const expiresAt = new Date(Date.now() + timeoutMs);

    const approval = createApproval(this.db, {
      taskId: options.taskId,
      actionType: options.actionType,
      actionDetail: options.actionDetail,
      description: options.description,
      riskLevel: options.riskLevel,
      channelType: options.channelType,
      channelId: options.channelId,
      expiresAt,
    });

    orchestratorLogger.info(
      { approvalId: approval.id, taskId: options.taskId, riskLevel: options.riskLevel },
      'Approval requested',
    );

    if (options.onRequest) {
      try {
        await options.onRequest(approval);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        orchestratorLogger.warn(
          { approvalId: approval.id, error: message },
          'onRequest callback failed',
        );
      }
    }

    return this.pollForResolution(approval.id, timeoutMs);
  }

  /**
   * Process a user response to a pending approval.
   * Matches the most recent pending approval, optionally filtered by channel.
   * @param response - The user's response text (e.g., "yes", "no", "approve", "deny").
   * @param channelType - Optional channel type to filter by.
   * @param channelId - Optional channel ID to filter by.
   * @returns Whether a pending approval was matched and its ID.
   */
  async handleResponse(
    response: string,
    channelType?: string,
    channelId?: string,
  ): Promise<HandleResponseResult> {
    const normalizedResponse = response.trim().toLowerCase();
    const isApproval = APPROVE_RESPONSES.has(normalizedResponse);
    const isDenial = DENY_RESPONSES.has(normalizedResponse);

    if (!isApproval && !isDenial) {
      return { matched: false };
    }

    const pendingApprovals = getPendingApprovals(this.db);

    if (pendingApprovals.length === 0) {
      return { matched: false };
    }

    let filtered = pendingApprovals;

    if (channelType !== undefined || channelId !== undefined) {
      filtered = pendingApprovals.filter((approvalItem) => {
        const matchesType = channelType === undefined || approvalItem.channelType === channelType;
        const matchesId = channelId === undefined || approvalItem.channelId === channelId;
        return matchesType && matchesId;
      });
    }

    if (filtered.length === 0) {
      return { matched: false };
    }

    // Match the most recent pending approval (last in the list, since ordered ASC)
    const targetApproval = filtered[filtered.length - 1];

    if (isApproval) {
      approveRequest(this.db, targetApproval.id);
      orchestratorLogger.info(
        { approvalId: targetApproval.id },
        'Approval request approved by user',
      );
    } else {
      denyRequest(this.db, targetApproval.id);
      orchestratorLogger.info(
        { approvalId: targetApproval.id },
        'Approval request denied by user',
      );
    }

    return { matched: true, approvalId: targetApproval.id };
  }

  /**
   * Check and expire old pending approvals. Call periodically.
   * @returns The number of approvals that were expired.
   */
  expireStale(): number {
    const expiredCount = expireOldApprovals(this.db);

    if (expiredCount > 0) {
      orchestratorLogger.info({ expiredCount }, 'Expired stale approval requests');
    }

    return expiredCount;
  }

  /**
   * Poll the database until an approval's status changes or the timeout elapses.
   * @param approvalId - The approval request ID to poll.
   * @param timeoutMs - Maximum time to wait in milliseconds.
   * @returns The final approval result.
   */
  private async pollForResolution(
    approvalId: string,
    timeoutMs: number,
  ): Promise<ApprovalResult> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const current = getApproval(this.db, approvalId);

      if (!current) {
        orchestratorLogger.error({ approvalId }, 'Approval record disappeared during polling');
        return {
          approved: false,
          approval: this.buildExpiredFallback(approvalId),
        };
      }

      if (current.status === 'approved') {
        return { approved: true, approval: current };
      }

      if (current.status === 'denied' || current.status === 'expired') {
        return { approved: false, approval: current };
      }

      await this.sleep(POLL_INTERVAL_MS);
    }

    // Timeout reached — try DAL expiration first
    expireOldApprovals(this.db);

    const afterExpire = getApproval(this.db, approvalId);
    if (!afterExpire) {
      orchestratorLogger.error({ approvalId }, 'Approval record disappeared after timeout');
      return { approved: false, approval: this.buildExpiredFallback(approvalId) };
    }

    if (afterExpire.status !== 'pending') {
      return { approved: afterExpire.status === 'approved', approval: afterExpire };
    }

    // The DAL uses datetime('now') which may not have caught up yet.
    // Deny the request through the DAL, then treat as expired in our result.
    denyRequest(this.db, approvalId);
    const deniedRecord = getApproval(this.db, approvalId);
    if (deniedRecord) {
      orchestratorLogger.info({ approvalId }, 'Approval request expired due to timeout');
      // Return as expired even though DB says denied — caller sees it as timeout
      return {
        approved: false,
        approval: { ...deniedRecord, status: 'expired' },
      };
    }

    return { approved: false, approval: this.buildExpiredFallback(approvalId) };
  }

  /**
   * Create a fallback ApprovalRequest when the record cannot be found.
   * This should not happen under normal circumstances.
   * @param approvalId - The approval ID that went missing.
   * @returns A minimal expired ApprovalRequest.
   */
  private buildExpiredFallback(approvalId: string): ApprovalRequest {
    return {
      id: approvalId,
      taskId: '',
      actionType: '',
      actionDetail: '',
      description: '',
      riskLevel: 'low',
      status: 'expired',
      requestedAt: new Date(),
      expiresAt: new Date(),
    };
  }

  /**
   * Sleep for the specified duration.
   * @param ms - Milliseconds to sleep.
   * @returns A promise that resolves after the delay.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}
