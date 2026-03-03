/**
 * Vector-based request classifier for safety tier enforcement.
 * Embeds user requests and compares against canonical safety tier examples
 * stored in the request_classifications table. Cross-references with
 * the wave manifest's declared safety tier and uses the more restrictive.
 *
 * This provides a second layer of safety: even if a wave declares itself
 * as "observe", if the user's request semantically matches "modify" or
 * "destroy" examples, the more restrictive tier is used.
 */

import type BetterSqlite3 from 'better-sqlite3';
import type { WaveSafetyTier } from '../types/index.js';
import {
  cosineSimilarity,
  embeddingToBuffer,
  bufferToEmbedding,
  type EmbeddingResult,
} from '../memory/embeddings.js';
import { createModuleLogger } from '../utils/logger.js';

const classifierLogger = createModuleLogger('request-classifier');

/** Result of classifying a user request. */
export interface ClassificationResult {
  /** The inferred safety tier from the request content. */
  inferredTier: WaveSafetyTier;
  /** Confidence score (0-1). */
  confidence: number;
  /** The matched canonical example, if any. */
  matchedExample: string | null;
  /** The category of the matched example. */
  category: string | null;
}

/** Canonical examples for seeding the classifications table. */
export const CANONICAL_EXAMPLES: Array<{
  text: string;
  tier: WaveSafetyTier;
  category: string;
}> = [
  // Observe tier — read-only operations
  { text: 'check my email', tier: 'observe', category: 'email' },
  { text: 'show me today\'s calendar events', tier: 'observe', category: 'calendar' },
  { text: 'what is the weather today', tier: 'observe', category: 'weather' },
  { text: 'search the web for news about AI', tier: 'observe', category: 'search' },
  { text: 'check the stock price of AAPL', tier: 'observe', category: 'finance' },
  { text: 'list my recent tasks', tier: 'observe', category: 'tasks' },
  { text: 'read the contents of my notes file', tier: 'observe', category: 'file' },

  // Create tier — adds new resources
  { text: 'send an email to John about the meeting', tier: 'create', category: 'email' },
  { text: 'add a meeting to my calendar for tomorrow at 2pm', tier: 'create', category: 'calendar' },
  { text: 'set a reminder for 5pm', tier: 'create', category: 'reminders' },
  { text: 'create a new file with my notes', tier: 'create', category: 'file' },
  { text: 'draft a reply to the latest email', tier: 'create', category: 'email' },

  // Modify tier — changes existing resources
  { text: 'reschedule my meeting to 3pm', tier: 'modify', category: 'calendar' },
  { text: 'update the project document with new status', tier: 'modify', category: 'file' },
  { text: 'change the reminder time to 6pm', tier: 'modify', category: 'reminders' },
  { text: 'edit my profile settings', tier: 'modify', category: 'settings' },
  { text: 'move the file to the archive folder', tier: 'modify', category: 'file' },

  // Destroy tier — removes/deletes resources
  { text: 'delete all old emails from last month', tier: 'destroy', category: 'email' },
  { text: 'cancel my meeting tomorrow', tier: 'destroy', category: 'calendar' },
  { text: 'remove all completed reminders', tier: 'destroy', category: 'reminders' },
  { text: 'delete the temporary files', tier: 'destroy', category: 'file' },

  // Execute tier — runs code or system commands
  { text: 'run the build script', tier: 'execute', category: 'shell' },
  { text: 'execute the deployment pipeline', tier: 'execute', category: 'shell' },
  { text: 'install the npm package', tier: 'execute', category: 'shell' },
  { text: 'restart the server', tier: 'execute', category: 'shell' },
];

/** Safety tier priority order (higher index = more restrictive). */
const TIER_PRIORITY: Record<WaveSafetyTier, number> = {
  observe: 0,
  create: 1,
  modify: 2,
  destroy: 3,
  execute: 4,
};

/**
 * Seed the request_classifications table with canonical examples.
 * Only inserts examples that don't already exist.
 *
 * @param db - The database instance.
 * @param embeddingGenerator - The embedding generator to use.
 */
