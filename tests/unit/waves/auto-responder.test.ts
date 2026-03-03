import { describe, it, expect } from 'vitest';
import { plan, execute, validate } from '../../../waves/bundled/auto-responder/index.js';

describe('auto-responder wave', () => {
  describe('plan', () => {
    it('returns deterministic plan', async () => {
      const result = await plan('Are you there?', {});

      expect(result.isDeterministic).toBe(true);
      expect(result.estimatedCostUsd).toBe(0);
      expect(result.steps).toHaveLength(1);
    });
  });

  describe('execute', () => {
    it('returns available status', async () => {
      const wavePlan = {
        extractedParams: {
          _ownerName: 'Alice',
          _statusConfig: {
            enabled: true,
            status: 'available',
            customMessage: null,
            returnDate: null,
            alternateContact: null,
          },
        },
      };

      const result = await execute(wavePlan);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Alice');
      expect(result.output).toContain('Available');
      expect(result.output).toContain('leave a message or request a meeting');
      expect(result.metadata.status).toBe('available');
    });

    it('returns busy status with suggestion', async () => {
      const wavePlan = {
        extractedParams: {
          _ownerName: 'Bob',
          _statusConfig: {
            enabled: true,
            status: 'busy',
            customMessage: 'In meetings until 3pm.',
            returnDate: null,
            alternateContact: null,
          },
        },
      };

      const result = await execute(wavePlan);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Busy');
      expect(result.output).toContain('In meetings until 3pm');
      expect(result.output).toContain('leave a message');
    });

    it('returns away status with return date', async () => {
      const wavePlan = {
        extractedParams: {
          _ownerName: 'Carol',
          _statusConfig: {
            enabled: true,
            status: 'away',
            customMessage: 'Out of the office.',
            returnDate: 'Monday, March 10',
            alternateContact: null,
          },
        },
      };

      const result = await execute(wavePlan);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Away');
      expect(result.output).toContain('Monday, March 10');
      expect(result.output).toContain('respond when they return');
    });

    it('returns vacation status with alternate contact', async () => {
      const wavePlan = {
        extractedParams: {
          _ownerName: 'Dave',
          _statusConfig: {
            enabled: true,
            status: 'vacation',
            customMessage: 'On holiday!',
            returnDate: 'April 1',
            alternateContact: 'jane@example.com',
          },
        },
      };

      const result = await execute(wavePlan);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Vacation');
      expect(result.output).toContain('On holiday!');
      expect(result.output).toContain('April 1');
      expect(result.output).toContain('jane@example.com');
    });

    it('returns dnd status', async () => {
      const wavePlan = {
        extractedParams: {
          _ownerName: 'Eve',
          _statusConfig: {
            enabled: true,
            status: 'dnd',
            customMessage: 'Deep work session.',
            returnDate: null,
            alternateContact: null,
          },
        },
      };

      const result = await execute(wavePlan);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Do Not Disturb');
      expect(result.output).toContain('Deep work session');
    });

    it('returns offline status', async () => {
      const wavePlan = {
        extractedParams: {
          _ownerName: 'Frank',
          _statusConfig: {
            enabled: true,
            status: 'offline',
            customMessage: null,
            returnDate: null,
            alternateContact: null,
          },
        },
      };

      const result = await execute(wavePlan);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Offline');
      expect(result.output).toContain('respond when they return');
    });

    it('returns disabled message when auto-responder is off', async () => {
      const wavePlan = {
        extractedParams: {
          _ownerName: 'Grace',
          _statusConfig: {
            enabled: false,
            status: 'available',
            customMessage: null,
            returnDate: null,
            alternateContact: null,
          },
        },
      };

      const result = await execute(wavePlan);

      expect(result.success).toBe(true);
      expect(result.output).toContain('not currently active');
      expect(result.metadata.status).toBe('disabled');
    });

    it('uses defaults when no config provided', async () => {
      const wavePlan = {
        extractedParams: {
          query: 'Are you around?',
        },
      };

      const result = await execute(wavePlan);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Available');
    });
  });

  describe('validate', () => {
    it('returns valid for successful result', async () => {
      const result = await validate({ success: true, output: 'Status' });
      expect(result.valid).toBe(true);
    });

    it('returns invalid for failed result', async () => {
      const result = await validate({ success: false, error: 'Config error' });
      expect(result.valid).toBe(false);
    });
  });
});
