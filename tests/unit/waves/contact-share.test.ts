import { describe, it, expect } from 'vitest';
import { plan, execute, validate } from '../../../waves/bundled/contact-share/index.js';

describe('contact-share wave', () => {
  describe('plan', () => {
    it('returns deterministic plan', async () => {
      const result = await plan('How can I reach you?', {});

      expect(result.isDeterministic).toBe(true);
      expect(result.estimatedCostUsd).toBe(0);
      expect(result.steps).toHaveLength(1);
    });
  });

  describe('execute', () => {
    it('returns all configured shareable info', async () => {
      const wavePlan = {
        extractedParams: {
          _ownerName: 'Alice',
          _ownerConfig: {
            shareEmail: true,
            sharePhone: true,
            shareCalendarLink: true,
            shareLinkedIn: true,
            shareWebsite: true,
            customMessage: 'Best to email first!',
            email: 'alice@example.com',
            phone: '+1-555-1234',
            calendarLink: 'https://cal.com/alice',
            linkedIn: 'https://linkedin.com/in/alice',
            website: 'https://alice.dev',
          },
        },
      };

      const result = await execute(wavePlan);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Alice');
      expect(result.output).toContain('alice@example.com');
      expect(result.output).toContain('+1-555-1234');
      expect(result.output).toContain('cal.com/alice');
      expect(result.output).toContain('linkedin.com/in/alice');
      expect(result.output).toContain('alice.dev');
      expect(result.output).toContain('Best to email first!');
      expect(result.metadata.fieldsShared).toBe(5);
    });

    it('only shares opted-in fields', async () => {
      const wavePlan = {
        extractedParams: {
          _ownerName: 'Bob',
          _ownerConfig: {
            shareEmail: true,
            sharePhone: false,
            shareCalendarLink: false,
            shareLinkedIn: false,
            shareWebsite: false,
            customMessage: null,
            email: 'bob@example.com',
            phone: '+1-555-5678',
            calendarLink: null,
            linkedIn: null,
            website: null,
          },
        },
      };

      const result = await execute(wavePlan);

      expect(result.success).toBe(true);
      expect(result.output).toContain('bob@example.com');
      expect(result.output).not.toContain('+1-555-5678');
      expect(result.metadata.fieldsShared).toBe(1);
    });

    it('handles no shareable info configured', async () => {
      const wavePlan = {
        extractedParams: {
          _ownerName: 'Charlie',
          _ownerConfig: {
            shareEmail: false,
            sharePhone: false,
            shareCalendarLink: false,
            shareLinkedIn: false,
            shareWebsite: false,
            customMessage: null,
            email: null,
            phone: null,
            calendarLink: null,
            linkedIn: null,
            website: null,
          },
        },
      };

      const result = await execute(wavePlan);

      expect(result.success).toBe(true);
      expect(result.output).toContain("hasn't configured any contact information");
      expect(result.metadata.fieldsShared).toBe(0);
    });

    it('uses default config when none provided', async () => {
      const wavePlan = {
        extractedParams: {
          query: 'How to reach you?',
        },
      };

      const result = await execute(wavePlan);

      expect(result.success).toBe(true);
      expect(result.output).toContain("hasn't configured");
    });

    it('does not count custom message as a shared field', async () => {
      const wavePlan = {
        extractedParams: {
          _ownerName: 'Dana',
          _ownerConfig: {
            shareEmail: false,
            sharePhone: false,
            shareCalendarLink: false,
            shareLinkedIn: false,
            shareWebsite: false,
            customMessage: 'Contact me on Discord!',
            email: null,
            phone: null,
            calendarLink: null,
            linkedIn: null,
            website: null,
          },
        },
      };

      const result = await execute(wavePlan);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Contact me on Discord!');
      // Custom message is present but doesn't count as a "field"
      expect(result.metadata.fieldsShared).toBe(0);
    });
  });

  describe('validate', () => {
    it('returns valid for successful result', async () => {
      const result = await validate({ success: true, output: 'Info' });
      expect(result.valid).toBe(true);
    });

    it('returns invalid for failed result', async () => {
      const result = await validate({ success: false, error: 'No config' });
      expect(result.valid).toBe(false);
    });
  });
});
