/**
 * System prompt builder for Lil Dude.
 * Constructs the full system prompt string including identity, security rules,
 * available waves, and general instructions based on configuration.
 * Pure function with no side effects.
 * See HLD Section S1.I.1.
 */

/** Security level labels mapped to their numeric levels (1-5). */
const SECURITY_LEVEL_LABELS: Record<number, string> = {
  1: 'Tin Foil Hat',
  2: 'Careful',
  3: 'Balanced',
  4: 'Trusting',
  5: 'YOLO',
};

/** Security rules corresponding to each security level (1-5). */
const SECURITY_RULES: Record<number, string> = {
  1: 'You MUST ask for approval before ANY command execution, file access, or API call.',
  2: 'Ask approval for destructive operations, new domains, and sudo commands.',
  3: 'Execute safe operations autonomously. Ask approval for destructive or risky actions.',
  4: 'Execute most operations autonomously. Only ask for highly destructive actions.',
  5: 'Execute all operations autonomously. No approval needed.',
};

/**
 * Build the core identity section of the system prompt.
 * @param userName - The name of the user the agent is assisting.
 * @param agentName - Optional custom name for the agent (default: 'Lil Dude').
 * @param agentPersona - Optional persona description.
 * @returns The identity section string.
 */
function buildIdentitySection(
  userName: string,
  agentName = 'Lil Dude',
  agentPersona = 'a chill, capable AI executive assistant',
): string {
  return `You are ${agentName}, ${agentPersona} for ${userName}.`;
}

/**
 * Build the security rules section based on the configured security level.
 * @param securityLevel - The security level (1-5).
 * @returns The security rules section string.
 */
function buildSecuritySection(securityLevel: number): string {
  const clampedLevel = Math.max(1, Math.min(5, Math.round(securityLevel)));
  const label = SECURITY_LEVEL_LABELS[clampedLevel];
  const rule = SECURITY_RULES[clampedLevel];

  const lines = [
    `## Security Level: ${clampedLevel} (${label})`,
    rule,
  ];

  return lines.join('\n');
}

/**
 * Build the waves/tools section listing active waves.
 * @param activeWaves - Array of wave names currently available.
 * @returns The waves section string, or empty string if no waves are active.
 */
function buildWavesSection(activeWaves: string[]): string {
  if (activeWaves.length === 0) {
    return '## Available Waves\nNo waves currently active.';
  }

  const waveLines = activeWaves.map((wave) => `- ${wave}`);
  return ['## Available Waves', ...waveLines].join('\n');
}

/** A lightweight user profile entry for prompt injection (no DB dependency). */
export interface ProfileEntry {
  key: string;
  value: string;
}

/**
 * Build the user profile section from learned preferences.
 * Injects known user preferences and patterns into the system prompt
 * so the assistant can personalize responses without re-querying.
 * @param entries - Array of user profile key-value entries.
 * @returns The user profile section string, or empty string if no entries.
 */
function buildUserProfileSection(entries: ProfileEntry[]): string {
  if (entries.length === 0) {
    return '';
  }

  const lines = entries.map((entry) => `- ${entry.key}: ${entry.value}`);
  return ['## What I Know About You', ...lines].join('\n');
}

/**
 * Build the general instructions section.
 * These instructions apply regardless of security level or waves.
 * @returns The general instructions section string.
 */
function buildInstructionsSection(): string {
  return [
    '## Instructions',
    '- Be concise in your responses.',
    '- Track and minimize token costs for every action.',
    '- Prefer deterministic execution over LLM calls when possible.',
    '- Report errors clearly with actionable context.',
    '- Never expose secrets, API keys, or tokens in your output.',
  ].join('\n');
}

/** Optional agent identity configuration. */
export interface AgentIdentity {
  /** Custom display name (default: 'Lil Dude'). */
  name?: string;
  /** Short persona description (default: 'a chill, capable AI executive assistant'). */
  persona?: string;
}

/**
 * Build the full system prompt for the assistant.
 * Assembles identity, security rules, active waves, user profile,
 * and general instructions into a single prompt string.
 *
 * @param userName - The name of the user the agent is assisting.
 * @param securityLevel - The security level (1-5) controlling approval requirements.
 * @param activeWaves - Array of wave names currently available to the assistant.
 * @param userProfile - Optional array of learned user preference entries.
 * @param agentIdentity - Optional custom agent name and persona.
 * @returns The fully assembled system prompt string.
 */
export function buildSystemPrompt(
  userName: string,
  securityLevel: number,
  activeWaves: string[],
  userProfile?: ProfileEntry[],
  agentIdentity?: AgentIdentity,
): string {
  const sections = [
    buildIdentitySection(userName, agentIdentity?.name, agentIdentity?.persona),
    '',
    buildSecuritySection(securityLevel),
    '',
    buildWavesSection(activeWaves),
  ];

  const profileSection = buildUserProfileSection(userProfile ?? []);
  if (profileSection.length > 0) {
    sections.push('', profileSection);
  }

  sections.push('', buildInstructionsSection());

  return sections.join('\n');
}
