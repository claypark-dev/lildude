import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../../../src/orchestrator/system-prompt.js';

describe('buildSystemPrompt', () => {
  it('includes the user name in the identity section', () => {
    const prompt = buildSystemPrompt('Alice', 3, []);

    expect(prompt).toContain(
      'You are Lil Dude, a personal AI executive assistant for Alice.',
    );
  });

  it('includes correct security rules for level 1 (Tin Foil Hat)', () => {
    const prompt = buildSystemPrompt('Bob', 1, []);

    expect(prompt).toContain('Security Level: 1 (Tin Foil Hat)');
    expect(prompt).toContain(
      'You MUST ask for approval before ANY command execution, file access, or API call.',
    );
  });

  it('includes correct security rules for level 3 (Balanced)', () => {
    const prompt = buildSystemPrompt('Carol', 3, []);

    expect(prompt).toContain('Security Level: 3 (Balanced)');
    expect(prompt).toContain(
      'Execute safe operations autonomously. Ask approval for destructive or risky actions.',
    );
  });

  it('includes correct security rules for level 5 (YOLO)', () => {
    const prompt = buildSystemPrompt('Dave', 5, []);

    expect(prompt).toContain('Security Level: 5 (YOLO)');
    expect(prompt).toContain(
      'Execute all operations autonomously. No approval needed.',
    );
  });

  it('lists active skills when provided', () => {
    const prompt = buildSystemPrompt('Eve', 3, [
      'web-search',
      'calendar-manager',
      'file-organizer',
    ]);

    expect(prompt).toContain('## Available Skills');
    expect(prompt).toContain('- web-search');
    expect(prompt).toContain('- calendar-manager');
    expect(prompt).toContain('- file-organizer');
  });

  it('shows no skills message when activeSkills is empty', () => {
    const prompt = buildSystemPrompt('Frank', 3, []);

    expect(prompt).toContain('No skills currently active.');
  });

  it('includes general instructions section', () => {
    const prompt = buildSystemPrompt('Grace', 3, []);

    expect(prompt).toContain('## Instructions');
    expect(prompt).toContain('Be concise');
    expect(prompt).toContain('Track and minimize token costs');
    expect(prompt).toContain('Prefer deterministic execution');
  });

  it('clamps out-of-range security levels', () => {
    const promptLow = buildSystemPrompt('Hank', 0, []);
    expect(promptLow).toContain('Security Level: 1 (Tin Foil Hat)');

    const promptHigh = buildSystemPrompt('Hank', 99, []);
    expect(promptHigh).toContain('Security Level: 5 (YOLO)');
  });

  it('returns a string (pure function, no side effects)', () => {
    const prompt = buildSystemPrompt('Ivy', 2, ['test-skill']);

    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(0);
  });
});
