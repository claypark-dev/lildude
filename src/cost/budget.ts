/**
 * Budget checking utilities for task-level and monthly spending limits.
 * All checks are deterministic -- no LLM calls required.
 * See HLD Section 6 for cost control architecture.
 */

/**
 * Check if a task can afford to proceed given current spending.
 * Returns true when the estimated next expense fits within the task budget.
 * @param taskSpentUsd - Amount already spent on this task in USD
 * @param taskBudgetUsd - Maximum budget allocated to this task in USD
 * @param estimatedCostUsd - Estimated cost of the next operation in USD
 * @returns True if the task can afford the estimated cost
 */
export function canAfford(
  taskSpentUsd: number,
  taskBudgetUsd: number,
  estimatedCostUsd: number,
): boolean {
  return (taskSpentUsd + estimatedCostUsd) <= taskBudgetUsd;
}

/**
 * Check if the monthly budget allows a new expense.
 * Returns true when the estimated expense fits within the monthly limit.
 * @param monthlySpentUsd - Amount already spent this month in USD
 * @param monthlyLimitUsd - Monthly spending cap in USD
 * @param estimatedCostUsd - Estimated cost of the next operation in USD
 * @returns True if the monthly budget can accommodate the estimated cost
 */
export function isWithinMonthlyBudget(
  monthlySpentUsd: number,
  monthlyLimitUsd: number,
  estimatedCostUsd: number,
): boolean {
  return (monthlySpentUsd + estimatedCostUsd) <= monthlyLimitUsd;
}

/**
 * Check if spending has reached the warning threshold.
 * Returns true when the spent amount meets or exceeds the warning percentage
 * of the total limit.
 * @param spentUsd - Amount spent so far in USD
 * @param limitUsd - Total spending limit in USD
 * @param warningThresholdPct - Warning threshold as a decimal (e.g., 0.8 for 80%)
 * @returns True if spending is at or above the warning threshold
 */
export function isApproachingBudget(
  spentUsd: number,
  limitUsd: number,
  warningThresholdPct: number,
): boolean {
  return spentUsd >= (limitUsd * warningThresholdPct);
}
