import { describe, it, expect } from 'vitest';
import { plan, execute, validate } from '../../../waves/bundled/document-request/index.js';

describe('document-request wave', () => {
  describe('plan()', () => {
    it('extracts document name from "send me the Q4 report"', async () => {
      const result = await plan('send me the Q4 report', {});

      expect(result.isDeterministic).toBe(true);
      expect(result.estimatedCostUsd).toBe(0);
      expect(result.extractedParams.documentName).toBeTruthy();
      expect(result.extractedParams.documentName).toContain('Q4 report');
    });

    it('extracts document name from "can I get the NDA"', async () => {
      const result = await plan('can I get the NDA', {});

      expect(result.extractedParams.documentName).toBeTruthy();
      expect(result.extractedParams.documentName).toContain('NDA');
    });

    it('extracts document name from "share the onboarding doc"', async () => {
      const result = await plan('share the onboarding doc', {});

      expect(result.extractedParams.documentName).toBeTruthy();
    });

    it('extracts document name from "request the budget spreadsheet"', async () => {
      const result = await plan('request the budget spreadsheet', {});

      expect(result.extractedParams.documentName).toBeTruthy();
    });

    it('falls back when no clear document name found', async () => {
      const result = await plan('document', {});

      // Should have some fallback, not empty
      expect(result.extractedParams.documentName).toBeTruthy();
    });

    it('returns a single api_call step', async () => {
      const result = await plan('send me the proposal', {});

      expect(result.steps).toHaveLength(1);
      expect(result.steps[0].type).toBe('api_call');
    });

    it('extracts reason from "because I need it for the meeting"', async () => {
      const result = await plan(
        'send me the slides because I need it for the meeting',
        {},
      );

      expect(result.extractedParams.reason).toBeTruthy();
    });
  });

  describe('execute()', () => {
    it('returns success with requestId for valid document request', async () => {
      const wavePlan = {
        steps: [{ type: 'api_call', description: 'Create request', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: {
          documentName: 'Q4 Report',
          reason: 'Need it for the board meeting',
        },
      };

      const result = await execute(wavePlan);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Document request submitted');
      expect(result.output).toContain('Q4 Report');
      expect(result.output).toContain('board meeting');
      expect(result.metadata).toBeDefined();
      expect(result.metadata.requestId).toBeDefined();
      expect(result.metadata.requestId).toMatch(/^doc_\d+$/);
      expect(result.metadata.waveId).toBe('document-request');
      expect(result.metadata.approvalRequired).toBe(true);
    });

    it('returns success without reason when none provided', async () => {
      const wavePlan = {
        steps: [{ type: 'api_call', description: 'Create request', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: {
          documentName: 'Employee Handbook',
          reason: '',
        },
      };

      const result = await execute(wavePlan);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Employee Handbook');
      expect(result.metadata.requestId).toBeDefined();
    });

    it('returns error for empty document name', async () => {
      const wavePlan = {
        steps: [{ type: 'api_call', description: 'Create request', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: {
          documentName: '',
          reason: 'test',
        },
      };

      const result = await execute(wavePlan);

      expect(result.success).toBe(false);
      expect(result.error).toContain('document name');
    });

    it('returns error for whitespace-only document name', async () => {
      const wavePlan = {
        steps: [{ type: 'api_call', description: 'Create request', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: {
          documentName: '   ',
          reason: '',
        },
      };

      const result = await execute(wavePlan);

      expect(result.success).toBe(false);
    });

    it('includes approval request in metadata', async () => {
      const wavePlan = {
        steps: [{ type: 'api_call', description: 'Create request', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: {
          documentName: 'Contract',
          reason: 'Legal review',
        },
      };

      const result = await execute(wavePlan);

      expect(result.metadata.approvalRequest).toBeDefined();
      expect(result.metadata.approvalRequest.type).toBe('document_request');
      expect(result.metadata.approvalRequest.status).toBe('pending');
      expect(result.metadata.approvalRequest.documentName).toBe('Contract');
    });

    it('truncates long reason in output', async () => {
      const longReason = 'x'.repeat(200);
      const wavePlan = {
        steps: [{ type: 'api_call', description: 'Create request', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: {
          documentName: 'Report',
          reason: longReason,
        },
      };

      const result = await execute(wavePlan);

      expect(result.success).toBe(true);
      expect(result.output).toContain('...');
    });

    it('generates unique requestIds', async () => {
      const wavePlan = {
        steps: [{ type: 'api_call', description: 'Create request', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: {
          documentName: 'Doc A',
          reason: '',
        },
      };

      const result1 = await execute(wavePlan);

      // Small delay to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 5));

      const result2 = await execute({
        ...wavePlan,
        extractedParams: { documentName: 'Doc B', reason: '' },
      });

      expect(result1.metadata.requestId).not.toBe(result2.metadata.requestId);
    });
  });

  describe('validate()', () => {
    it('returns valid when requestId exists in metadata', async () => {
      const result = await validate({
        success: true,
        output: 'Document request submitted.',
        metadata: { requestId: 'doc_123', waveId: 'document-request' },
      });

      expect(result.valid).toBe(true);
    });

    it('returns invalid when requestId is missing', async () => {
      const result = await validate({
        success: true,
        output: 'Something happened.',
        metadata: {},
      });

      expect(result.valid).toBe(false);
      expect(result.feedback).toContain('request ID');
    });

    it('returns invalid for failed result', async () => {
      const result = await validate({
        success: false,
        output: '',
        error: 'Validation error',
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
