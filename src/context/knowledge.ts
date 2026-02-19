/**
 * Knowledge formatter for context building.
 * Transforms knowledge entries from the database into a concise string
 * representation suitable for inclusion in the LLM context window.
 * Respects a maximum token budget to prevent context overflow.
 * See HLD Section S1.I.1.
 */

import { countTokens } from '../cost/tokens.js';
import type { KnowledgeRow } from '../persistence/knowledge.js';

/**
 * Format a single knowledge entry as a concise key-value line.
 * @param entry - The knowledge entry to format.
 * @returns A formatted string like "[category] key: value".
 */
function formatEntry(entry: KnowledgeRow): string {
  return `[${entry.category}] ${entry.key}: ${entry.value}`;
}

/**
 * Format knowledge entries from the database into a concise string
 * for inclusion in the LLM context. Entries are formatted as key-value
 * lines grouped under a header. The output is trimmed to fit within
 * the specified maxTokens budget.
 *
 * Entries are processed in order; once the token budget is exhausted,
 * remaining entries are omitted. Higher-confidence entries should be
 * sorted first by the caller for best results.
 *
 * @param entries - Knowledge entries from the database to format.
 * @param maxTokens - Maximum number of tokens the formatted output may consume.
 * @returns A formatted string of knowledge entries that fits within the token budget.
 */
export function formatKnowledgeForContext(
  entries: KnowledgeRow[],
  maxTokens: number,
): string {
  if (entries.length === 0) {
    return '';
  }

  const header = '## Known Facts';
  const headerTokens = countTokens(header);

  if (headerTokens >= maxTokens) {
    return '';
  }

  let remainingTokens = maxTokens - headerTokens;
  const includedLines: string[] = [header];

  for (const entry of entries) {
    const line = formatEntry(entry);
    const lineTokens = countTokens(line);

    if (lineTokens > remainingTokens) {
      break;
    }

    includedLines.push(line);
    remainingTokens -= lineTokens;
  }

  // If only the header was included with no entries, return empty
  if (includedLines.length === 1) {
    return '';
  }

  return includedLines.join('\n');
}
