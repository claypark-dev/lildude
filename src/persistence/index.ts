/**
 * Persistence layer public API.
 * Re-exports the database manager and DAL modules for use by other modules.
 */

export { createDatabase } from './db.js';
export type { DatabaseManager } from './db.js';
export { setConfigValue, getConfigValue, deleteConfigValue, getAllConfig } from './config-store.js';
export { createTask, getTask, updateTaskStatus, updateTaskSpend, getTasksByStatus, getRecentTasks, deleteTask } from './tasks.js';
export { createConversation, getConversation, updateConversationSummary, updateConversationKeyFacts, incrementMessageCount, getConversationsByChannel, deleteConversation } from './conversations.js';
export { appendConversationLog, getConversationLogs, getConversationTokenCount, deleteOldLogs } from './conversation-logs.js';
export { upsertKnowledge, getKnowledge, searchKnowledge, getKnowledgeByCategory, deleteKnowledge } from './knowledge.js';
export { recordTokenUsage, getUsageByTask, getUsageByModel, getDailyTotalCost, getMonthlyTotalCost, getTaskTotalCost } from './token-usage.js';
export { createCronJob, getCronJob, getEnabledCronJobs, updateCronJobLastRun, toggleCronJob, deleteCronJob, getMissedJobs } from './cron-jobs.js';
export { appendSecurityLog, getRecentSecurityLogs, getSecurityLogsByAction, getSecurityLogsByAllowed, countSecurityLogs } from './security-log.js';
export { createApproval, getApproval, getPendingApprovals, approveRequest, denyRequest, expireOldApprovals, getApprovalsByTask } from './approvals.js';
