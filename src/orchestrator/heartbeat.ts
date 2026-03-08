/**
 * Heartbeat runner — proactive agent system.
 *
 * Configurable interval (default: 30 minutes) that reads standing instructions
 * from ~/.lil-dude/heartbeat.md and proactively checks for actionable items.
 * Each tick builds context, sends to LLM with heartbeat prompt, and if action
 * is needed, delivers output to channels and broadcasts to WebSocket/SSE.
 *
 * Uses the cheapest available model (small tier) and has a daily budget cap
 * to prevent runaway costs (default: $0.50/day).
 */

import type BetterSqlite3 from 'better-sqlite3';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { LLMProvider, ChatResponse } from '../types/index.js';
import type { WSManager } from '../gateway/ws.js';
import { broadcastSSE } from '../gateway/api/sse.js';
import { createModuleLogger } from '../utils/logger.js';
import { homeDir } from '../config/loader.js';
import { selectModel } from '../providers/router.js';
import { calculateCost } from '../cost/pricing.js';
import { recordTokenUsage } from '../persistence/token-usage.js';
import { extractResponseText } from './agent-loop-helpers.js';
import {
  setConfigValue,
  getConfigValue,
} from '../persistence/config-store.js';

const logger = createModuleLogger('heartbeat');

// ── Configuration ──────────────────────────────────────────────────

/** Config store keys */
const LAST_HEARTBEAT_KEY = 'heartbeat.last_run_at';
const HEARTBEAT_ACTIONS_KEY = 'heartbeat.actions_today';
const HEARTBEAT_COST_KEY = 'heartbeat.cost_today';
const HEARTBEAT_DATE_KEY = 'heartbeat.cost_date';

/** Default heartbeat instructions template */
const DEFAULT_HEARTBEAT_MD = `# Standing Instructions

These are your standing instructions. Edit this file to customize what your
assistant proactively checks for during heartbeat ticks.

## Default checks
- If I have any unread important notifications, summarize them briefly
- If I have calendar events in the next 2 hours, remind me
- If any scheduled reminders are due or overdue, alert me
- If my API spend today seems unusually high, warn me

## Behavior
- If nothing needs attention, respond with exactly: [SILENT]
- Keep responses concise (2-3 sentences max)
- Only surface genuinely actionable information
- Never repeat information you already reported in a previous heartbeat
`;

// ── Types ──────────────────────────────────────────────────────────

/** Configuration for the heartbeat runner */
export interface HeartbeatConfig {
  /** Whether heartbeat is enabled (default: true) */
  enabled: boolean;
  /** Check interval in minutes (default: 30) */
  intervalMinutes: number;
  /** Maximum daily spend on heartbeat LLM calls in USD (default: 0.50) */
  maxDailyBudgetUsd: number;
  /** Override model (default: cheapest available small tier) */
  model?: string;
}

/** Dependencies for the heartbeat runner */
export interface HeartbeatDeps {
  db: BetterSqlite3.Database;
  provider: LLMProvider;
  wsManager?: WSManager;
  enabledProviders: string[];
}

/** Result of a single heartbeat tick */
export interface HeartbeatTickResult {
  /** Whether the tick produced any action */
  actionTaken: boolean;
  /** The output text (if any) */
  output: string | null;
  /** Cost of this tick in USD */
  costUsd: number;
  /** Whether the tick was skipped (budget exhausted, etc.) */
  skipped: boolean;
  /** Reason for skipping (if skipped) */
  skipReason: string | null;
}

// ── State ──────────────────────────────────────────────────────────

let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let isRunning = false;

// ── Public API ─────────────────────────────────────────────────────

/**
 * Start the heartbeat runner.
 *
 * @param deps - Database, provider, and broadcast dependencies.
 * @param config - Heartbeat configuration.
 */
export function startHeartbeatRunner(
  deps: HeartbeatDeps,
  config: HeartbeatConfig,
): void {
  if (!config.enabled) {
    logger.info('Heartbeat is disabled in config');
    return;
  }

  if (heartbeatInterval !== null) {
    logger.warn('Heartbeat runner already started, stopping existing runner first');
    stopHeartbeatRunner();
  }

  const intervalMs = (config.intervalMinutes ?? 30) * 60 * 1000;
  isRunning = true;

  logger.info(
    { intervalMinutes: config.intervalMinutes, maxDailyBudgetUsd: config.maxDailyBudgetUsd },
    'Starting heartbeat runner',
  );

  heartbeatInterval = setInterval(() => {
    void tickHeartbeat(deps, config);
  }, intervalMs);

  // Run an initial tick after a short delay (let the system fully start)
  setTimeout(() => {
    if (isRunning) {
      void tickHeartbeat(deps, config);
    }
  }, 10_000);
}

