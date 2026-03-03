import { describe, it, expect } from 'vitest';
import { plan, execute, validate } from '../../../waves/bundled/message-relay/index.js';

describe('message-relay wave', () => {
  describe('plan', () => {
    it('returns deterministic plan', async () => {
      const result = await plan('Tell them I will be late', {});

      expect(result.isDeterministic).toBe(true);
      expect(result.estimatedCostUsd).toBe(0);
      expect(result.steps).toHaveLength(1);
    });

    it('detects urgent urgency', async () => {
      const result = await plan('This is urgent: the server is down', {});
      expect(result.extractedParams.urgency).toBe('urgent');
    });

    it('detects high urgency', async () => {
      const result = await plan('Important: please review the contract', {});
      expect(result.extractedParams.urgency).toBe('high');
    });

    it('detects low urgency', async () => {
      const result = await plan('No rush, just wanted to say hi', {});
      expect(result.extractedParams.urgency).toBe('low');
    });

    it('defaults to normal urgency', async () => {
      const result = await plan('Please pass along my thanks', {});
      expect(result.extractedParams.urgency).toBe('normal');
    });

    it('strips "tell them" prefix from message', async () => {
      const result = await plan('Tell them that I will be late', {});
      expect(result.extractedParams.message).toBe('I will be late');
    });

    it('strips "let them know" prefix', async () => {
      const result = await plan('Let them know the meeting is moved', {});
      expect(result.extractedParams.message).toBe('the meeting is moved');
    });

    it('strips "pass along" prefix', async () => {
      const result = await plan('Pass along that the report is ready', {});
      expect(result.extractedParams.message).toBe('the report is ready');
    });

    it('strips "leave a message" prefix', async () => {
      const result = await plan('Leave a message: Call me back', {});
      expect(result.extractedParams.message).toBe('Call me back');
    });

    it('strips "relay" prefix', async () => {
      const result = await plan('Relay that I accept the offer', {});
      expect(result.extractedParams.message).toBe('I accept the offer');
    });

    it('truncates very long messages', async () => {
      const longMessage = 'A'.repeat(3000);
      const result = await plan(longMessage, {});
      expect(result.extractedParams.message.length).toBeLessThanOrEqual(2000);
    });
  });

  describe('execute', () => {
    it('relays a normal message', async () => {
      const wavePlan = {
        extractedParams: {
          message: 'The proposal is ready for review.',
          urgency: 'normal',
        },
      };

      const result = await execute(wavePlan);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Message delivered');
      expect(result.output).not.toContain('URGENT');
      expect(result.metadata.waveId).toBe('message-relay');
      expect(result.metadata.messageId).toMatch(/^msg_/);
      expect(result.metadata.urgency).toBe('normal');
    });

    it('marks urgent messages appropriately', async () => {
      const wavePlan = {
        extractedParams: {
          message: 'Server is down!',
          urgency: 'urgent',
        },
      };

      const result = await execute(wavePlan);

      expect(result.success).toBe(true);
      expect(result.output).toContain('URGENT');
      expect(result.output).toContain('notified immediately');
    });

    it('marks high priority messages', async () => {
      const wavePlan = {
        extractedParams: {
          message: 'Please review the contract.',
          urgency: 'high',
        },
      };

      const result = await execute(wavePlan);

      expect(result.success).toBe(true);
      expect(result.output).toContain('High Priority');
    });

    it('rejects empty messages', async () => {
      const wavePlan = {
        extractedParams: {
          message: '',
          urgency: 'normal',
        },
      };

      const result = await execute(wavePlan);

      expect(result.success).toBe(false);
      expect(result.error).toContain('cannot be empty');
    });

    it('rejects whitespace-only messages', async () => {
      const wavePlan = {
        extractedParams: {
          message: '   ',
          urgency: 'normal',
        },
      };

      const result = await execute(wavePlan);

      expect(result.success).toBe(false);
      expect(result.error).toContain('cannot be empty');
    });

    it('normalizes invalid urgency to normal', async () => {
      const wavePlan = {
        extractedParams: {
          message: 'Hello there',
          urgency: 'super-critical',
        },
      };

      const result = await execute(wavePlan);

      expect(result.success).toBe(true);
      expect(result.metadata.urgency).toBe('normal');
    });
  });

  describe('validate', () => {
    it('returns valid for successful result with messageId', async () => {
      const result = await validate({
        success: true,
        output: 'Delivered',
        metadata: { messageId: 'msg_123' },
      });
      expect(result.valid).toBe(true);
    });

    it('returns invalid for failed result', async () => {
      const result = await validate({ success: false, error: 'Delivery failed' });
      expect(result.valid).toBe(false);
    });

    it('returns invalid when no messageId', async () => {
      const result = await validate({ success: true, output: 'OK', metadata: {} });
      expect(result.valid).toBe(false);
      expect(result.feedback).toContain('No message ID');
    });
  });
});
