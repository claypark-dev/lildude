/**
 * Batch validation for generated community waves.
 * Checks that all wave directories have valid wave.json and index.js files.
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface ValidationResult {
  name: string;
  valid: boolean;
  errors: string[];
}

export interface BatchValidationResult {
  total: number;
  valid: number;
  invalid: number;
  results: ValidationResult[];
}

const VALID_SAFETY_TIERS = ['observe', 'create', 'modify', 'destroy', 'execute'];
const VALID_MIN_TIERS = ['basic', 'standard', 'power'];

/**
 * Validate a single wave directory.
 */
export function validateWave(waveDir: string): ValidationResult {
  const name = waveDir.split('/').pop() ?? waveDir;
  const errors: string[] = [];

  // Check wave.json exists
  const manifestPath = join(waveDir, 'wave.json');
  if (!existsSync(manifestPath)) {
    return { name, valid: false, errors: ['Missing wave.json'] };
  }

  // Check index.js exists
  const entryPath = join(waveDir, 'index.js');
  if (!existsSync(entryPath)) {
    errors.push('Missing index.js');
  }

  // Validate wave.json content
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

    if (!manifest.name || typeof manifest.name !== 'string') {
      errors.push('Missing or invalid name');
    }
    if (!manifest.version || typeof manifest.version !== 'string') {
      errors.push('Missing or invalid version');
    }
    if (!manifest.description || typeof manifest.description !== 'string') {
      errors.push('Missing or invalid description');
    }
    if (!manifest.author || typeof manifest.author !== 'string') {
      errors.push('Missing or invalid author');
    }
    if (!manifest.entryPoint || manifest.entryPoint !== 'index.js') {
      errors.push('Missing or wrong entryPoint');
    }
    if (!Array.isArray(manifest.triggers) || manifest.triggers.length === 0) {
      errors.push('Missing or empty triggers');
    }
    if (typeof manifest.deterministic !== 'boolean') {
      errors.push('Missing or invalid deterministic field');
    }
    if (!VALID_MIN_TIERS.includes(manifest.minTier)) {
      errors.push(`Invalid minTier: ${manifest.minTier}`);
    }
    if (manifest.safetyTier && !VALID_SAFETY_TIERS.includes(manifest.safetyTier)) {
      errors.push(`Invalid safetyTier: ${manifest.safetyTier}`);
    }
    if (!manifest.permissions || typeof manifest.permissions !== 'object') {
      errors.push('Missing permissions object');
    }
  } catch (err) {
    errors.push(`Invalid JSON in wave.json: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Validate index.js content
  if (existsSync(entryPath)) {
    const code = readFileSync(entryPath, 'utf-8');
    if (!code.includes('export async function plan')) {
      errors.push('index.js missing plan() export');
    }
    if (!code.includes('export async function execute')) {
      errors.push('index.js missing execute() export');
    }
    if (!code.includes('export async function validate')) {
      errors.push('index.js missing validate() export');
    }
  }

  return { name, valid: errors.length === 0, errors };
}

/**
 * Validate all wave directories in a parent directory.
 */
export function validateBatch(parentDir: string): BatchValidationResult {
  if (!existsSync(parentDir)) {
    return { total: 0, valid: 0, invalid: 0, results: [] };
  }

  const entries = readdirSync(parentDir);
  const results: ValidationResult[] = [];

  for (const entry of entries) {
    const entryPath = join(parentDir, entry);
    if (!statSync(entryPath).isDirectory()) continue;

    results.push(validateWave(entryPath));
  }

  const valid = results.filter((r) => r.valid).length;

  return {
    total: results.length,
    valid,
    invalid: results.length - valid,
    results,
  };
}
