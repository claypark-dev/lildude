import { describe, it, expect } from 'vitest';
import { plan, execute, validate } from '../../../waves/bundled/event-rsvp/index.js';

describe('event-rsvp wave', () => {
  describe('plan()', () => {
    it('extracts event name from "RSVP for the team lunch"', async () => {
      const result = await plan('RSVP for the team lunch', {});

      expect(result.isDeterministic).toBe(true);
      expect(result.estimatedCostUsd).toBe(0);
      expect(result.extractedParams.eventName).toBeTruthy();
    });

    it('defaults to attending status', async () => {
      const result = await plan('RSVP for the holiday party', {});

      expect(result.extractedParams.rsvpStatus).toBe('attending');
    });

    it('detects declined status from "can\'t attend"', async () => {
      const result = await plan("I can't attend the meeting", {});

      expect(result.extractedParams.rsvpStatus).toBe('declined');
    });

    it('detects declined status from "no"', async () => {
      const result = await plan("No, I won't be going to the event", {});

      expect(result.extractedParams.rsvpStatus).toBe('declined');
    });

    it('detects maybe status from "might come"', async () => {
      const result = await plan('I might come to the party', {});

      expect(result.extractedParams.rsvpStatus).toBe('maybe');
    });

    it('detects maybe status from "not sure"', async () => {
      const result = await plan("I'm not sure about the event", {});

      expect(result.extractedParams.rsvpStatus).toBe('maybe');
    });

    it('detects maybe status from "possibly"', async () => {
      const result = await plan('I can possibly attend the gala', {});

      expect(result.extractedParams.rsvpStatus).toBe('maybe');
    });

    it('includes user message in parsed result', async () => {
      const input = "I'll be there for the company retreat";
      const result = await plan(input, {});

      expect(result.extractedParams.message).toBe(input);
    });

    it('returns a single api_call step', async () => {
      const result = await plan('attend the event', {});

      expect(result.steps).toHaveLength(1);
      expect(result.steps[0].type).toBe('api_call');
    });

    it('extracts event name from "going to the conference"', async () => {
      const result = await plan('going to the annual conference', {});

      expect(result.extractedParams.eventName).toBeTruthy();
    });
  });

  describe('execute()', () => {
    it('returns success with rsvpId for attending', async () => {
      const wavePlan = {
        steps: [{ type: 'api_call', description: 'Submit RSVP', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: {
          eventName: 'Holiday Party',
          rsvpStatus: 'attending',
          message: 'I will be there',
        },
      };

      const result = await execute(wavePlan);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Attending');
      expect(result.output).toContain('Holiday Party');
      expect(result.output).toContain('owner has been notified');
      expect(result.metadata).toBeDefined();
      expect(result.metadata.rsvpId).toBeDefined();
      expect(result.metadata.rsvpId).toMatch(/^rsvp_\d+$/);
      expect(result.metadata.rsvpStatus).toBe('attending');
      expect(result.metadata.eventName).toBe('Holiday Party');
    });

    it('returns correct status label for declined', async () => {
      const wavePlan = {
        steps: [{ type: 'api_call', description: 'Submit RSVP', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: {
          eventName: 'Team Dinner',
          rsvpStatus: 'declined',
          message: '',
        },
      };

      const result = await execute(wavePlan);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Not attending');
      expect(result.output).toContain('Team Dinner');
      expect(result.metadata.rsvpStatus).toBe('declined');
    });

    it('returns correct status label for maybe', async () => {
      const wavePlan = {
        steps: [{ type: 'api_call', description: 'Submit RSVP', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: {
          eventName: 'Launch Event',
          rsvpStatus: 'maybe',
          message: 'I might come',
        },
      };

      const result = await execute(wavePlan);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Maybe');
      expect(result.output).toContain('Launch Event');
      expect(result.metadata.rsvpStatus).toBe('maybe');
    });

    it('returns error for empty event name', async () => {
      const wavePlan = {
        steps: [{ type: 'api_call', description: 'Submit RSVP', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: {
          eventName: '',
          rsvpStatus: 'attending',
          message: '',
        },
      };

      const result = await execute(wavePlan);

      expect(result.success).toBe(false);
      expect(result.error).toContain('event name');
    });

    it('returns error for invalid RSVP status', async () => {
      const wavePlan = {
        steps: [{ type: 'api_call', description: 'Submit RSVP', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: {
          eventName: 'Party',
          rsvpStatus: 'invalid_status',
          message: '',
        },
      };

      const result = await execute(wavePlan);

      expect(result.success).toBe(false);
      expect(result.error).toContain('RSVP status');
    });

    it('includes message in output when provided', async () => {
      const wavePlan = {
        steps: [{ type: 'api_call', description: 'Submit RSVP', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: {
          eventName: 'BBQ',
          rsvpStatus: 'attending',
          message: 'Looking forward to it!',
        },
      };

      const result = await execute(wavePlan);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Looking forward to it!');
    });

    it('truncates long messages in output', async () => {
      const longMessage = 'x'.repeat(200);
      const wavePlan = {
        steps: [{ type: 'api_call', description: 'Submit RSVP', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: {
          eventName: 'Conference',
          rsvpStatus: 'attending',
          message: longMessage,
        },
      };

      const result = await execute(wavePlan);

      expect(result.success).toBe(true);
      expect(result.output).toContain('...');
    });

    it('generates unique rsvpIds', async () => {
      const wavePlan = {
        steps: [{ type: 'api_call', description: 'Submit RSVP', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: {
          eventName: 'Event',
          rsvpStatus: 'attending',
          message: '',
        },
      };

      const result1 = await execute(wavePlan);
      await new Promise((resolve) => setTimeout(resolve, 5));
      const result2 = await execute(wavePlan);

      expect(result1.metadata.rsvpId).not.toBe(result2.metadata.rsvpId);
    });
  });

  describe('validate()', () => {
    it('returns valid when rsvpId exists in metadata', async () => {
      const result = await validate({
        success: true,
        output: 'RSVP submitted.',
        metadata: { rsvpId: 'rsvp_123', rsvpStatus: 'attending', eventName: 'Party' },
      });

      expect(result.valid).toBe(true);
    });

    it('returns invalid when rsvpId is missing', async () => {
      const result = await validate({
        success: true,
        output: 'Something happened.',
        metadata: {},
      });

      expect(result.valid).toBe(false);
      expect(result.feedback).toContain('RSVP ID');
    });

    it('returns invalid for failed result', async () => {
      const result = await validate({
        success: false,
        output: '',
        error: 'RSVP failed',
      });

      expect(result.valid).toBe(false);
    });

    it('returns invalid when no metadata at all', async () => {
      const result = await validate({
        success: true,
        output: 'Something.',
      });

      expect(result.valid).toBe(false);
    });
  });
});
