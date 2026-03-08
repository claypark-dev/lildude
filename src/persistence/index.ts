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
export { createContact, getContact, getContactByPhone, getContactByEmail, getContactByChannelId, updateContact, deleteContact, listContacts, getContactsByTrustLevel, getFavoriteContacts, searchContacts, resolveContact, touchContact, countContacts } from './contacts.js';
export { logExternalEvent, getExternalAuditByContact, getExternalAuditByType, countExternalEvents } from './external-audit.js';
export type { ExternalAuditEventType, ExternalAuditEntry } from './external-audit.js';
export { createRelayedMessage, getRelayedMessage, listRelayedMessages, markMessageRead, markMessageReplied, archiveMessage, countUnreadMessages, getMessagesByContact } from './relayed-messages.js';
export type { RelayedMessage, CreateRelayedMessageInput, MessageUrgency, MessageStatus } from './relayed-messages.js';
export { getAutoResponderConfig, updateAutoResponderConfig } from './auto-responder.js';
export type { AutoResponderConfig, UpdateAutoResponderInput, OwnerStatus } from './auto-responder.js';
export { createMeetingRequest, getMeetingRequest, listMeetingRequests, approveMeetingRequest, declineMeetingRequest, countPendingMeetingRequests, getMeetingRequestsByContact } from './meeting-requests.js';
export type { MeetingRequest, CreateMeetingRequestInput, MeetingRequestStatus } from './meeting-requests.js';
export { createContactGroup, getContactGroup, getContactGroupByName, listContactGroups, updateContactGroup, deleteContactGroup, addContactToGroup, removeContactFromGroup, getGroupsForContact, countContactGroups } from './contact-groups.js';
export type { ContactGroup, CreateContactGroupInput, UpdateContactGroupInput } from './contact-groups.js';
export { upsertAuthor, getAuthor, incrementPublishedCount, updateAuthorStats, listAuthors } from './wave-authors.js';
export type { WaveAuthor } from './wave-authors.js';
export { upsertTrustScore, getTrustScore, getTrustScoresBatch, listTrustScores, deleteTrustScore } from './wave-community-trust.js';
export type { WaveTrustEntry } from './wave-community-trust.js';
export { recordPublish, updatePublishStatus, getPublishHistory, listPublishHistory } from './wave-publish-history.js';
export type { PublishHistoryEntry, PublishStatus } from './wave-publish-history.js';
export { storePackageHash, getPackageHash, verifyPackageHash, deletePackageHash } from './wave-package-hashes.js';
export type { PackageHashEntry } from './wave-package-hashes.js';
