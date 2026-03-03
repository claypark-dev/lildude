/**
 * Auto-responder configuration DAL.
 * Manages the owner's status/away message configuration (singleton row).
 */

import type BetterSqlite3 from 'better-sqlite3';
import { PersistenceError } from '../errors.js';
import { persistenceLogger } from '../utils/logger.js';

/** Valid owner status values. */
export type OwnerStatus = 'available' | 'busy' | 'away' | 'dnd' | 'vacation' | 'offline';

/** Application-level auto-responder config. */
export interface AutoResponderConfig {
  enabled: boolean;
  status: OwnerStatus;
  customMessage: string | null;
  returnDate: string | null;
  alternateContact: string | null;
  updatedAt: Date;
}

/** Input for updating auto-responder config. */
export interface UpdateAutoResponderInput {
  enabled?: boolean;
  status?: OwnerStatus;
  customMessage?: string | null;
  returnDate?: string | null;
  alternateContact?: string | null;
}

/** Raw DB row. */
interface AutoResponderDbRow {
  id: number;
  enabled: number;
  status: string;
  custom_message: string | null;
  return_date: string | null;
  alternate_contact: string | null;
  updated_at: string;
}

function mapRow(row: AutoResponderDbRow): AutoResponderConfig {
  return {
    enabled: row.enabled === 1,
    status: row.status as OwnerStatus,
    customMessage: row.custom_message,
    returnDate: row.return_date,
    alternateContact: row.alternate_contact,
    updatedAt: new Date(row.updated_at),
  };
}

/**
 * Get the auto-responder configuration.
 * @param db - Database connection.
 * @returns The current config.
 */
export function getAutoResponderConfig(
  db: BetterSqlite3.Database,
): AutoResponderConfig {
  try {
    const row = db.prepare('SELECT * FROM auto_responder_config WHERE id = 1').get() as AutoResponderDbRow | undefined;

    if (!row) {
      // Return defaults if somehow missing
      return {
        enabled: false,
        status: 'available',
        customMessage: null,
        returnDate: null,
        alternateContact: null,
        updatedAt: new Date(),
      };
    }

    return mapRow(row);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get auto-responder config: ${message}`);
  }
}

/**
 * Update the auto-responder configuration.
 * @param db - Database connection.
 * @param input - Fields to update.
 * @returns The updated config.
 */
export function updateAutoResponderConfig(
  db: BetterSqlite3.Database,
  input: UpdateAutoResponderInput,
): AutoResponderConfig {
  try {
    const setClauses: string[] = [];
    const values: unknown[] = [];

    if (input.enabled !== undefined) {
      setClauses.push('enabled = ?');
      values.push(input.enabled ? 1 : 0);
    }
    if (input.status !== undefined) {
      setClauses.push('status = ?');
      values.push(input.status);
    }
    if (input.customMessage !== undefined) {
      setClauses.push('custom_message = ?');
      values.push(input.customMessage);
    }
    if (input.returnDate !== undefined) {
      setClauses.push('return_date = ?');
      values.push(input.returnDate);
    }
    if (input.alternateContact !== undefined) {
      setClauses.push('alternate_contact = ?');
      values.push(input.alternateContact);
    }

    if (setClauses.length === 0) {
      return getAutoResponderConfig(db);
    }

    setClauses.push("updated_at = datetime('now')");

    db.prepare(
      `UPDATE auto_responder_config SET ${setClauses.join(', ')} WHERE id = 1`,
    ).run(...values);

    persistenceLogger.debug({ fields: Object.keys(input) }, 'Auto-responder config updated');

    return getAutoResponderConfig(db);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to update auto-responder config: ${message}`);
  }
}
