/**
 * Party wave settings DAL.
 * Manages per-wave enable/disable state and per-contact configuration.
 */

import type BetterSqlite3 from 'better-sqlite3';
import { PersistenceError } from '../errors.js';
import { persistenceLogger } from '../utils/logger.js';

/** Application-level party wave setting. */
export interface PartyWaveSetting {
  waveName: string;
  enabled: boolean;
  perContactConfig: Record<string, unknown>;
  updatedAt: Date;
}

/** Per-contact configuration for a party wave. */
export interface PerContactConfig {
  contactId: string;
  enabled?: boolean;
  customMessage?: string;
  [key: string]: unknown;
}

/** Raw DB row. */
interface PartyWaveSettingDbRow {
  wave_name: string;
  enabled: number;
  per_contact_config: string;
  updated_at: string;
}

/**
 * Map a raw DB row to an application-level PartyWaveSetting.
 * @param row - The raw database row.
 * @returns The mapped PartyWaveSetting.
 */
function mapRow(row: PartyWaveSettingDbRow): PartyWaveSetting {
  let perContactConfig: Record<string, unknown> = {};
  try {
    perContactConfig = JSON.parse(row.per_contact_config) as Record<string, unknown>;
  } catch {
    // Fallback to empty config on parse failure
  }

  return {
    waveName: row.wave_name,
    enabled: row.enabled === 1,
    perContactConfig,
    updatedAt: new Date(row.updated_at),
  };
}

/**
 * Check if a party wave is enabled.
 * @param db - Database connection.
 * @param waveName - The wave name.
 * @returns True if the wave is enabled, false otherwise. Returns true if no setting exists (default enabled).
 */
export function isPartyWaveEnabled(
  db: BetterSqlite3.Database,
  waveName: string,
): boolean {
  try {
    const row = db.prepare(
      'SELECT enabled FROM party_wave_settings WHERE wave_name = ?',
    ).get(waveName) as { enabled: number } | undefined;

    // Default to enabled if no setting exists
    return row ? row.enabled === 1 : true;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to check party wave enabled status: ${message}`);
  }
}

/**
 * Get the full settings for a party wave.
 * @param db - Database connection.
 * @param waveName - The wave name.
 * @returns The party wave setting, or null if not configured.
 */
export function getPartyWaveSetting(
  db: BetterSqlite3.Database,
  waveName: string,
): PartyWaveSetting | null {
  try {
    const row = db.prepare(
      'SELECT * FROM party_wave_settings WHERE wave_name = ?',
    ).get(waveName) as PartyWaveSettingDbRow | undefined;

    return row ? mapRow(row) : null;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get party wave setting: ${message}`);
  }
}

/**
 * List all party wave settings.
 * @param db - Database connection.
 * @returns Array of all party wave settings.
 */
export function listPartyWaveSettings(
  db: BetterSqlite3.Database,
): PartyWaveSetting[] {
  try {
    const rows = db.prepare(
      'SELECT * FROM party_wave_settings ORDER BY wave_name',
    ).all() as PartyWaveSettingDbRow[];
    return rows.map(mapRow);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to list party wave settings: ${message}`);
  }
}

/**
 * Toggle a party wave's enabled state.
 * @param db - Database connection.
 * @param waveName - The wave name.
 * @param enabled - The new enabled state.
 */
export function togglePartyWave(
  db: BetterSqlite3.Database,
  waveName: string,
  enabled: boolean,
): void {
  try {
    const existing = db.prepare(
      'SELECT wave_name FROM party_wave_settings WHERE wave_name = ?',
    ).get(waveName) as { wave_name: string } | undefined;

    if (existing) {
      db.prepare(
        `UPDATE party_wave_settings SET enabled = ?, updated_at = datetime('now') WHERE wave_name = ?`,
      ).run(enabled ? 1 : 0, waveName);
    } else {
      db.prepare(
        `INSERT INTO party_wave_settings (wave_name, enabled) VALUES (?, ?)`,
      ).run(waveName, enabled ? 1 : 0);
    }

    persistenceLogger.debug({ waveName, enabled }, 'Party wave toggled');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to toggle party wave: ${message}`);
  }
}

/**
 * Get per-contact configuration for a party wave.
 * @param db - Database connection.
 * @param waveName - The wave name.
 * @param contactId - The contact ID.
 * @returns The per-contact config, or null if not configured.
 */
export function getPerContactConfig(
  db: BetterSqlite3.Database,
  waveName: string,
  contactId: string,
): PerContactConfig | null {
  try {
    const setting = getPartyWaveSetting(db, waveName);
    if (!setting) return null;

    const contactConfig = setting.perContactConfig[contactId] as PerContactConfig | undefined;
    return contactConfig || null;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to get per-contact config: ${message}`);
  }
}

/**
 * Update per-contact configuration for a party wave.
 * @param db - Database connection.
 * @param waveName - The wave name.
 * @param contactId - The contact ID.
 * @param config - The per-contact configuration to set.
 */
export function updatePerContactConfig(
  db: BetterSqlite3.Database,
  waveName: string,
  contactId: string,
  config: PerContactConfig,
): void {
  try {
    const setting = getPartyWaveSetting(db, waveName);
    const currentConfig = setting?.perContactConfig ?? {};
    const updatedConfig = { ...currentConfig, [contactId]: config };

    const existing = db.prepare(
      'SELECT wave_name FROM party_wave_settings WHERE wave_name = ?',
    ).get(waveName) as { wave_name: string } | undefined;

    if (existing) {
      db.prepare(
        `UPDATE party_wave_settings SET per_contact_config = ?, updated_at = datetime('now') WHERE wave_name = ?`,
      ).run(JSON.stringify(updatedConfig), waveName);
    } else {
      db.prepare(
        `INSERT INTO party_wave_settings (wave_name, per_contact_config) VALUES (?, ?)`,
      ).run(waveName, JSON.stringify(updatedConfig));
    }

    persistenceLogger.debug({ waveName, contactId }, 'Per-contact config updated');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new PersistenceError(`Failed to update per-contact config: ${message}`);
  }
}
