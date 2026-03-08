/**
 * Wave index.js code generator.
 * Generates plan/execute/validate functions for converted ClawHub skills.
 */

import type { ClawHubSkill } from './parser.js';
import type { WaveManifestOutput } from './mapper.js';

/**
 * Generate the index.js source code for a converted wave.
 *
 * @param skill - The parsed ClawHub skill data.
 * @param manifest - The generated wave manifest.
 * @returns The JavaScript source code for index.js.
 */
export function generateIndexJs(
  skill: ClawHubSkill,
  manifest: WaveManifestOutput,
): string {
  const bins = skill.metadata.openclaw?.requires?.bins ?? [];
  const envVars = skill.metadata.openclaw?.requires?.env ?? [];

  if (bins.length > 0) {
    return generateShellWave(skill, manifest, bins);
  }

  if (envVars.length > 0) {
    return generateApiWave(skill, manifest, envVars);
  }

  return generateBasicWave(skill, manifest);
}

/**
 * Generate a basic wave (no external dependencies).
 */
function generateBasicWave(
  skill: ClawHubSkill,
  manifest: WaveManifestOutput,
): string {
  const toolName = manifest.tools[0].name;
  const escapedInstructions = escapeTemplateString(skill.body);

  return `/**
 * ${manifest.description}
 * Converted from ClawHub skill: ${skill.name}
 */

const INSTRUCTIONS = \`${escapedInstructions}\`;

/**
 * Plan the execution based on user input.
 * @param {string} userInput - The user's natural language request.
 * @param {Record<string, unknown>} context - Execution context.
 * @returns {Promise<import('../../src/types/index.js').WavePlan>}
 */
export async function plan(userInput, context) {
  return {
    steps: [
      {
        tool: '${toolName}',
        params: { input: userInput },
        description: '${escapeSingleQuotes(manifest.description)}',
      },
    ],
    estimatedCostUsd: 0,
    isDeterministic: ${manifest.deterministic},
    extractedParams: { input: userInput, instructions: INSTRUCTIONS },
  };
}

/**
 * Execute the planned steps.
 * @param {import('../../src/types/index.js').WavePlan} wavePlan
 * @returns {Promise<import('../../src/types/index.js').ToolResult>}
 */
export async function execute(wavePlan) {
  const { input } = wavePlan.extractedParams;

  try {
    return {
      success: true,
      output: \`Skill "${skill.name}" processed input: \${input}\\n\\nInstructions available for LLM context.\`,
      metadata: { skill: '${skill.name}', instructions: INSTRUCTIONS },
    };
  } catch (error) {
    return {
      success: false,
      output: '',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Validate the execution result.
 * @param {import('../../src/types/index.js').ToolResult} result
 * @returns {Promise<{ valid: boolean; feedback?: string }>}
 */
export async function validate(result) {
  return { valid: result.success };
}
`;
}

/**
 * Generate an API-based wave (env vars, no shell).
 */
