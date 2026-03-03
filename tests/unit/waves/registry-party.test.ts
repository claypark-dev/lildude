import { describe, it, expect, beforeEach } from 'vitest';
import type { Wave, WaveManifest, WavePlan, ToolResult, WaveCategory } from '../../../src/types/index.js';
import {
  registerWave,
  matchPartyWave,
  matchWave,
  clearRegistry,
} from '../../../src/waves/registry.js';

/**
 * Create a test wave with the specified name, triggers, and category.
 * Defaults to 'personal' category to match the production default.
 */
function makeWave(
  name: string,
  triggers: string[],
  category: WaveCategory = 'personal',
): Wave {
  return {
    manifest: {
      name,
      version: '1.0.0',
      description: `Test wave ${name}`,
      author: 'test',
      permissions: {
        domains: [],
        shell: [],
        directories: [],
        requiresBrowser: false,
        requiresOAuth: [],
      },
      triggers,
      deterministic: true,
      tools: [],
      minTier: 'basic' as const,
      entryPoint: 'index.js',
      safetyTier: 'observe' as const,
      waveCategory: category,
    },
    plan: async (_userInput: string, _context: Record<string, unknown>): Promise<WavePlan> => ({
      steps: [],
      estimatedCostUsd: 0,
      isDeterministic: true,
      extractedParams: {},
    }),
    execute: async (_plan: WavePlan): Promise<ToolResult> => ({
      success: true,
      output: 'test',
      metadata: {},
    }),
  };
}