/**
 * Stop the heartbeat runner.
 */
export function stopHeartbeatRunner(): void {
  if (heartbeatInterval !== null) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
    isRunning = false;
    logger.info('Heartbeat runner stopped');
  }
}

/**
 * Check if the heartbeat runner is currently active.
 */
export function isHeartbeatRunnerActive(): boolean {
  return isRunning && heartbeatInterval !== null;
}

/**
 * Get the heartbeat status for the dashboard.
 */
export function getHeartbeatStatus(db: BetterSqlite3.Database): {
  active: boolean;
  lastRunAt: string | null;
  actionsToday: number;
  costTodayUsd: number;
} {
  return {
    active: isHeartbeatRunnerActive(),
    lastRunAt: getConfigValue(db, LAST_HEARTBEAT_KEY) ?? null,
    actionsToday: parseInt(getConfigValue(db, HEARTBEAT_ACTIONS_KEY) ?? '0', 10),
    costTodayUsd: parseFloat(getConfigValue(db, HEARTBEAT_COST_KEY) ?? '0'),
  };
}

// ── Core Tick Logic ────────────────────────────────────────────────

/**
 * Execute a single heartbeat tick.
 * Reads standing instructions, checks budget, calls LLM, and broadcasts if needed.
 */
export async function tickHeartbeat(
  deps: HeartbeatDeps,
  config: HeartbeatConfig,
): Promise<HeartbeatTickResult> {
  const startTime = Date.now();

  try {
    // 1. Check daily budget
    const budgetCheck = checkDailyBudget(deps.db, config.maxDailyBudgetUsd);
    if (!budgetCheck.withinBudget) {
      logger.debug('Heartbeat tick skipped — daily budget exhausted');
      return {
        actionTaken: false,
        output: null,
        costUsd: 0,
        skipped: true,
        skipReason: `Daily heartbeat budget exhausted ($${budgetCheck.spent.toFixed(3)} / $${config.maxDailyBudgetUsd.toFixed(2)})`,
      };
    }

    // 2. Load standing instructions
    const instructions = await loadHeartbeatInstructions();

    // 3. Select cheapest model
    const modelSelection = selectModel('small', deps.enabledProviders);

    if (!modelSelection) {
      return {
        actionTaken: false,
        output: null,
        costUsd: 0,
        skipped: true,
        skipReason: 'No model available for heartbeat',
      };
    }

    // 4. Build heartbeat prompt
    const now = new Date();
    const prompt = buildHeartbeatPrompt(instructions, now);

    // 5. Call LLM
    const response: ChatResponse = await deps.provider.chat([
      { role: 'system', content: prompt },
      { role: 'user', content: 'Run your heartbeat check now.' },
    ], {
      model: config.model ?? modelSelection.model,
      maxTokens: 300,
      temperature: 0.3,
    });

    const responseText = extractResponseText(response);

    // 6. Use actual token counts from the response
    const inputTokens = response.usage.inputTokens;
    const outputTokens = response.usage.outputTokens;
    const costUsd = calculateCost(modelSelection.model, inputTokens, outputTokens);

    // 7. Record usage
    recordTokenUsage(deps.db, {
      taskId: `heartbeat-${Date.now()}`,
      model: modelSelection.model,
      provider: modelSelection.provider,
      inputTokens,
      outputTokens,
      costUsd,
    });

    // 8. Update heartbeat tracking
    updateHeartbeatTracking(deps.db, costUsd);

    // 9. Check if the response indicates silence
    const isSilent = responseText.trim() === '[SILENT]'
      || responseText.trim() === ''
      || responseText.toLowerCase().includes('[silent]');

    if (isSilent) {
      logger.debug(
        { costUsd, durationMs: Date.now() - startTime },
        'Heartbeat tick — nothing to report',
      );
      return {
        actionTaken: false,
        output: null,
        costUsd,
        skipped: false,
        skipReason: null,
      };
    }

    // 10. Broadcast the proactive notification
    const heartbeatOutput = `\uD83D\uDC93 ${responseText.trim()}`;

    broadcastHeartbeatOutput(deps, heartbeatOutput);

    // Increment actions counter
    const currentActions = parseInt(
      getConfigValue(deps.db, HEARTBEAT_ACTIONS_KEY) ?? '0', 10,
    );
    setConfigValue(deps.db, HEARTBEAT_ACTIONS_KEY, String(currentActions + 1));

    logger.info(
      { costUsd, durationMs: Date.now() - startTime },
      'Heartbeat tick — action taken',
    );

    return {
      actionTaken: true,
      output: heartbeatOutput,
      costUsd,
      skipped: false,
      skipReason: null,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, 'Heartbeat tick failed');
    return {
      actionTaken: false,
      output: null,
      costUsd: 0,
      skipped: true,
      skipReason: `Error: ${message}`,
    };
  }
}

