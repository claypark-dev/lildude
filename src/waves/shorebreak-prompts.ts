/**
 * Shorebreak builder prompts — S2.N.4
 *
 * LLM prompts used by the Shorebreak system to:
 *   1. Detect capability gaps (user wants something we can't do)
 *   2. Generate wave code from templates (compose safe building blocks)
 *   3. Generate wave code free-form (when no template matches)
 *   4. Generate wave manifests for the approval flow
 */

import type { ShorebreakTemplate } from './shorebreak-templates/index.js';
import { antiThinkingInstruction } from '../utils/think-strip.js';

/**
 * Build the system prompt for gap detection.
 * Given the agent's response, determines if it indicates an inability
 * to fulfill the user's request.
 *
 * @returns The system prompt for gap detection.
 */
export function buildGapDetectionPrompt(): string {
  return [
    'You are a capability gap detector for an AI executive assistant.',
    'Analyze the assistant\'s response to determine if it indicates the assistant CANNOT fulfill the user\'s request.',
    '',
    'Respond with ONLY a JSON object:',
    '{',
    '  "isGap": true/false,',
    '  "reason": "brief explanation of what capability is missing",',
    '  "suggestedWaveName": "a-short-kebab-case-name for the capability",',
    '  "suggestedDescription": "one-sentence description of what the wave would do",',
    '  "requiredDomains": ["list", "of", "api", "domains"],',
    '  "suggestedSafetyTier": "observe|create|modify|destroy|execute"',
    '}',
    '',
    'Set isGap to true ONLY if the assistant explicitly cannot do what was asked.',
    'Phrases like "I can\'t", "I don\'t have access", "no tool available" indicate a gap.',
    'If the assistant successfully answered, set isGap to false.',
    '',
    antiThinkingInstruction(),
  ].join('\n');
}

/**
 * Build the prompt for template-based wave generation.
 * Uses the template's builder prompt and code skeleton to guide the LLM.
 *
 * @param template - The matched Shorebreak template.
 * @param userRequest - What the user wants the wave to do.
 * @param extractedParams - Parameters extracted from the user message.
 * @returns The full prompt for the LLM to generate wave code.
 */
export function buildTemplateCompositionPrompt(
  template: ShorebreakTemplate,
  userRequest: string,
  extractedParams: Record<string, unknown>,
): string {
  return [
    template.builderPrompt,
    '',
    `User request: "${userRequest}"`,
    `Extracted parameters: ${JSON.stringify(extractedParams)}`,
    '',
    'CODE SKELETON (fill in the {{PLACEHOLDERS}}):',
    '```javascript',
    template.codeSkeleton,
    '```',
    '',
    'Return ONLY the completed JavaScript code with all placeholders replaced.',
    'Do NOT include markdown fences, explanations, or anything other than the code.',
    'The code must define a `var execute = async function(params) { ... }` that returns a string.',
  ].join('\n');
}

/**
 * Build the prompt for free-form wave generation.
 * Used when no template matches the user's request.
 *
 * @param userRequest - What the user wants the wave to do.
 * @param suggestedName - Suggested wave name from gap detection.
 * @param suggestedDescription - Suggested description from gap detection.
 * @param requiredDomains - Domains the wave may need to contact.
 * @returns The full prompt for the LLM to generate wave code.
 */
export function buildFreeFormGenerationPrompt(
  userRequest: string,
  suggestedName: string,
  suggestedDescription: string,
  requiredDomains: string[],
): string {
  return [
    'You are a code generator for an AI executive assistant wave system.',
    'Generate JavaScript code that implements the requested capability.',
    '',
    'STRICT SAFETY RULES — your code will be security-scanned and REJECTED if it violates these:',
    '- Do NOT use require(), import(), eval(), new Function(), or process.*',
    '- Do NOT use child_process, fs, net, http, https, vm, or any Node.js modules',
    '- Do NOT access __proto__, constructor.prototype, or globalThis',
    '- Only use fetch() for network requests (it enforces domain checks)',
    '- Only use JSON, Date, Math, String, Number, Array, Object, Map, Set, RegExp',
    '- Only use console.log for debug output (it is captured, not printed)',
    '',
    'CODE FORMAT:',
    '- Define: var execute = async function(params) { ... return result; }',
    '- The function receives an object with extracted user parameters',
    '- The function must return a string (the wave output shown to the user)',
    '- Use try/catch for error handling',
    '- Keep the code simple and focused on the task',
    '',
    `Wave name: ${suggestedName}`,
    `Description: ${suggestedDescription}`,
    `User request: "${userRequest}"`,
    requiredDomains.length > 0
      ? `Allowed domains: ${requiredDomains.join(', ')}`
      : 'No external domains needed.',
    '',
    'Return ONLY the JavaScript code. No markdown, no explanations.',
  ].join('\n');
}

/**
 * Build the prompt for generating a wave manifest.
 *
 * @param waveName - The wave name.
 * @param description - What the wave does.
 * @param safetyTier - The safety tier for the wave.
 * @param domains - Domains the wave needs to contact.
 * @param triggers - Trigger keywords for the wave.
 * @returns The prompt for generating a wave.json manifest.
 */
export function buildManifestGenerationPrompt(
  waveName: string,
  description: string,
  safetyTier: string,
  domains: string[],
  triggers: string[],
): string {
  return [
    'Generate a wave.json manifest for the following wave.',
    'Return ONLY valid JSON, no explanations.',
    '',
    `{`,
    `  "name": "${waveName}",`,
    `  "version": "1.0.0",`,
    `  "description": "${description}",`,
    `  "author": "shorebreak-generated",`,
    `  "permissions": {`,
    `    "domains": ${JSON.stringify(domains)},`,
    `    "shell": [],`,
    `    "directories": [],`,
    `    "requiresBrowser": false,`,
    `    "requiresOAuth": []`,
    `  },`,
    `  "triggers": ${JSON.stringify(triggers)},`,
    `  "deterministic": true,`,
    `  "tools": [`,
    `    {`,
    `      "name": "execute",`,
    `      "description": "${description}",`,
    `      "parameters": {}`,
    `    }`,
    `  ],`,
    `  "minTier": "basic",`,
    `  "entryPoint": "index.js",`,
    `  "safetyTier": "${safetyTier}"`,
    `}`,
  ].join('\n');
}
