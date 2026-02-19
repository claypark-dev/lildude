/**
 * Integration tests for the Gateway REST API.
 * Uses Fastify's inject() to test routes without binding to a real port.
 * Each test gets a fresh in-memory SQLite database.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { createDatabase, type DatabaseManager } from '../../../src/persistence/db.js';
import { createTask, updateTaskStatus } from '../../../src/persistence/tasks.js';
import { createConversation } from '../../../src/persistence/conversations.js';
import { upsertKnowledge } from '../../../src/persistence/knowledge.js';
import { createCronJob } from '../../../src/persistence/cron-jobs.js';
import { appendSecurityLog } from '../../../src/persistence/security-log.js';
import { createApproval } from '../../../src/persistence/approvals.js';
import { recordTokenUsage } from '../../../src/persistence/token-usage.js';
import { createGatewayServer, type GatewayServer } from '../../../src/gateway/server.js';
import { ConfigSchema } from '../../../src/config/schema.js';

const MIGRATIONS_DIR = join(__dirname, '..', '..', '..', 'src', 'persistence', 'migrations');

function createTestDb(): DatabaseManager {
  const dbManager = createDatabase(':memory:', MIGRATIONS_DIR);
  dbManager.runMigrations();
  return dbManager;
}

function createTestConfig() {
  return ConfigSchema.parse({});
}

describe('Gateway REST API', () => {
  let dbManager: DatabaseManager;
  let gateway: GatewayServer;

  beforeEach(async () => {
    dbManager = createTestDb();
    const config = createTestConfig();
    gateway = createGatewayServer(dbManager, config);
    // Wait for setup to complete by calling ready
    await gateway.app.ready();
  });

  afterEach(async () => {
    try {
      await gateway.stop();
    } catch {
      // best-effort cleanup
    }
    try {
      dbManager.close();
    } catch {
      // best-effort cleanup
    }
  });

  // ── Health ──────────────────────────────────────────────────────────

  describe('GET /api/v1/health', () => {
    it('returns uptime, memory, and version', async () => {
      const response = await gateway.app.inject({
        method: 'GET',
        url: '/api/v1/health',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body).toHaveProperty('uptime');
      expect(typeof body.uptime).toBe('number');
      expect(body.uptime).toBeGreaterThanOrEqual(0);
      expect(body).toHaveProperty('memoryUsageMb');
      expect(typeof body.memoryUsageMb).toBe('number');
      expect(body).toHaveProperty('version');
      expect(body.version).toBe('0.1.0');
      expect(body).toHaveProperty('activeTasks');
      expect(body.activeTasks).toBe(0);
    });

    it('reports active tasks correctly', async () => {
      const task = createTask(dbManager.db, { type: 'chat', description: 'running task' });
      updateTaskStatus(dbManager.db, task.id, 'running');

      const response = await gateway.app.inject({
        method: 'GET',
        url: '/api/v1/health',
      });

      const body = response.json();
      expect(body.activeTasks).toBe(1);
    });
  });

  // ── Budget ─────────────────────────────────────────────────────────

  describe('GET /api/v1/budget', () => {
    it('returns spend data with defaults', async () => {
      const response = await gateway.app.inject({
        method: 'GET',
        url: '/api/v1/budget',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body).toHaveProperty('monthlyLimitUsd');
      expect(body.monthlyLimitUsd).toBe(20);
      expect(body).toHaveProperty('monthlySpentUsd');
      expect(body.monthlySpentUsd).toBe(0);
      expect(body).toHaveProperty('monthlyRemainingUsd');
      expect(body.monthlyRemainingUsd).toBe(20);
      expect(body).toHaveProperty('dailySpentUsd');
      expect(body).toHaveProperty('isApproachingLimit');
      expect(body.isApproachingLimit).toBe(false);
    });

    it('reflects recorded token usage in spending', async () => {
      const task = createTask(dbManager.db, { type: 'chat' });
      recordTokenUsage(dbManager.db, {
        taskId: task.id,
        provider: 'anthropic',
        model: 'claude-3-haiku',
        inputTokens: 1000,
        outputTokens: 500,
        costUsd: 5.0,
      });

      const response = await gateway.app.inject({
        method: 'GET',
        url: '/api/v1/budget',
      });

      const body = response.json();
      expect(body.monthlySpentUsd).toBe(5.0);
      expect(body.monthlyRemainingUsd).toBe(15.0);
    });
  });

  // ── Tasks ──────────────────────────────────────────────────────────

  describe('GET /api/v1/tasks', () => {
    it('returns empty task list initially', async () => {
      const response = await gateway.app.inject({
        method: 'GET',
        url: '/api/v1/tasks',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body).toHaveProperty('tasks');
      expect(body.tasks).toHaveLength(0);
      expect(body.count).toBe(0);
    });

    it('returns created tasks', async () => {
      createTask(dbManager.db, { type: 'chat', description: 'task 1' });
      createTask(dbManager.db, { type: 'automation', description: 'task 2' });

      const response = await gateway.app.inject({
        method: 'GET',
        url: '/api/v1/tasks',
      });

      const body = response.json();
      expect(body.tasks).toHaveLength(2);
      expect(body.count).toBe(2);
    });

    it('respects limit query parameter', async () => {
      for (let i = 0; i < 5; i++) {
        createTask(dbManager.db, { type: 'chat', description: `task ${i}` });
      }

      const response = await gateway.app.inject({
        method: 'GET',
        url: '/api/v1/tasks?limit=2',
      });

      const body = response.json();
      expect(body.tasks).toHaveLength(2);
    });
  });

  describe('GET /api/v1/tasks/:id', () => {
    it('returns a specific task', async () => {
      const task = createTask(dbManager.db, { type: 'chat', description: 'specific task' });

      const response = await gateway.app.inject({
        method: 'GET',
        url: `/api/v1/tasks/${task.id}`,
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.task.id).toBe(task.id);
      expect(body.task.description).toBe('specific task');
    });

    it('returns 404 for missing task', async () => {
      const response = await gateway.app.inject({
        method: 'GET',
        url: '/api/v1/tasks/nonexistent-id',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /api/v1/tasks/:id/kill', () => {
    it('kills a running task', async () => {
      const task = createTask(dbManager.db, { type: 'chat' });
      updateTaskStatus(dbManager.db, task.id, 'running');

      const response = await gateway.app.inject({
        method: 'POST',
        url: `/api/v1/tasks/${task.id}/kill`,
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.task.status).toBe('killed');
    });

    it('returns 400 for completed task', async () => {
      const task = createTask(dbManager.db, { type: 'chat' });
      updateTaskStatus(dbManager.db, task.id, 'completed');

      const response = await gateway.app.inject({
        method: 'POST',
        url: `/api/v1/tasks/${task.id}/kill`,
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 404 for missing task', async () => {
      const response = await gateway.app.inject({
        method: 'POST',
        url: '/api/v1/tasks/nonexistent-id/kill',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  // ── Config ─────────────────────────────────────────────────────────

  describe('Config endpoints', () => {
    it('GET /api/v1/config returns empty config initially', async () => {
      const response = await gateway.app.inject({
        method: 'GET',
        url: '/api/v1/config',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body).toHaveProperty('config');
      expect(body.config).toHaveLength(0);
    });

    it('PUT /api/v1/config upserts a key-value pair', async () => {
      const putResponse = await gateway.app.inject({
        method: 'PUT',
        url: '/api/v1/config',
        payload: { key: 'test.key', value: 'test-value' },
      });

      expect(putResponse.statusCode).toBe(200);

      const getResponse = await gateway.app.inject({
        method: 'GET',
        url: '/api/v1/config',
      });

      const body = getResponse.json();
      expect(body.config).toHaveLength(1);
      expect(body.config[0].key).toBe('test.key');
      expect(body.config[0].value).toBe('test-value');
    });

    it('PUT /api/v1/config rejects invalid body', async () => {
      const response = await gateway.app.inject({
        method: 'PUT',
        url: '/api/v1/config',
        payload: { key: '', value: 'test' },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  // ── Conversations ──────────────────────────────────────────────────

  describe('Conversations endpoints', () => {
    it('GET /api/v1/conversations returns conversations', async () => {
      createConversation(dbManager.db, {
        channelType: 'webchat',
        channelId: 'default',
      });

      const response = await gateway.app.inject({
        method: 'GET',
        url: '/api/v1/conversations?channelType=webchat&channelId=default',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.conversations).toHaveLength(1);
    });

    it('GET /api/v1/conversations/:id returns a specific conversation', async () => {
      const conv = createConversation(dbManager.db, {
        channelType: 'webchat',
        channelId: 'default',
      });

      const response = await gateway.app.inject({
        method: 'GET',
        url: `/api/v1/conversations/${conv.id}`,
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.conversation.id).toBe(conv.id);
    });

    it('GET /api/v1/conversations/:id returns 404 for missing', async () => {
      const response = await gateway.app.inject({
        method: 'GET',
        url: '/api/v1/conversations/nonexistent',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  // ── Knowledge ──────────────────────────────────────────────────────

  describe('Knowledge endpoints', () => {
    it('POST /api/v1/knowledge creates an entry', async () => {
      const response = await gateway.app.inject({
        method: 'POST',
        url: '/api/v1/knowledge',
        payload: { category: 'preferences', key: 'color', value: 'blue' },
      });

      expect(response.statusCode).toBe(201);

      const body = response.json();
      expect(body.knowledge.category).toBe('preferences');
      expect(body.knowledge.key).toBe('color');
      expect(body.knowledge.value).toBe('blue');
    });

    it('GET /api/v1/knowledge with category filter returns entries', async () => {
      upsertKnowledge(dbManager.db, { category: 'prefs', key: 'k1', value: 'v1' });
      upsertKnowledge(dbManager.db, { category: 'prefs', key: 'k2', value: 'v2' });

      const response = await gateway.app.inject({
        method: 'GET',
        url: '/api/v1/knowledge?category=prefs',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.knowledge).toHaveLength(2);
    });

    it('DELETE /api/v1/knowledge removes an entry', async () => {
      const entry = upsertKnowledge(dbManager.db, { category: 'temp', key: 'k', value: 'v' });

      const response = await gateway.app.inject({
        method: 'DELETE',
        url: '/api/v1/knowledge',
        payload: { id: entry.id },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().ok).toBe(true);
    });
  });

  // ── Cron ───────────────────────────────────────────────────────────

  describe('Cron endpoints', () => {
    it('POST /api/v1/cron creates a cron job', async () => {
      const response = await gateway.app.inject({
        method: 'POST',
        url: '/api/v1/cron',
        payload: { schedule: '0 8 * * *', taskDescription: 'Morning briefing' },
      });

      expect(response.statusCode).toBe(201);

      const body = response.json();
      expect(body.job.schedule).toBe('0 8 * * *');
      expect(body.job.taskDescription).toBe('Morning briefing');
    });

    it('GET /api/v1/cron returns enabled cron jobs', async () => {
      createCronJob(dbManager.db, { schedule: '* * * * *', taskDescription: 'test job' });

      const response = await gateway.app.inject({
        method: 'GET',
        url: '/api/v1/cron',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.jobs).toHaveLength(1);
    });

    it('DELETE /api/v1/cron removes a job', async () => {
      const job = createCronJob(dbManager.db, { schedule: '* * * * *', taskDescription: 'to delete' });

      const response = await gateway.app.inject({
        method: 'DELETE',
        url: '/api/v1/cron',
        payload: { id: job.id },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().ok).toBe(true);
    });
  });

  // ── Security Log ───────────────────────────────────────────────────

  describe('GET /api/v1/security-log', () => {
    it('returns security log entries', async () => {
      appendSecurityLog(dbManager.db, {
        actionType: 'shell_command',
        actionDetail: 'ls -la',
        allowed: true,
        securityLevel: 3,
        reason: 'Whitelisted command',
      });

      const response = await gateway.app.inject({
        method: 'GET',
        url: '/api/v1/security-log',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.logs).toHaveLength(1);
      expect(body.logs[0].actionType).toBe('shell_command');
    });
  });

  // ── Approvals ──────────────────────────────────────────────────────

  describe('Approvals endpoints', () => {
    it('GET /api/v1/approvals returns pending approvals', async () => {
      const task = createTask(dbManager.db, { type: 'chat' });
      createApproval(dbManager.db, {
        taskId: task.id,
        actionType: 'shell_command',
        actionDetail: 'rm -rf /',
        description: 'Dangerous command',
        riskLevel: 'critical',
        expiresAt: new Date(Date.now() + 60_000),
      });

      const response = await gateway.app.inject({
        method: 'GET',
        url: '/api/v1/approvals',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.approvals).toHaveLength(1);
      expect(body.approvals[0].status).toBe('pending');
    });

    it('POST /api/v1/approvals/:id/respond approves a request', async () => {
      const task = createTask(dbManager.db, { type: 'chat' });
      const approval = createApproval(dbManager.db, {
        taskId: task.id,
        actionType: 'shell_command',
        actionDetail: 'apt install foo',
        description: 'Install package',
        riskLevel: 'medium',
        expiresAt: new Date(Date.now() + 60_000),
      });

      const response = await gateway.app.inject({
        method: 'POST',
        url: `/api/v1/approvals/${approval.id}/respond`,
        payload: { decision: 'approved' },
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.approval.status).toBe('approved');
    });

    it('POST /api/v1/approvals/:id/respond denies a request', async () => {
      const task = createTask(dbManager.db, { type: 'chat' });
      const approval = createApproval(dbManager.db, {
        taskId: task.id,
        actionType: 'shell_command',
        actionDetail: 'rm important.txt',
        description: 'Delete file',
        riskLevel: 'high',
        expiresAt: new Date(Date.now() + 60_000),
      });

      const response = await gateway.app.inject({
        method: 'POST',
        url: `/api/v1/approvals/${approval.id}/respond`,
        payload: { decision: 'denied' },
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body.approval.status).toBe('denied');
    });

    it('POST /api/v1/approvals/:id/respond returns 404 for missing', async () => {
      const response = await gateway.app.inject({
        method: 'POST',
        url: '/api/v1/approvals/nonexistent/respond',
        payload: { decision: 'approved' },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  // ── Briefing ─────────────────────────────────────────────────────

  describe('GET /api/v1/briefing', () => {
    it('returns a valid briefing with all sections', async () => {
      const response = await gateway.app.inject({
        method: 'GET',
        url: '/api/v1/briefing',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body).toHaveProperty('generatedAt');
      expect(body).toHaveProperty('greeting');
      expect(body).toHaveProperty('sections');
      expect(body).toHaveProperty('summary');
      expect(body.sections).toHaveLength(4);
      expect(body.summary.activeSkills).toBe(0);
      expect(body.summary.pendingTasks).toBe(0);
    });

    it('reflects tasks and cron jobs in the briefing', async () => {
      createTask(dbManager.db, { type: 'chat', description: 'Test task' });
      createCronJob(dbManager.db, { schedule: '0 9 * * *', taskDescription: 'Morning briefing' });

      const response = await gateway.app.inject({
        method: 'GET',
        url: '/api/v1/briefing',
      });

      const body = response.json();
      expect(body.summary.scheduledJobs).toBe(1);

      const tasksSection = body.sections.find((s: { title: string }) => s.title === 'Recent Tasks');
      expect(tasksSection.items).toHaveLength(1);
      expect(tasksSection.items[0].label).toBe('Test task');
    });
  });

  // ── Usage ──────────────────────────────────────────────────────────

  describe('GET /api/v1/usage', () => {
    it('returns usage data with zero costs initially', async () => {
      const response = await gateway.app.inject({
        method: 'GET',
        url: '/api/v1/usage',
      });

      expect(response.statusCode).toBe(200);

      const body = response.json();
      expect(body).toHaveProperty('dailyCostUsd');
      expect(body).toHaveProperty('monthlyCostUsd');
      expect(body).toHaveProperty('date');
      expect(body).toHaveProperty('month');
      expect(body.dailyCostUsd).toBe(0);
      expect(body.monthlyCostUsd).toBe(0);
    });

    it('reflects recorded token usage', async () => {
      const task = createTask(dbManager.db, { type: 'chat' });
      recordTokenUsage(dbManager.db, {
        taskId: task.id,
        provider: 'openai',
        model: 'gpt-4',
        inputTokens: 500,
        outputTokens: 200,
        costUsd: 0.05,
      });

      const response = await gateway.app.inject({
        method: 'GET',
        url: '/api/v1/usage',
      });

      const body = response.json();
      expect(body.dailyCostUsd).toBe(0.05);
      expect(body.monthlyCostUsd).toBe(0.05);
    });
  });
});
