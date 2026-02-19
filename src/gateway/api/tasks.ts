/**
 * Tasks route handlers.
 * GET  /api/v1/tasks       — List recent tasks.
 * GET  /api/v1/tasks/:id   — Get a single task by ID.
 * POST /api/v1/tasks/:id/kill — Kill a running task.
 */

import type { FastifyInstance } from 'fastify';
import type BetterSqlite3 from 'better-sqlite3';
import { getRecentTasks, getTask, updateTaskStatus } from '../../persistence/tasks.js';

/** Query parameters for the task list endpoint. */
interface TasksQuerystring {
  limit?: string;
  offset?: string;
  status?: string;
}

/** Route parameters for task-specific endpoints. */
interface TaskParams {
  id: string;
}

/**
 * Register task endpoints on the given Fastify instance.
 * @param app - The Fastify server instance.
 * @param db - The better-sqlite3 Database instance.
 */
export function registerTaskRoutes(app: FastifyInstance, db: BetterSqlite3.Database): void {
  app.get<{ Querystring: TasksQuerystring }>(
    '/api/v1/tasks',
    async (request, reply) => {
      try {
        const limit = request.query.limit ? parseInt(request.query.limit, 10) : 50;
        const offset = request.query.offset ? parseInt(request.query.offset, 10) : 0;

        const tasks = getRecentTasks(db, limit, offset);
        return reply.status(200).send({ tasks, count: tasks.length });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return reply.status(500).send({ error: 'Failed to retrieve tasks', detail: message });
      }
    },
  );

  app.get<{ Params: TaskParams }>(
    '/api/v1/tasks/:id',
    async (request, reply) => {
      try {
        const task = getTask(db, request.params.id);
        if (!task) {
          return reply.status(404).send({ error: 'Task not found' });
        }
        return reply.status(200).send({ task });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return reply.status(500).send({ error: 'Failed to retrieve task', detail: message });
      }
    },
  );

  app.post<{ Params: TaskParams }>(
    '/api/v1/tasks/:id/kill',
    async (request, reply) => {
      try {
        const task = getTask(db, request.params.id);
        if (!task) {
          return reply.status(404).send({ error: 'Task not found' });
        }

        if (task.status !== 'running' && task.status !== 'pending' && task.status !== 'awaiting_approval') {
          return reply.status(400).send({
            error: 'Cannot kill task',
            detail: `Task is in "${task.status}" state and cannot be killed`,
          });
        }

        updateTaskStatus(db, task.id, 'killed', 'Killed via API');
        const updated = getTask(db, task.id);
        return reply.status(200).send({ task: updated });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return reply.status(500).send({ error: 'Failed to kill task', detail: message });
      }
    },
  );
}
