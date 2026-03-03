import { describe, it, expect } from 'vitest';
import { plan as taskPlan, execute as taskExecute, validate as taskValidate } from '../../../waves/bundled/task-delegation/index.js';
import { plan as faqPlan, execute as faqExecute, validate as faqValidate } from '../../../waves/bundled/faq-responder/index.js';
import { plan as rsvpPlan, execute as rsvpExecute, validate as rsvpValidate } from '../../../waves/bundled/event-rsvp/index.js';
import { plan as docPlan, execute as docExecute, validate as docValidate } from '../../../waves/bundled/document-request/index.js';

// ── Task Delegation ────────────────────────────────────────────────

describe('task-delegation wave', () => {
  describe('plan', () => {
    it('returns a deterministic plan with extractedParams', async () => {
      const result = await taskPlan('task for: Review the budget report', {});

      expect(result.isDeterministic).toBe(true);
      expect(result.estimatedCostUsd).toBe(0);
      expect(result.steps).toHaveLength(1);
      expect(result.extractedParams).toBeDefined();
    });

    it('extracts title from "task for:" pattern', async () => {
      const result = await taskPlan('task for: Review the budget report', {});

      expect(result.extractedParams.title).toContain('Review the budget report');
    });

    it('defaults priority to normal', async () => {
      const result = await taskPlan('task for: Review the budget report', {});

      expect(result.extractedParams.priority).toBe('normal');
    });

    it('extracts urgent priority from input', async () => {
      const result = await taskPlan('urgent: fix the login bug immediately', {});

      expect(result.extractedParams.priority).toBe('urgent');
    });

    it('extracts high priority from input', async () => {
      const result = await taskPlan('high priority task: update the deployment config', {});

      expect(result.extractedParams.priority).toBe('high');
    });

    it('includes description as full input', async () => {
      const input = 'task for: Check the server logs';
      const result = await taskPlan(input, {});

      expect(result.extractedParams.description).toBe(input);
    });
  });

  describe('execute', () => {
    it('returns success with "Task submitted" in output for valid params', async () => {
      const wavePlan = {
        extractedParams: {
          title: 'Review the budget report',
          description: 'Please review the Q3 budget report and flag any anomalies.',
          priority: 'normal',
        },
      };

      const result = await taskExecute(wavePlan);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Task submitted');
      expect(result.output).toContain('Review the budget report');
    });

    it('includes task ID in output', async () => {
      const wavePlan = {
        extractedParams: {
          title: 'Deploy to staging',
          description: 'Run the deployment pipeline.',
          priority: 'high',
        },
      };

      const result = await taskExecute(wavePlan);

      expect(result.success).toBe(true);
      expect(result.metadata.taskId).toMatch(/^task_/);
      expect(result.output).toContain(result.metadata.taskId);
    });

    it('sets approvalRequired to true in metadata', async () => {
      const wavePlan = {
        extractedParams: {
          title: 'Send the report',
          description: 'Send Q3 report to stakeholders.',
          priority: 'normal',
        },
      };

      const result = await taskExecute(wavePlan);

      expect(result.success).toBe(true);
      expect(result.metadata.approvalRequired).toBe(true);
    });

    it('returns failure when title is empty', async () => {
      const wavePlan = {
        extractedParams: {
          title: '',
          description: 'Some task without a title.',
          priority: 'normal',
        },
      };

      const result = await taskExecute(wavePlan);

      expect(result.success).toBe(false);
      expect(result.error).toContain('title is required');
    });

    it('returns failure for invalid priority', async () => {
      const wavePlan = {
        extractedParams: {
          title: 'Valid title',
          description: 'A task with invalid priority.',
          priority: 'critical',
        },
      };

      const result = await taskExecute(wavePlan);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid priority');
    });
  });

  describe('validate', () => {
    it('returns valid for a successful result with taskId', async () => {
      const result = await taskValidate({
        success: true,
        output: 'Task submitted for owner review.',
        metadata: { taskId: 'task_12345' },
      });

      expect(result.valid).toBe(true);
    });

    it('returns invalid for a failed result', async () => {
      const result = await taskValidate({
        success: false,
        error: 'A task title is required.',
      });

      expect(result.valid).toBe(false);
      expect(result.feedback).toBeDefined();
    });

    it('returns invalid when taskId is missing from metadata', async () => {
      const result = await taskValidate({
        success: true,
        output: 'Something happened.',
        metadata: {},
      });

      expect(result.valid).toBe(false);
      expect(result.feedback).toContain('No task ID');
    });
  });
});

// ── FAQ Responder ──────────────────────────────────────────────────

