/**
 * Standardized smoke test harness for community waves.
 * Validates that each wave directory has a valid wave.json manifest
 * and index.js with required exports (plan, execute, validate).
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface WaveTestResult {
  name: string;
  valid: boolean;
  hasManifest: boolean;
  hasIndex: boolean;
  hasPlan: boolean;
  hasExecute: boolean;
  hasValidate: boolean;
  manifestErrors: string[];
  category?: string;
  safetyTier?: string;
}

export interface BatchTestResult {
  total: number;
  valid: number;
  invalid: number;
  results: WaveTestResult[];
}

const REQUIRED_MANIFEST_FIELDS = [
  'name', 'version', 'description', 'author', 'permissions',
  'triggers', 'deterministic', 'tools', 'minTier', 'entryPoint',
  'safetyTier',
];

const VALID_SAFETY_TIERS = ['observe', 'create', 'modify', 'destroy', 'execute'];
const VALID_MIN_TIERS = ['basic', 'standard', 'power'];

/**
 * Test a single wave directory for validity.
 */
export function testWave(waveDir: string): WaveTestResult {
  const name = waveDir.split('/').pop() || waveDir;
  const result: WaveTestResult = {
    name,
    valid: true,
    hasManifest: false,
    hasIndex: false,
    hasPlan: false,
    hasExecute: false,
    hasValidate: false,
    manifestErrors: [],
  };

  // Check wave.json
  const manifestPath = join(waveDir, 'wave.json');
  if (!existsSync(manifestPath)) {
    result.valid = false;
    result.manifestErrors.push('Missing wave.json');
    return result;
  }
  result.hasManifest = true;

  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  } catch (e) {
    result.valid = false;
    result.manifestErrors.push(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
    return result;
  }

  // Validate required fields
  for (const field of REQUIRED_MANIFEST_FIELDS) {
    if (!(field in manifest)) {
      result.manifestErrors.push(`Missing field: ${field}`);
      result.valid = false;
    }
  }

  // Validate field types
  if (typeof manifest.name !== 'string') {
    result.manifestErrors.push('name must be a string');
    result.valid = false;
  }
  if (typeof manifest.version !== 'string') {
    result.manifestErrors.push('version must be a string');
    result.valid = false;
  }
  if (typeof manifest.deterministic !== 'boolean') {
    result.manifestErrors.push('deterministic must be a boolean');
    result.valid = false;
  }
  if (!Array.isArray(manifest.triggers)) {
    result.manifestErrors.push('triggers must be an array');
    result.valid = false;
  }
  if (!Array.isArray(manifest.tools)) {
    result.manifestErrors.push('tools must be an array');
    result.valid = false;
  }

  // Validate safety tier
  if (manifest.safetyTier && !VALID_SAFETY_TIERS.includes(manifest.safetyTier as string)) {
    result.manifestErrors.push(`Invalid safetyTier: ${manifest.safetyTier}`);
    result.valid = false;
  }

  // Validate min tier
  if (manifest.minTier && !VALID_MIN_TIERS.includes(manifest.minTier as string)) {
    result.manifestErrors.push(`Invalid minTier: ${manifest.minTier}`);
    result.valid = false;
  }

  result.category = manifest.category as string | undefined;
  result.safetyTier = manifest.safetyTier as string | undefined;

  // Check index.js
  const indexPath = join(waveDir, 'index.js');
  if (!existsSync(indexPath)) {
    result.valid = false;
    result.manifestErrors.push('Missing index.js');
    return result;
  }
  result.hasIndex = true;

  const indexContent = readFileSync(indexPath, 'utf-8');
  result.hasPlan = indexContent.includes('export async function plan') || indexContent.includes('exports.plan');
  result.hasExecute = indexContent.includes('export async function execute') || indexContent.includes('exports.execute');
  result.hasValidate = indexContent.includes('export async function validate') || indexContent.includes('exports.validate');

  if (!result.hasPlan) {
    result.manifestErrors.push('index.js missing plan export');
    result.valid = false;
  }
  if (!result.hasExecute) {
    result.manifestErrors.push('index.js missing execute export');
    result.valid = false;
  }

  return result;
}

/**
 * Test all wave directories in a given path.
 */
export function testBatch(wavesDir: string): BatchTestResult {
  const results: WaveTestResult[] = [];

  if (!existsSync(wavesDir)) {
    return { total: 0, valid: 0, invalid: 0, results };
  }

  for (const entry of readdirSync(wavesDir)) {
    const entryPath = join(wavesDir, entry);
    try {
      if (!statSync(entryPath).isDirectory()) continue;
    } catch {
      continue;
    }

    // Skip non-wave directories (like categories.json)
    if (!existsSync(join(entryPath, 'wave.json'))) continue;

    results.push(testWave(entryPath));
  }

  const valid = results.filter(r => r.valid).length;

  return {
    total: results.length,
    valid,
    invalid: results.length - valid,
    results,
  };
}