function generateApiWave(
  skill: ClawHubSkill,
  manifest: WaveManifestOutput,
  envVars: string[],
): string {
  const toolName = manifest.tools[0].name;
  const escapedInstructions = escapeTemplateString(skill.body);
  const envChecks = envVars
    .map((v) => `  if (!process.env.${v}) throw new Error('Missing env: ${v}');`)
    .join('\n');
  const domain = manifest.permissions.domains[0] ?? 'api.example.com';

  return `/**
 * ${manifest.description}
 * Converted from ClawHub skill: ${skill.name}
 *
 * Required env vars: ${envVars.join(', ')}
 */

const INSTRUCTIONS = \`${escapedInstructions}\`;

/**
 * Plan the execution based on user input.
 * @param {string} userInput - The user's natural language request.
 * @param {Record<string, unknown>} context - Execution context.
 * @returns {Promise<import('../../src/types/index.js').WavePlan>}
 */
export async function plan(userInput, context) {
  return {
    steps: [
      {
        tool: '${toolName}',
        params: { input: userInput },
        description: '${escapeSingleQuotes(manifest.description)}',
      },
    ],
    estimatedCostUsd: 0,
    isDeterministic: ${manifest.deterministic},
    extractedParams: { input: userInput, instructions: INSTRUCTIONS },
  };
}

/**
 * Execute the planned steps.
 * @param {import('../../src/types/index.js').WavePlan} wavePlan
 * @returns {Promise<import('../../src/types/index.js').ToolResult>}
 */
export async function execute(wavePlan) {
  const { input } = wavePlan.extractedParams;

  try {
    // Validate required environment variables
${envChecks}

    const response = await fetch('https://${domain}/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': \`Bearer \${process.env.${envVars[0]}}\`,
      },
      body: JSON.stringify({ query: input }),
    });

    if (!response.ok) {
      throw new Error(\`API error: \${response.status} \${response.statusText}\`);
    }

    const data = await response.json();

    return {
      success: true,
      output: JSON.stringify(data, null, 2),
      metadata: { skill: '${skill.name}', domain: '${domain}' },
    };
  } catch (error) {
    return {
      success: false,
      output: '',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Validate the execution result.
 * @param {import('../../src/types/index.js').ToolResult} result
 * @returns {Promise<{ valid: boolean; feedback?: string }>}
 */
export async function validate(result) {
  if (!result.success) {
    return { valid: false, feedback: result.error };
  }
  if (!result.output || result.output.length === 0) {
    return { valid: false, feedback: 'Empty response from API' };
  }
  return { valid: true };
}
`;
}

/**
 * Generate a shell-based wave (requires bins).
 */
function generateShellWave(
  skill: ClawHubSkill,
  manifest: WaveManifestOutput,
  bins: string[],
): string {
  const toolName = manifest.tools[0].name;
  const escapedInstructions = escapeTemplateString(skill.body);
  const allowedBins = JSON.stringify(bins);

  return `/**
 * ${manifest.description}
 * Converted from ClawHub skill: ${skill.name}
 *
 * Required binaries: ${bins.join(', ')}
 * Safety tier: ${manifest.safetyTier}
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const INSTRUCTIONS = \`${escapedInstructions}\`;
const ALLOWED_BINS = ${allowedBins};

/**
 * Plan the execution based on user input.
 * @param {string} userInput - The user's natural language request.
 * @param {Record<string, unknown>} context - Execution context.
 * @returns {Promise<import('../../src/types/index.js').WavePlan>}
 */
export async function plan(userInput, context) {
  return {
    steps: [
      {
        tool: '${toolName}',
        params: { input: userInput },
        description: '${escapeSingleQuotes(manifest.description)}',
      },
    ],
    estimatedCostUsd: 0,
    isDeterministic: false,
    extractedParams: {
      input: userInput,
      instructions: INSTRUCTIONS,
    },
  };
}

/**
 * Execute the planned steps using sandboxed shell commands.
 * @param {import('../../src/types/index.js').WavePlan} wavePlan
 * @returns {Promise<import('../../src/types/index.js').ToolResult>}
 */
export async function execute(wavePlan) {
  const { input, args } = wavePlan.extractedParams;

  try {
    // Validate that only allowed binaries are used
    const bin = ALLOWED_BINS[0];
    if (!bin) {
      throw new Error('No allowed binary configured for this skill');
    }

    const cmdArgs = args ? args.split(/\\s+/) : [input];

    const { stdout, stderr } = await execFileAsync(bin, cmdArgs, {
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    });

    return {
      success: true,
      output: stdout || stderr || 'Command completed with no output',
      metadata: { skill: '${skill.name}', bin, args: cmdArgs },
    };
  } catch (error) {
    return {
      success: false,
      output: '',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Validate the execution result.
 * @param {import('../../src/types/index.js').ToolResult} result
 * @returns {Promise<{ valid: boolean; feedback?: string }>}
 */
export async function validate(result) {
  if (!result.success) {
    return { valid: false, feedback: result.error };
  }
  return { valid: true };
}
`;
}

/**
 * Escape backticks and dollar signs in template string content.
 */
function escapeTemplateString(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
}

/**
 * Escape single quotes in a string for use in single-quoted JS strings.
 */
function escapeSingleQuotes(str: string): string {
  return str.replace(/'/g, "\\'");
}
