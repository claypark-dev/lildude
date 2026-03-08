/**
 * ClawHub → lildude wave manifest mapper.
 * Converts parsed ClawHub SKILL.md data into a WaveManifest-compatible object.
 */

import type { ClawHubSkill } from './parser.js';
import { inferSafetyTier, inferMinTier, type SafetyTier } from './safety-mapper.js';
import { getDomainsForEnvVars, inferCategory } from './clawhub-mappings.js';

/** Subset of WaveManifest needed for wave.json output. */
export interface WaveManifestOutput {
  name: string;
  version: string;
  description: string;
  author: string;
  permissions: {
    domains: string[];
    shell: string[];
    directories: string[];
    requiresBrowser: boolean;
    requiresOAuth: string[];
  };
  triggers: string[];
  deterministic: boolean;
  tools: Array<{
    name: string;
    description: string;
    parameters: Record<string, string>;
  }>;
  minTier: 'basic' | 'standard' | 'power';
  entryPoint: string;
  safetyTier: SafetyTier;
  category: string;
}

/**
 * Map a parsed ClawHub skill to a lildude WaveManifest.
 *
 * @param skill - The parsed ClawHub skill data.
 * @param authorOverride - Optional author name override (default: 'clawhub-community').
 * @returns The wave manifest ready for wave.json.
 */
export function mapToWaveManifest(
  skill: ClawHubSkill,
  authorOverride?: string,
): WaveManifestOutput {
  const envVars = skill.metadata.openclaw?.requires?.env ?? [];
  const bins = skill.metadata.openclaw?.requires?.bins ?? [];

  const safetyTier = inferSafetyTier(envVars, bins);
  const minTier = inferMinTier(safetyTier);
  const domains = getDomainsForEnvVars(envVars);
  const category = envVars.length > 0 ? inferCategory(envVars) : 'utilities';

  // Generate triggers from the skill name and description
  const triggers = generateTriggers(skill.name, skill.description);

  // Generate a primary tool based on the skill
  const toolName = skill.name.replace(/-/g, '_');
  const tools = [
    {
      name: toolName,
      description: skill.description,
      parameters: generateToolParameters(skill),
    },
  ];

  return {
    name: skill.name,
    version: skill.version,
    description: skill.description,
    author: authorOverride ?? 'clawhub-community',
    permissions: {
      domains,
      shell: bins,
      directories: [],
      requiresBrowser: false,
      requiresOAuth: [],
    },
    triggers,
    deterministic: bins.length === 0,
    tools,
    minTier,
    entryPoint: 'index.js',
    safetyTier,
    category,
  };
}

/**
 * Generate trigger words from a skill name and description.
 */
function generateTriggers(name: string, description: string): string[] {
  const triggers = new Set<string>();

  // Split name on hyphens
  const nameParts = name.split('-').filter((p) => p.length > 2);
  for (const part of nameParts) {
    triggers.add(part.toLowerCase());
  }

  // Add the full name
  triggers.add(name.replace(/-/g, ' '));

  // Extract key words from description (skip common words)
  const stopWords = new Set([
    'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'is', 'it', 'as', 'be', 'this', 'that',
    'are', 'was', 'were', 'will', 'can', 'do', 'does', 'did', 'has', 'have',
    'been', 'being', 'having', 'use', 'using', 'used', 'your', 'you',
  ]);

  const descWords = description
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w));

  for (const word of descWords.slice(0, 5)) {
    triggers.add(word);
  }

  return Array.from(triggers).slice(0, 8);
}

/**
 * Generate tool parameters based on skill metadata.
 * API-based skills get an 'input' parameter.
 * Shell-based skills get 'input' and 'args' parameters.
 */
function generateToolParameters(
  skill: ClawHubSkill,
): Record<string, string> {
  const bins = skill.metadata.openclaw?.requires?.bins ?? [];

  if (bins.length > 0) {
    return {
      input: 'string',
      args: 'string',
    };
  }

  return {
    input: 'string',
  };
}
