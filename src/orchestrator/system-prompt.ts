/**
 * System prompt builder for Lil Dude.
 * Constructs the full system prompt string including identity, security rules,
 * available skills, and general instructions based on configuration.
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
 * @param userName - The name of the user Lil Dude is assisting.
 * @returns The identity section string.
 */
function buildIdentitySection(userName: string): string {
  return `You are Lil Dude, a personal AI executive assistant for ${userName}.`;
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
 * Build the skills/tools section listing active skills.
 * @param activeSkills - Array of skill names currently available.
 * @returns The skills section string, or empty string if no skills are active.
 */
function buildSkillsSection(activeSkills: string[]): string {
  if (activeSkills.length === 0) {
    return '## Available Skills\nNo skills currently active.';
  }

  const skillLines = activeSkills.map((skill) => `- ${skill}`);
  return ['## Available Skills', ...skillLines].join('\n');
}

/**
 * Build the general instructions section.
 * These instructions apply regardless of security level or skills.
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

/**
 * Build the full system prompt for Lil Dude.
 * Assembles identity, security rules, active skills, and general instructions
 * into a single prompt string ready for inclusion in an LLM context.
 *
 * @param userName - The name of the user Lil Dude is assisting.
 * @param securityLevel - The security level (1-5) controlling approval requirements.
 * @param activeSkills - Array of skill names currently available to the assistant.
 * @returns The fully assembled system prompt string.
 */
export function buildSystemPrompt(
  userName: string,
  securityLevel: number,
  activeSkills: string[],
): string {
  const sections = [
    buildIdentitySection(userName),
    '',
    buildSecuritySection(securityLevel),
    '',
    buildSkillsSection(activeSkills),
    '',
    buildInstructionsSection(),
  ];

  return sections.join('\n');
}