export async function seedClassifications(
  db: BetterSqlite3.Database,
  embeddingGenerator: { generateEmbedding: (text: string) => Promise<EmbeddingResult> },
): Promise<number> {
  let seeded = 0;

  for (const example of CANONICAL_EXAMPLES) {
    const existing = db.prepare(
      'SELECT id FROM request_classifications WHERE example_text = ?',
    ).get(example.text) as { id: number } | undefined;

    if (existing) continue;

    try {
      const result = await embeddingGenerator.generateEmbedding(example.text);
      const embeddingBuffer = embeddingToBuffer(result.embedding);

      db.prepare(`
        INSERT INTO request_classifications (example_text, safety_tier, category, embedding, embedding_model)
        VALUES (?, ?, ?, ?, ?)
      `).run(example.text, example.tier, example.category, embeddingBuffer, result.model);

      seeded++;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      classifierLogger.warn({ example: example.text, error: message }, 'Failed to seed classification');
    }
  }

  classifierLogger.info({ seeded }, 'Classification seeding complete');
  return seeded;
}

/**
 * Classify a user request by comparing its embedding against canonical examples.
 * Returns the inferred safety tier with confidence score.
 *
 * @param db - The database instance.
 * @param requestEmbedding - The pre-computed embedding of the user request.
 * @param topK - Number of closest matches to consider.
 * @returns The classification result.
 */
export function classifyRequest(
  db: BetterSqlite3.Database,
  requestEmbedding: EmbeddingResult,
  topK = 3,
): ClassificationResult {
  try {
    const rows = db.prepare(
      'SELECT example_text, safety_tier, category, embedding FROM request_classifications WHERE embedding IS NOT NULL',
    ).all() as Array<{
      example_text: string;
      safety_tier: string;
      category: string;
      embedding: Buffer;
    }>;

    if (rows.length === 0) {
      return { inferredTier: 'observe', confidence: 0, matchedExample: null, category: null };
    }

    // Compute similarity for all examples
    const scored = rows.map((row) => {
      const exampleEmbedding = bufferToEmbedding(row.embedding);
      const similarity = cosineSimilarity(requestEmbedding.embedding, exampleEmbedding);
      return { ...row, similarity };
    });

    // Sort by similarity descending and take top K
    scored.sort((a, b) => b.similarity - a.similarity);
    const topMatches = scored.slice(0, topK);

    // Weighted vote: higher similarity = more weight
    const tierVotes: Record<string, number> = {};
    for (const match of topMatches) {
      tierVotes[match.safety_tier] = (tierVotes[match.safety_tier] ?? 0) + match.similarity;
    }

    // Find tier with highest weighted vote
    let bestTier = 'observe';
    let bestWeight = 0;
    for (const [tierName, weight] of Object.entries(tierVotes)) {
      if (weight > bestWeight) {
        bestTier = tierName;
        bestWeight = weight;
      }
    }

    const topMatch = topMatches[0];
    const confidence = topMatch ? topMatch.similarity : 0;

    return {
      inferredTier: bestTier as WaveSafetyTier,
      confidence,
      matchedExample: topMatch?.example_text ?? null,
      category: topMatch?.category ?? null,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    classifierLogger.warn({ error: message }, 'Request classification failed, defaulting to observe');
    return { inferredTier: 'observe', confidence: 0, matchedExample: null, category: null };
  }
}

/**
 * Get the more restrictive safety tier between the wave manifest's
 * declared tier and the inferred tier from the request classifier.
 *
 * @param manifestTier - The safety tier declared in the wave manifest.
 * @param inferredTier - The safety tier inferred from the user request.
 * @returns The more restrictive tier.
 */
export function getEffectiveSafetyTier(
  manifestTier: WaveSafetyTier,
  inferredTier: WaveSafetyTier,
): WaveSafetyTier {
  const manifestPriority = TIER_PRIORITY[manifestTier] ?? 0;
  const inferredPriority = TIER_PRIORITY[inferredTier] ?? 0;
  return inferredPriority > manifestPriority ? inferredTier : manifestTier;
}