describe('matchPartyWave', () => {
  beforeEach(() => {
    clearRegistry();
  });

  // ─── Empty / No Party Waves ─────────────────────────────────────────────

  it('returns null when no waves are registered at all', () => {
    const result = matchPartyWave('schedule a meeting');
    expect(result).toBeNull();
  });

  it('returns null when only personal waves are registered (even if triggers match)', () => {
    registerWave('personal-scheduler', makeWave('personal-scheduler', ['schedule', 'meeting'], 'personal'));

    const result = matchPartyWave('schedule a meeting');
    expect(result).toBeNull();
  });

  it('returns null when party waves are registered but no triggers match', () => {
    registerWave('party-greet', makeWave('party-greet', ['hello', 'greet'], 'party'));

    const result = matchPartyWave('schedule a meeting');
    expect(result).toBeNull();
  });

  // ─── Basic Matching ─────────────────────────────────────────────────────

  it('matches a party wave by trigger keyword', () => {
    registerWave('party-scheduler', makeWave('party-scheduler', ['schedule', 'meeting'], 'party'));

    const result = matchPartyWave('I want to schedule a meeting');
    expect(result).not.toBeNull();
    expect(result!.wave.manifest.name).toBe('party-scheduler');
    expect(result!.score).toBeGreaterThan(0);
  });

  it('matches a party wave with a single-word trigger', () => {
    registerWave('party-availability', makeWave('party-availability', ['available'], 'party'));

    const result = matchPartyWave('are you available tomorrow?');
    expect(result).not.toBeNull();
    expect(result!.wave.manifest.name).toBe('party-availability');
  });

  it('matches a party wave with multi-word trigger', () => {
    registerWave('party-contact', makeWave('party-contact', ['share contact'], 'party'));

    const result = matchPartyWave('can you share contact info?');
    expect(result).not.toBeNull();
    expect(result!.wave.manifest.name).toBe('party-contact');
  });

  // ─── Scoring / Best Match ──────────────────────────────────────────────

  it('returns best-scoring party wave when multiple party waves match', () => {
    registerWave('party-basic', makeWave('party-basic', ['meeting'], 'party'));
    registerWave('party-advanced', makeWave('party-advanced', ['meeting', 'schedule', 'book'], 'party'));

    // "schedule a meeting and book it" matches more triggers on party-advanced
    const result = matchPartyWave('schedule a meeting and book it');
    expect(result).not.toBeNull();
    expect(result!.wave.manifest.name).toBe('party-advanced');
  });

  it('does NOT match personal waves even if they have better trigger scores', () => {
    // Personal wave with many triggers that should score higher
    registerWave('personal-super', makeWave(
      'personal-super',
      ['meeting', 'schedule', 'book', 'appointment', 'calendar'],
      'personal',
    ));
    // Party wave with fewer triggers
    registerWave('party-basic', makeWave('party-basic', ['meeting'], 'party'));

    const result = matchPartyWave('schedule a meeting, book an appointment on my calendar');
    expect(result).not.toBeNull();
    // Should match the party wave, NOT the personal one (even though personal scores higher)
    expect(result!.wave.manifest.name).toBe('party-basic');
  });

  it('prefers the party wave with higher coverage ratio', () => {
    // "relay" covers more of the short message "relay this" than "message" does
    registerWave('party-relay', makeWave('party-relay', ['relay'], 'party'));
    registerWave('party-message', makeWave('party-message', ['message'], 'party'));

    const result = matchPartyWave('relay this');
    expect(result).not.toBeNull();
    // "relay" is 5 chars out of 10 chars (0.5 coverage + 0.1 count bonus = 0.6)
    // "message" is 7 chars — doesn't appear in "relay this"
    expect(result!.wave.manifest.name).toBe('party-relay');
  });

  // ─── Case Insensitive ──────────────────────────────────────────────────

  it('performs case-insensitive matching on message', () => {
    registerWave('party-greet', makeWave('party-greet', ['hello'], 'party'));

    const result = matchPartyWave('HELLO there!');
    expect(result).not.toBeNull();
    expect(result!.wave.manifest.name).toBe('party-greet');
  });

  it('performs case-insensitive matching on triggers', () => {
    registerWave('party-greet', makeWave('party-greet', ['HELLO', 'Hi'], 'party'));

    const result = matchPartyWave('hello world');
    expect(result).not.toBeNull();
    expect(result!.wave.manifest.name).toBe('party-greet');
  });

  it('matches when both trigger and message use mixed case', () => {
    registerWave('party-avail', makeWave('party-avail', ['Available'], 'party'));

    const result = matchPartyWave('Are You AVAILABLE?');
    expect(result).not.toBeNull();
    expect(result!.wave.manifest.name).toBe('party-avail');
  });

  // ─── clearRegistry ─────────────────────────────────────────────────────

  it('clears party waves along with all other waves', () => {
    registerWave('party-greet', makeWave('party-greet', ['hello'], 'party'));
    registerWave('personal-todo', makeWave('personal-todo', ['todo'], 'personal'));

    // Both should be findable before clear
    expect(matchPartyWave('hello')).not.toBeNull();
    expect(matchWave('todo')).not.toBeNull();

    clearRegistry();

    expect(matchPartyWave('hello')).toBeNull();
    expect(matchWave('todo')).toBeNull();
  });

  it('returns null after clearing registry even for previously matching party waves', () => {
    registerWave('party-scheduler', makeWave('party-scheduler', ['schedule'], 'party'));
    expect(matchPartyWave('schedule something')).not.toBeNull();

    clearRegistry();

    expect(matchPartyWave('schedule something')).toBeNull();
  });

  // ─── Edge Cases ────────────────────────────────────────────────────────

  it('does not match a wave without waveCategory set (defaults to undefined)', () => {
    const wave = makeWave('no-category', ['hello'], 'personal');
    // Manually remove waveCategory to simulate an older wave manifest
    wave.manifest.waveCategory = undefined;
    registerWave('no-category', wave);

    const result = matchPartyWave('hello');
    expect(result).toBeNull();
  });

  it('matchWave still finds party waves (matchPartyWave is a subset filter)', () => {
    registerWave('party-greet', makeWave('party-greet', ['hello'], 'party'));

    // matchWave searches ALL waves (including party)
    const generalMatch = matchWave('hello');
    expect(generalMatch).not.toBeNull();
    expect(generalMatch!.wave.manifest.name).toBe('party-greet');

    // matchPartyWave also finds it
    const partyMatch = matchPartyWave('hello');
    expect(partyMatch).not.toBeNull();
    expect(partyMatch!.wave.manifest.name).toBe('party-greet');
  });
});
