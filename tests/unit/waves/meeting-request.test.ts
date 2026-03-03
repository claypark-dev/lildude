import { describe, it, expect } from 'vitest';
import { plan, execute, validate } from '../../../waves/bundled/meeting-request/index.js';

describe('meeting-request wave', () => {
  describe('plan', () => {
    it('returns deterministic plan', async () => {
      const result = await plan('Can we meet tomorrow at 2pm about the project?', {});

      expect(result.isDeterministic).toBe(true);
      expect(result.estimatedCostUsd).toBe(0);
      expect(result.extractedParams.subject).toBe('the project?');
      expect(result.steps).toHaveLength(1);
    });

    it('extracts duration from input', async () => {
      const result = await plan('I need a 45 minute meeting', {});
      expect(result.extractedParams.duration).toBe(45);
    });

    it('extracts hour-based duration', async () => {
      const result = await plan('Schedule a 2 hour call', {});
      expect(result.extractedParams.duration).toBe(120);
    });

    it('defaults to 30 min duration', async () => {
      const result = await plan('Can we meet?', {});
      expect(result.extractedParams.duration).toBe(30);
    });

    it('extracts subject from "about" clause', async () => {
      const result = await plan('Meet about quarterly planning', {});
      expect(result.extractedParams.subject).toBe('quarterly planning');
    });

    it('extracts subject from "regarding" clause', async () => {
      const result = await plan('Call regarding the budget', {});
      expect(result.extractedParams.subject).toBe('the budget');
    });

    it('extracts subject from "to discuss" clause', async () => {
      const result = await plan('Meeting to discuss hiring', {});
      expect(result.extractedParams.subject).toBe('hiring');
    });

    it('truncates long messages', async () => {
      const longInput = 'Can we meet? '.repeat(100);
      const result = await plan(longInput, {});
      expect(result.extractedParams.message.length).toBeLessThanOrEqual(500);
    });
  });

  describe('execute', () => {
    it('creates a meeting request successfully', async () => {
      const wavePlan = {
        extractedParams: {
          proposedTime: 'Tuesday at 2pm',
          duration: 30,
          subject: 'Project Review',
          message: 'I would like to discuss the project status.',
        },
      };

      const result = await execute(wavePlan);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Meeting request submitted');
      expect(result.output).toContain('Project Review');
      expect(result.output).toContain('30 minutes');
      expect(result.output).toContain('Tuesday at 2pm');
      expect(result.metadata.waveId).toBe('meeting-request');
      expect(result.metadata.requestId).toMatch(/^mtg_/);
      expect(result.metadata.approvalRequired).toBe(true);
    });

    it('handles missing proposed time', async () => {
      const wavePlan = {
        extractedParams: {
          proposedTime: null,
          duration: 60,
          subject: 'Quick Chat',
          message: '',
        },
      };

      const result = await execute(wavePlan);

      expect(result.success).toBe(true);
      expect(result.output).toContain('No specific time proposed');
    });

    it('rejects very short duration', async () => {
      const wavePlan = {
        extractedParams: {
          proposedTime: 'Tomorrow',
          duration: 2,
          subject: 'Chat',
          message: '',
        },
      };

      const result = await execute(wavePlan);

      expect(result.success).toBe(false);
      expect(result.error).toContain('at least 5 minutes');
    });

    it('rejects very long duration', async () => {
      const wavePlan = {
        extractedParams: {
          proposedTime: 'Tomorrow',
          duration: 600,
          subject: 'Marathon',
          message: '',
        },
      };

      const result = await execute(wavePlan);

      expect(result.success).toBe(false);
      expect(result.error).toContain('exceed 8 hours');
    });

    it('rejects empty subject', async () => {
      const wavePlan = {
        extractedParams: {
          proposedTime: 'Tomorrow',
          duration: 30,
          subject: '',
          message: '',
        },
      };

      const result = await execute(wavePlan);

      expect(result.success).toBe(false);
      expect(result.error).toContain('subject is required');
    });
  });

  describe('validate', () => {
    it('returns valid for successful result with requestId', async () => {
      const result = await validate({
        success: true,
        output: 'OK',
        metadata: { requestId: 'mtg_123' },
      });
      expect(result.valid).toBe(true);
    });

    it('returns invalid for failed result', async () => {
      const result = await validate({ success: false, error: 'Bad request' });
      expect(result.valid).toBe(false);
    });

    it('returns invalid when no requestId', async () => {
      const result = await validate({ success: true, output: 'OK', metadata: {} });
      expect(result.valid).toBe(false);
      expect(result.feedback).toContain('No request ID');
    });
  });
});
