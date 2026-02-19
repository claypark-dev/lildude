/**
 * Approvals route handlers.
 * GET  /api/v1/approvals               — List pending approval requests.
 * POST /api/v1/approvals/:id/respond   — Approve or deny a request.
 */

import type { FastifyInstance } from 'fastify';
import type BetterSqlite3 from 'better-sqlite3';
import { z } from 'zod';
import {
  getPendingApprovals,
  getApproval,
  approveRequest,
  denyRequest,
} from '../../persistence/approvals.js';

/** Route parameters for approval-specific endpoints. */
interface ApprovalParams {
  id: string;
}

const RespondBodySchema = z.object({
  decision: z.enum(['approved', 'denied']),
});

/**
 * Register approval endpoints on the given Fastify instance.
 * @param app - The Fastify server instance.
 * @param db - The better-sqlite3 Database instance.
 */
export function registerApprovalRoutes(app: FastifyInstance, db: BetterSqlite3.Database): void {
  app.get('/api/v1/approvals', async (_request, reply) => {
    try {
      const approvals = getPendingApprovals(db);
      return reply.status(200).send({ approvals, count: approvals.length });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(500).send({ error: 'Failed to retrieve approvals', detail: message });
    }
  });

  app.post<{ Params: ApprovalParams }>(
    '/api/v1/approvals/:id/respond',
    async (request, reply) => {
      try {
        const bodyResult = RespondBodySchema.safeParse(request.body);
        if (!bodyResult.success) {
          return reply.status(400).send({
            error: 'Invalid request body',
            detail: bodyResult.error.issues.map(i => i.message).join('; '),
          });
        }

        const approval = getApproval(db, request.params.id);
        if (!approval) {
          return reply.status(404).send({ error: 'Approval not found' });
        }

        if (approval.status !== 'pending') {
          return reply.status(400).send({
            error: 'Cannot respond to approval',
            detail: `Approval is already in "${approval.status}" state`,
          });
        }

        if (bodyResult.data.decision === 'approved') {
          approveRequest(db, request.params.id);
        } else {
          denyRequest(db, request.params.id);
        }

        const updated = getApproval(db, request.params.id);
        return reply.status(200).send({ approval: updated });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return reply.status(500).send({ error: 'Failed to respond to approval', detail: message });
      }
    },
  );
}
