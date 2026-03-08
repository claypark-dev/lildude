/**
 * Safety tier mapper for ClawHub skills.
 * Infers the appropriate lildude safety tier based on skill requirements.
 */

/** Destructive shell commands that warrant the 'destroy' tier. */
const DESTRUCTIVE_BINS = new Set([
  'rm', 'rmdir', 'kill', 'killall', 'pkill',
  'shutdown', 'reboot', 'dd', 'mkfs',
  'fdisk', 'wipefs', 'shred',
]);

/** Shell commands that modify state but aren't destructive. */
const MODIFY_BINS = new Set([
  'mv', 'cp', 'mkdir', 'touch', 'chmod', 'chown',
  'ln', 'tar', 'zip', 'unzip', 'gzip',
  'git', 'npm', 'yarn', 'pip', 'brew',
  'docker', 'kubectl', 'systemctl',
  'sed', 'awk', 'tee', 'patch',
]);

/** Read-only commands. */
const OBSERVE_BINS = new Set([
  'cat', 'ls', 'pwd', 'echo', 'head', 'tail',
  'find', 'grep', 'wc', 'sort', 'uniq',
  'date', 'whoami', 'hostname', 'uname',
  'df', 'du', 'free', 'top', 'ps',
  'which', 'type', 'file', 'stat',
]);

export type SafetyTier = 'observe' | 'create' | 'modify' | 'destroy' | 'execute';

/**
 * Infer the safety tier for a ClawHub skill based on its requirements.
 *
 * Mapping logic:
 * - No requires at all → 'observe'
 * - Only env vars → 'create' (API-based, creates data)
 * - Non-destructive bins → 'modify'
 * - Destructive bins → 'destroy'
 * - Unknown bins (arbitrary shell) → 'execute'
 *
 * @param envVars - Required environment variables.
 * @param bins - Required shell binaries.
 * @returns The inferred safety tier.
 */
export function inferSafetyTier(
  envVars?: string[],
  bins?: string[],
): SafetyTier {
  const hasEnv = envVars && envVars.length > 0;
  const hasBins = bins && bins.length > 0;

  if (!hasEnv && !hasBins) {
    return 'observe';
  }

  if (!hasBins) {
    // Only env vars — likely API-based skill
    return 'create';
  }

  // Check bins classification
  let hasDestructive = false;
  let hasModify = false;
  let hasUnknown = false;

  for (const bin of bins) {
    const baseName = bin.split('/').pop() ?? bin;
    if (DESTRUCTIVE_BINS.has(baseName)) {
      hasDestructive = true;
    } else if (MODIFY_BINS.has(baseName)) {
      hasModify = true;
    } else if (!OBSERVE_BINS.has(baseName)) {
      hasUnknown = true;
    }
  }

  if (hasDestructive) return 'destroy';
  if (hasUnknown) return 'execute';
  if (hasModify) return 'modify';
  return 'observe';
}

/**
 * Infer the minimum tier required based on safety tier.
 */
export function inferMinTier(safetyTier: SafetyTier): 'basic' | 'standard' | 'power' {
  switch (safetyTier) {
    case 'observe':
      return 'basic';
    case 'create':
      return 'standard';
    case 'modify':
    case 'destroy':
    case 'execute':
      return 'power';
  }
}