describe('faq-responder wave', () => {
  describe('plan', () => {
    it('returns a deterministic plan with extractedParams', async () => {
      const result = await faqPlan('question about holidays', {});

      expect(result.isDeterministic).toBe(true);
      expect(result.estimatedCostUsd).toBe(0);
      expect(result.steps).toHaveLength(1);
      expect(result.extractedParams).toBeDefined();
    });

    it('extracts the query from user input', async () => {
      const result = await faqPlan('question about holidays', {});

      expect(result.extractedParams.query).toBeDefined();
      expect(typeof result.extractedParams.query).toBe('string');
      expect((result.extractedParams.query as string).length).toBeGreaterThan(0);
    });

    it('strips common question prefixes from the query', async () => {
      const result = await faqPlan('what is the return policy?', {});

      expect(result.extractedParams.query).not.toMatch(/^what is\s/i);
    });

    it('handles input without a prefix gracefully', async () => {
      const result = await faqPlan('vacation days allowance', {});

      expect(result.extractedParams.query).toContain('vacation');
    });
  });

  describe('execute', () => {
    it('returns success with fallback message when no DB is provided', async () => {
      const wavePlan = {
        extractedParams: {
          query: 'holidays',
        },
      };

      const result = await faqExecute(wavePlan);

      expect(result.success).toBe(true);
      expect(result.output).toContain('holidays');
    });

    it('returns metadata with waveId', async () => {
      const wavePlan = {
        extractedParams: {
          query: 'office hours',
        },
      };

      const result = await faqExecute(wavePlan);

      expect(result.success).toBe(true);
      expect(result.metadata.waveId).toBe('faq-responder');
    });

    it('returns failure for empty query', async () => {
      const wavePlan = {
        extractedParams: {
          query: '',
        },
      };

      const result = await faqExecute(wavePlan);

      expect(result.success).toBe(false);
      expect(result.error).toContain('question');
    });

    it('returns no-match message when DB has no FAQ entries', async () => {
      const mockDb = {
        prepare: () => ({
          all: () => [],
        }),
      };

      const wavePlan = {
        extractedParams: {
          query: 'vacation policy',
          _deps: { db: mockDb },
        },
      };

      const result = await faqExecute(wavePlan);

      expect(result.success).toBe(true);
      expect(result.output).toContain('No FAQ entries');
    });
  });

  describe('validate', () => {
    it('returns valid for a successful result', async () => {
      const result = await faqValidate({
        success: true,
        output: 'Q: What are office hours?\nA: 9am to 5pm.',
      });

      expect(result.valid).toBe(true);
    });

    it('returns invalid for a failed result', async () => {
      const result = await faqValidate({
        success: false,
        error: 'Please provide a question to search the FAQ.',
      });

      expect(result.valid).toBe(false);
      expect(result.feedback).toBeDefined();
    });
  });
});

// ── Event RSVP ────────────────────────────────────────────────────

describe('event-rsvp wave', () => {
  describe('plan', () => {
    it('returns a deterministic plan with extractedParams', async () => {
      const result = await rsvpPlan('rsvp attending the party', {});

      expect(result.isDeterministic).toBe(true);
      expect(result.estimatedCostUsd).toBe(0);
      expect(result.steps).toHaveLength(1);
      expect(result.extractedParams).toBeDefined();
    });

    it('extracts rsvpStatus as attending for affirmative input', async () => {
      const result = await rsvpPlan('rsvp attending the party', {});

      expect(result.extractedParams.rsvpStatus).toBe('attending');
    });

    it('extracts rsvpStatus as declined for negative input', async () => {
      const result = await rsvpPlan("can't attend the meeting", {});

      expect(result.extractedParams.rsvpStatus).toBe('declined');
    });

    it('extracts rsvpStatus as maybe for tentative input', async () => {
      const result = await rsvpPlan('maybe attending the team offsite', {});

      expect(result.extractedParams.rsvpStatus).toBe('maybe');
    });

    it('includes eventName in extractedParams', async () => {
      const result = await rsvpPlan('rsvp attending the annual gala', {});

      expect(result.extractedParams.eventName).toBeDefined();
    });
  });

  describe('execute', () => {
    it('returns success with "RSVP submitted" in output for valid params', async () => {
      const wavePlan = {
        extractedParams: {
          eventName: 'Team Holiday Party',
          rsvpStatus: 'attending',
          message: 'Looking forward to it!',
        },
      };

      const result = await rsvpExecute(wavePlan);

      expect(result.success).toBe(true);
      expect(result.output).toContain('RSVP submitted');
      expect(result.output).toContain('Team Holiday Party');
    });

    it('includes rsvpId in metadata', async () => {
      const wavePlan = {
        extractedParams: {
          eventName: 'Q2 Kickoff',
          rsvpStatus: 'attending',
          message: '',
        },
      };

      const result = await rsvpExecute(wavePlan);

      expect(result.success).toBe(true);
      expect(result.metadata.rsvpId).toMatch(/^rsvp_/);
    });

    it('returns correct status label for declined', async () => {
      const wavePlan = {
        extractedParams: {
          eventName: 'Board Meeting',
          rsvpStatus: 'declined',
          message: 'I have a conflict.',
        },
      };

      const result = await rsvpExecute(wavePlan);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Not attending');
    });

    it('returns failure when eventName is empty', async () => {
      const wavePlan = {
        extractedParams: {
          eventName: '',
          rsvpStatus: 'attending',
          message: '',
        },
      };

      const result = await rsvpExecute(wavePlan);

      expect(result.success).toBe(false);
      expect(result.error).toContain('event name is required');
    });

    it('returns failure for invalid rsvpStatus', async () => {
      const wavePlan = {
        extractedParams: {
          eventName: 'Some Event',
          rsvpStatus: 'unsure',
          message: '',
        },
      };

      const result = await rsvpExecute(wavePlan);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid RSVP status');
    });
  });

  describe('validate', () => {
    it('returns valid for a successful result with rsvpId', async () => {
      const result = await rsvpValidate({
        success: true,
        output: 'RSVP submitted: Attending',
        metadata: { rsvpId: 'rsvp_9999' },
      });

      expect(result.valid).toBe(true);
    });

    it('returns invalid for a failed result', async () => {
      const result = await rsvpValidate({
        success: false,
        error: 'An event name is required.',
      });

      expect(result.valid).toBe(false);
      expect(result.feedback).toBeDefined();
    });

    it('returns invalid when rsvpId is missing from metadata', async () => {
      const result = await rsvpValidate({
        success: true,
        output: 'RSVP recorded.',
        metadata: {},
      });

      expect(result.valid).toBe(false);
      expect(result.feedback).toContain('No RSVP ID');
    });
  });
});

