/**
 * Per-contact budget tracking.
 * Enforces per-contact USD spending caps using the existing token_usage table.
 * External users have a budget_cap_usd set on their contact record.
 */

import type BetterSqlite3 from 'better-sqlite3';
import type { Contact } from '../types/index.js';
import { securityLogger } from '../utils/logger.js';

/** Budget check result. */
export interface BudgetCheckResult {
  /** Whether spending is within the contact's budget cap. */
  withinBudget: boolean;
  /** Total spent by this contact (all time). */
  totalSpentUsd: number;
  /** The contact's budget cap in USD. */
  budgetCapUsd: number;
  /** Remaining budget. Infinity if no cap set. */
  remainingUsd: number;
}

/**
 * Check if a contact is within their budget cap.
 * Uses the token_usage table joined with conversations.contact_id.
 *
 * @param db - Database connection.
 * @param contact - The contact to check.
 * @returns BudgetCheckResult with current spending status.
 */
export function checkContactBudget(
  db: BetterSqlite3.Database,
  contact: Contact,
): BudgetCheckResult {
  // Owner has no per-contact cap (uses the global budget)
  if (contact.trustLevel === 'owner' || contact.budgetCapUsd <= 0) {
    return {
      withinBudget: true,
      totalSpentUsd: 0,
      budgetCapUsd: contact.budgetCapUsd,
      remainingUsd: Infinity,
    };
  }

  const totalSpent = getContactSpending(db, contact.id);
  const remaining = contact.budgetCapUsd - totalSpent;
  const withinBudget = remaining > 0;

  if (!withinBudget) {
    securityLogger.info(
      { contactId: contact.id, name: contact.name, totalSpent, cap: contact.budgetCapUsd },
      'Contact budget cap exceeded',
    );
  }

  return {
    withinBudget,
    totalSpentUsd: totalSpent,
    budgetCapUsd: contact.budgetCapUsd,
    remainingUsd: Math.max(0, remaining),
  };
}

/**
 * Get total USD spent by a contact across all their conversations.
 *
 * @param db - Database connection.
 * @param contactId - The contact ID.
 * @returns Total spending in USD.
 */
export function getContactSpending(
  db: BetterSqlite3.Database,
  contactId: string,
): number {
  const row = db.prepare(
    `SELECT COALESCE(SUM(tu.cost_usd), 0) AS total
     FROM token_usage tu
     JOIN tasks t ON tu.task_id = t.id
     JOIN conversations c ON t.id = c.task_id
     WHERE c.contact_id = ?`,
  ).get(contactId) as { total: number };

  return row.total;
}

/**
 * Get monthly spending for a contact.
 *
 * @param db - Database connection.
 * @param contactId - The contact ID.
 * @returns Monthly spending in USD.
 */
export function getContactMonthlySpending(
  db: BetterSqlite3.Database,
  contactId: string,
): number {
  const firstOfMonth = new Date();
  firstOfMonth.setDate(1);
  firstOfMonth.setHours(0, 0, 0, 0);

  const row = db.prepare(
    `SELECT COALESCE(SUM(tu.cost_usd), 0) AS total
     FROM token_usage tu
     JOIN tasks t ON tu.task_id = t.id
     JOIN conversations c ON t.id = c.task_id
     WHERE c.contact_id = ? AND tu.created_at >= ?`,
  ).get(contactId, firstOfMonth.toISOString()) as { total: number };

  return row.total;
}
