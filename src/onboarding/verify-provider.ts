/**
 * API key verification for onboarding.
 * Makes lightweight test calls to each provider to validate keys.
 * Extracted from the wizard for testability (can be mocked in tests).
 */

import { ProviderError } from '../errors.js';
import { createModuleLogger } from '../utils/logger.js';

const log = createModuleLogger('onboarding');

/** Supported AI provider names for onboarding. */
export type OnboardingProvider = 'anthropic' | 'openai' | 'deepseek';

/** Result of an API key verification attempt. */
export interface VerifyResult {
  provider: OnboardingProvider;
  valid: boolean;
  error?: string;
}

/**
 * Verify an Anthropic API key by making a minimal messages call.
 *
 * @param apiKey - The Anthropic API key to verify
 * @returns A VerifyResult indicating whether the key is valid
 */
async function verifyAnthropicKey(apiKey: string): Promise<VerifyResult> {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    });

    if (response.ok) {
      return { provider: 'anthropic', valid: true };
    }

    const body = await response.json() as { error?: { message?: string } };
    const errorMessage = body?.error?.message ?? `HTTP ${response.status}`;

    if (response.status === 401) {
      return { provider: 'anthropic', valid: false, error: 'Invalid API key' };
    }

    return { provider: 'anthropic', valid: false, error: errorMessage };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { provider: 'anthropic', valid: false, error: `Connection failed: ${message}` };
  }
}

/**
 * Verify an OpenAI API key by making a minimal models list call.
 *
 * @param apiKey - The OpenAI API key to verify
 * @returns A VerifyResult indicating whether the key is valid
 */
async function verifyOpenAIKey(apiKey: string): Promise<VerifyResult> {
  try {
    const response = await fetch('https://api.openai.com/v1/models', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (response.ok) {
      return { provider: 'openai', valid: true };
    }

    if (response.status === 401) {
      return { provider: 'openai', valid: false, error: 'Invalid API key' };
    }

    return { provider: 'openai', valid: false, error: `HTTP ${response.status}` };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { provider: 'openai', valid: false, error: `Connection failed: ${message}` };
  }
}

/**
 * Verify a DeepSeek API key by making a minimal models list call.
 *
 * @param apiKey - The DeepSeek API key to verify
 * @param apiBase - The DeepSeek API base URL (defaults to https://api.deepseek.com)
 * @returns A VerifyResult indicating whether the key is valid
 */
async function verifyDeepSeekKey(
  apiKey: string,
  apiBase = 'https://api.deepseek.com',
): Promise<VerifyResult> {
  try {
    const response = await fetch(`${apiBase}/v1/models`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (response.ok) {
      return { provider: 'deepseek', valid: true };
    }

    if (response.status === 401) {
      return { provider: 'deepseek', valid: false, error: 'Invalid API key' };
    }

    return { provider: 'deepseek', valid: false, error: `HTTP ${response.status}` };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { provider: 'deepseek', valid: false, error: `Connection failed: ${message}` };
  }
}

/**
 * Verify an API key for a given provider.
 * Makes a lightweight test call to validate the key works.
 *
 * @param provider - The AI provider to verify against
 * @param apiKey - The API key to verify
 * @returns A VerifyResult indicating whether the key is valid
 * @throws {ProviderError} When the provider name is not recognized
 */
export async function verifyApiKey(
  provider: OnboardingProvider,
  apiKey: string,
): Promise<VerifyResult> {
  log.info({ provider }, 'Verifying API key');

  switch (provider) {
    case 'anthropic':
      return verifyAnthropicKey(apiKey);
    case 'openai':
      return verifyOpenAIKey(apiKey);
    case 'deepseek':
      return verifyDeepSeekKey(apiKey);
    default: {
      const exhaustiveCheck: never = provider;
      throw new ProviderError(
        `Unknown provider: ${String(exhaustiveCheck)}`,
        String(exhaustiveCheck),
        false,
      );
    }
  }
}
