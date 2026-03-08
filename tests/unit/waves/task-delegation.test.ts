import { describe, it, expect } from 'vitest';
import { plan, execute, validate } from '../../../waves/bundled/task-delegation/index.js';

describe('task-delegation wave', () => {
  describe('plan()', () => {
    it('extracts title from "task: review the PR"', async () => {
      const result = await plan('task: review the PR', {});

      expect(result.isDeterministic).toBe(true);
      expect(result.estimatedCostUsd).toBe(0);
      expect(result.extractedParams.title).toBeTruthy();
      expect(result.extractedParams.title).toContain('review the PR');
    });

    it('extracts title from "please update the docs"', async () => {
      const result = await plan('please update the docs', {});

      expect(result.extractedParams.title).toBeTruthy();
      expect(result.extractedParams.title).toContain('update the docs');
    });

    it('extracts title from "delegate: follow up on the invoice"', async () => {
      const result = await plan('delegate: follow up on the invoice', {});

      expect(result.extractedParams.title).toBeTruthy();
    });

    it('extracts title from "need to fix the deployment script"', async () => {
      const result = await plan('need to fix the deployment script', {});

      expect(result.extractedParams.title).toBeTruthy();
      expect(result.extractedParams.title).toContain('fix the deployment script');
    });

    it('detects urgent priority', async () => {
      const result = await plan('task: fix the production bug, urgent', {});

      expect(result.extractedParams.priority).toBe('urgent');
    });

    it('detects high priority', async () => {
      const result = await plan('high priority task: review security patch', {});

      expect(result.extractedParams.priority).toBe('high');
    });

    it('detects low priority', async () => {
      const result = await plan('low priority: clean up old logs', {});

      expect(result.extractedParams.priority).toBe('low');
    });

    it('defaults to normal priority', async () => {
      const result = await plan('task: send the weekly report', {});

      expect(result.extractedParams.priority).toBe('normal');
    });

    it('includes full input as description', async () => {
      const input = 'task: review the PR for the new feature';
      const result = await plan(input, {});

      expect(result.extractedParams.description).toBe(input);
    });

    it('returns a single api_call step', async () => {
      const result = await plan('task: test something', {});

      expect(result.steps).toHaveLength(1);
      expect(result.steps[0].type).toBe('api_call');
    });

    it('uses first sentence as title when no pattern matches', async () => {
      const result = await plan('update the database schema. make sure migrations work.', {});

      expect(result.extractedParams.title).toBeTruthy();
    });
  });

  describe('execute()', () => {
    it('returns success with taskId for valid task', async () => {
      const wavePlan = {
        steps: [{ type: 'api_call', description: 'Create task', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: {
          title: 'Review the Q1 financials',
          description: 'Task: review the Q1 financials, high priority',
          priority: 'high',
        },
      };

      const result = await execute(wavePlan);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Task submitted');
      expect(result.output).toContain('Review the Q1 financials');
      expect(result.output).toContain('high');
      expect(result.output).toContain('owner will review');
      expect(result.metadata).toBeDefined();
      expect(result.metadata.taskId).toBeDefined();
      expect(result.metadata.taskId).toMatch(/^task_\d+$/);
      expect(result.metadata.waveId).toBe('task-delegation');
      expect(result.metadata.approvalRequired).toBe(true);
    });

    it('returns success with normal priority', async () => {
      const wavePlan = {
        steps: [{ type: 'api_call', description: 'Create task', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: {
          title: 'Send weekly report',
          description: 'Send the weekly report',
          priority: 'normal',
        },
      };

      const result = await execute(wavePlan);

      expect(result.success).toBe(true);
      expect(result.output).toContain('normal');
      expect(result.metadata.taskId).toBeDefined();
    });

    it('returns success with urgent priority', async () => {
      const wavePlan = {
        steps: [{ type: 'api_call', description: 'Create task', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: {
          title: 'Fix production outage',
          description: 'Fix the production outage immediately',
          priority: 'urgent',
        },
      };

      const result = await execute(wavePlan);

      expect(result.success).toBe(true);
      expect(result.output).toContain('urgent');
    });

    it('returns error for empty title', async () => {
      const wavePlan = {
        steps: [{ type: 'api_call', description: 'Create task', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: {
          title: '',
          description: '',
          priority: 'normal',
        },
      };

      const result = await execute(wavePlan);

      expect(result.success).toBe(false);
      expect(result.error).toContain('title');
    });

    it('returns error for whitespace-only title', async () => {
      const wavePlan = {
        steps: [{ type: 'api_call', description: 'Create task', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: {
          title: '   ',
          description: '',
          priority: 'normal',
        },
      };

      const result = await execute(wavePlan);

      expect(result.success).toBe(false);
    });

    it('returns error for invalid priority', async () => {
      const wavePlan = {
        steps: [{ type: 'api_call', description: 'Create task', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: {
          title: 'Something',
          description: '',
          priority: 'super_critical',
        },
      };

      const result = await execute(wavePlan);

      expect(result.success).toBe(false);
      expect(result.error).toContain('priority');
    });

    it('includes approval request in metadata', async () => {
      const wavePlan = {
        steps: [{ type: 'api_call', description: 'Create task', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: {
          title: 'Deploy v2',
          description: 'Deploy version 2 to production',
          priority: 'high',
        },
      };

      const result = await execute(wavePlan);

      expect(result.metadata.approvalRequest).toBeDefined();
      expect(result.metadata.approvalRequest.type).toBe('task_delegation');
      expect(result.metadata.approvalRequest.status).toBe('pending');
      expect(result.metadata.approvalRequest.title).toBe('Deploy v2');
      expect(result.metadata.approvalRequest.priority).toBe('high');
    });

    it('truncates long description in output', async () => {
      const longDescription = 'x'.repeat(200);
      const wavePlan = {
        steps: [{ type: 'api_call', description: 'Create task', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: {
          title: 'Long task',
          description: longDescription,
          priority: 'normal',
        },
      };

      const result = await execute(wavePlan);

      expect(result.success).toBe(true);
      expect(result.output).toContain('...');
    });

    it('generates unique taskIds', async () => {
      const wavePlan = {
        steps: [{ type: 'api_call', description: 'Create task', params: {} }],
        estimatedCostUsd: 0,
        isDeterministic: true,
        extractedParams: {
          title: 'Task A',
          description: '',
          priority: 'normal',
        },
      };

      const result1 = await execute(wavePlan);
      await new Promise((resolve) => setTimeout(resolve, 5));
      const result2 = await execute({
        ...wavePlan,
        extractedParams: { title: 'Task B', description: '', priority: 'normal' },
      });

      expect(result1.metadata.taskId).not.toBe(result2.metadata.taskId);
    });
  });

  describe('validate()', () => {
    it('returns valid when taskId exists in metadata', async () => {
      const result = await validate({
        success: true,
        output: 'Task submitted.',
        metadata: { taskId: 'task_123', waveId: 'task-delegation' },
      });

      expect(result.valid).toBe(true);
    });

    it('returns invalid when taskId is missing', async () => {
      const result = await validate({
        success: true,
        output: 'Something happened.',
        metadata: {},
      });

      expect(result.valid).toBe(false);
      expect(result.feedback).toContain('task ID');
    });

    it('returns invalid for failed result', async () => {
      const result = await validate({
        success: false,
        output: '',
        error: 'Task creation failed',
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
