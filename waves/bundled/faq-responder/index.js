/**
 * FAQ Responder Wave — observe tier.
 * Answer common questions from the owner's configured FAQ entries.
 * Searches FAQ entries and returns the best matching answer.
 * Deterministic execution (no LLM needed).
 */

/**
 * Parse a question from user input.
 * @param {string} input - The user's message.
 * @returns {{ query: string }} Extracted query.
 */
function parseQuestionInput(input) {
  // Strip common prefixes
  let query = input
    .replace(/^(?:question about|faq|who is|how do i|what is|tell me about)\s*/i, '')
    .trim();

  // Fallback to full input
  if (!query) {
    query = input.trim();
  }

  return { query: query.slice(0, 500) };
}

/**
 * Simple keyword scoring for FAQ matching.
 * @param {string} question - The FAQ question text.
 * @param {string} query - The user query.
 * @returns {number} Match score (0 = no match).
 */
function scoreFaqMatch(question, query) {
  const lowerQuestion = question.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const queryWords = lowerQuery.split(/\s+/).filter((w) => w.length > 2);

  if (queryWords.length === 0) return 0;

  let matchingWords = 0;
  for (const word of queryWords) {
    if (lowerQuestion.includes(word)) {
      matchingWords++;
    }
  }

  return matchingWords / queryWords.length;
}

export async function plan(userInput, _context) {
  const parsed = parseQuestionInput(userInput);

  return {
    steps: [
      {
        type: 'api_call',
        description: 'Search FAQ entries for matching answers',
        params: parsed,
      },
    ],
    estimatedCostUsd: 0,
    isDeterministic: true,
    extractedParams: parsed,
  };
}

export async function execute(wavePlan) {
  const { query, _deps } = wavePlan.extractedParams;

  try {
    if (!query || query.trim().length === 0) {
      return {
        success: false,
        output: '',
        error: 'Please provide a question to search the FAQ.',
      };
    }

    // If we have DB access, search real FAQ entries
    if (_deps?.db) {
      try {
        const rows = _deps.db.prepare(
          'SELECT id, question, answer, category FROM faq_entries WHERE enabled = 1',
        ).all();

        if (rows.length === 0) {
          return {
            success: true,
            output: 'No FAQ entries are configured yet. The owner has not set up any frequently asked questions.',
            metadata: { waveId: 'faq-responder', matchCount: 0 },
          };
        }

        // Score each FAQ against the query
        const scored = rows
          .map((row) => ({ ...row, score: scoreFaqMatch(row.question, query) }))
          .filter((r) => r.score > 0)
          .sort((a, b) => b.score - a.score);

        if (scored.length === 0) {
          return {
            success: true,
            output: `No FAQ entries matched your question "${query}". Try rephrasing or ask the owner directly.`,
            metadata: { waveId: 'faq-responder', matchCount: 0 },
          };
        }

        // Increment access count for top match
        _deps.db.prepare(
          'UPDATE faq_entries SET access_count = access_count + 1 WHERE id = ?',
        ).run(scored[0].id);

        const topMatch = scored[0];
        const output = [
          `Q: ${topMatch.question}`,
          `A: ${topMatch.answer}`,
          scored.length > 1 ? `\n${scored.length - 1} more related FAQ entries available.` : '',
        ].filter(Boolean).join('\n');

        return {
          success: true,
          output,
          metadata: {
            waveId: 'faq-responder',
            matchCount: scored.length,
            topMatchId: topMatch.id,
          },
        };
      } catch (dbError) {
        // Fall through to fallback
      }
    }

    // Fallback when no DB is available
    return {
      success: true,
      output: `Your question about "${query}" has been received. No FAQ entries are currently configured.`,
      metadata: { waveId: 'faq-responder', matchCount: 0 },
    };
  } catch (error) {
    return {
      success: false,
      output: '',
      error: `Failed to search FAQ: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function validate(result) {
  if (!result.success) {
    return { valid: false, feedback: result.error || 'FAQ search failed' };
  }
  return { valid: true };
}
