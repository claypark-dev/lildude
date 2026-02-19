/**
 * Context module barrel exports.
 * Re-exports the context manager, knowledge formatter, and summarizer for convenient imports.
 */

export { buildContext } from './manager.js';
export type { BuildContextOptions } from './manager.js';
export { formatKnowledgeForContext } from './knowledge.js';
export { needsSummarization, summarizeConversation, extractKeyFacts } from './summarizer.js';
export type { SummarizeOptions, SummarizationResult } from './summarizer.js';