// ── Helpers ────────────────────────────────────────────────────────

/**
 * Load heartbeat instructions from ~/.lil-dude/heartbeat.md.
 * Creates the file with default template if it doesn't exist.
 */
async function loadHeartbeatInstructions(): Promise<string> {
  const filePath = join(homeDir(), 'heartbeat.md');

  if (!existsSync(filePath)) {
    // Create default file
    await mkdir(homeDir(), { recursive: true });
    await writeFile(filePath, DEFAULT_HEARTBEAT_MD, 'utf-8');
    logger.info({ filePath }, 'Created default heartbeat.md');
    return DEFAULT_HEARTBEAT_MD;
  }

  try {
    return await readFile(filePath, 'utf-8');
  } catch {
    logger.warn({ filePath }, 'Failed to read heartbeat.md, using defaults');
    return DEFAULT_HEARTBEAT_MD;
  }
}

/**
 * Build the system prompt for the heartbeat LLM call.
 */
function buildHeartbeatPrompt(instructions: string, now: Date): string {
  const timeStr = now.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
  const dateStr = now.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  return `You are a proactive AI executive assistant running a periodic heartbeat check.

Current time: ${timeStr} on ${dateStr}

## Your Standing Instructions
${instructions}

## Response Rules
- If nothing needs the user's attention, respond with exactly: [SILENT]
- If something IS actionable, provide a brief, clear notification (2-3 sentences max)
- Be specific about what needs attention and why
- Never make up information — only report things you can verify
- Format: Start with a relevant emoji, then the notification text
- Do NOT include "[SILENT]" if you have something to report`;
}

/**
 * Check if the daily heartbeat budget is still available.
 */
function checkDailyBudget(
  db: BetterSqlite3.Database,
  maxDailyUsd: number,
): { withinBudget: boolean; spent: number } {
  const today = new Date().toISOString().split('T')[0];
  const storedDate = getConfigValue(db, HEARTBEAT_DATE_KEY);

  if (storedDate !== today) {
    // New day — reset counters
    setConfigValue(db, HEARTBEAT_DATE_KEY, today);
    setConfigValue(db, HEARTBEAT_COST_KEY, '0');
    setConfigValue(db, HEARTBEAT_ACTIONS_KEY, '0');
    return { withinBudget: true, spent: 0 };
  }

  const spent = parseFloat(getConfigValue(db, HEARTBEAT_COST_KEY) ?? '0');
  return { withinBudget: spent < maxDailyUsd, spent };
}

/**
 * Update heartbeat tracking state after a tick.
 */
function updateHeartbeatTracking(db: BetterSqlite3.Database, costUsd: number): void {
  const now = new Date();
  setConfigValue(db, LAST_HEARTBEAT_KEY, now.toISOString());

  const today = now.toISOString().split('T')[0];
  const storedDate = getConfigValue(db, HEARTBEAT_DATE_KEY);

  if (storedDate !== today) {
    setConfigValue(db, HEARTBEAT_DATE_KEY, today);
    setConfigValue(db, HEARTBEAT_COST_KEY, String(costUsd));
  } else {
    const current = parseFloat(getConfigValue(db, HEARTBEAT_COST_KEY) ?? '0');
    setConfigValue(db, HEARTBEAT_COST_KEY, String(current + costUsd));
  }
}

/**
 * Broadcast heartbeat output to WebSocket and SSE clients.
 */
function broadcastHeartbeatOutput(deps: HeartbeatDeps, output: string): void {
  const payload = {
    type: 'heartbeat.notification' as const,
    output,
    timestamp: new Date().toISOString(),
  };

  // WebSocket broadcast
  if (deps.wsManager) {
    try {
      deps.wsManager.broadcast('*', {
        type: 'heartbeat.notification',
        payload,
        timestamp: payload.timestamp,
      });
    } catch {
      // Non-critical
    }
  }

  // SSE broadcast
  try {
    broadcastSSE('heartbeat.notification', payload);
  } catch {
    // Non-critical
  }
}

// ── Exported for Testing ───────────────────────────────────────────

export { buildHeartbeatPrompt as _buildHeartbeatPrompt };
export { checkDailyBudget as _checkDailyBudget };
export { DEFAULT_HEARTBEAT_MD };