// ── Document Request ───────────────────────────────────────────────

describe('document-request wave', () => {
  describe('plan', () => {
    it('returns a deterministic plan with extractedParams', async () => {
      const result = await docPlan('send me the project proposal', {});

      expect(result.isDeterministic).toBe(true);
      expect(result.estimatedCostUsd).toBe(0);
      expect(result.steps).toHaveLength(1);
      expect(result.extractedParams).toBeDefined();
    });

    it('extracts documentName from "send me" pattern', async () => {
      const result = await docPlan('send me the project proposal', {});

      expect(result.extractedParams.documentName).toBeDefined();
      expect(typeof result.extractedParams.documentName).toBe('string');
      expect((result.extractedParams.documentName as string).length).toBeGreaterThan(0);
    });

    it('extracts documentName from "request" pattern', async () => {
      const result = await docPlan('request the NDA template', {});

      expect(result.extractedParams.documentName).toContain('NDA template');
    });

    it('includes reason in extractedParams', async () => {
      const result = await docPlan('send me the employee handbook for onboarding', {});

      expect(result.extractedParams.reason).toBeDefined();
    });
  });

  describe('execute', () => {
    it('returns success with "Document request submitted" in output for valid params', async () => {
      const wavePlan = {
        extractedParams: {
          documentName: 'Project Proposal',
          reason: 'Needed for the upcoming client meeting.',
        },
      };

      const result = await docExecute(wavePlan);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Document request submitted');
      expect(result.output).toContain('Project Proposal');
    });

    it('includes requestId in metadata', async () => {
      const wavePlan = {
        extractedParams: {
          documentName: 'Q3 Financial Report',
          reason: 'Investor review.',
        },
      };

      const result = await docExecute(wavePlan);

      expect(result.success).toBe(true);
      expect(result.metadata.requestId).toMatch(/^doc_/);
      expect(result.metadata.approvalRequired).toBe(true);
    });

    it('works without a reason provided', async () => {
      const wavePlan = {
        extractedParams: {
          documentName: 'Employee Handbook',
          reason: '',
        },
      };

      const result = await docExecute(wavePlan);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Employee Handbook');
    });

    it('returns failure when documentName is empty', async () => {
      const wavePlan = {
        extractedParams: {
          documentName: '',
          reason: 'Some reason.',
        },
      };

      const result = await docExecute(wavePlan);

      expect(result.success).toBe(false);
      expect(result.error).toContain('document name');
    });

    it('returns failure when documentName exceeds 200 characters', async () => {
      const wavePlan = {
        extractedParams: {
          documentName: 'A'.repeat(201),
          reason: 'Testing max length.',
        },
      };

      const result = await docExecute(wavePlan);

      expect(result.success).toBe(false);
      expect(result.error).toContain('exceed 200 characters');
    });
  });

  describe('validate', () => {
    it('returns valid for a successful result with requestId', async () => {
      const result = await docValidate({
        success: true,
        output: 'Document request submitted for approval.',
        metadata: { requestId: 'doc_12345' },
      });

      expect(result.valid).toBe(true);
    });

    it('returns invalid for a failed result', async () => {
      const result = await docValidate({
        success: false,
        error: 'A document name or description is required.',
      });

      expect(result.valid).toBe(false);
      expect(result.feedback).toBeDefined();
    });

    it('returns invalid when requestId is missing from metadata', async () => {
      const result = await docValidate({
        success: true,
        output: 'Something occurred.',
        metadata: {},
      });

      expect(result.valid).toBe(false);
      expect(result.feedback).toContain('No request ID');
    });
  });
});
