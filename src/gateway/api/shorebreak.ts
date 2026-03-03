/**
 * Shorebreak route handlers.
 * GET  /api/v1/shorebreak/proposals           — List pending wave proposals.
 * GET  /api/v1/shorebreak/proposals/:id       — Get a specific proposal with source code.
 * POST /api/v1/shorebreak/proposals/:id/approve — Approve a wave proposal.
 * POST /api/v1/shorebreak/proposals/:id/reject  — Reject a wave proposal.
 */

import type { FastifyInstance } from 'fastify';
import type BetterSqlite3 from 'better-sqlite3';
import {
  getPendingProposals,
  approveWaveProposal,
  rejectWaveProposal,
} from '../../waves/shorebreak.js';

/** Route parameters for proposal-specific endpoints. */
interface ProposalParams {
  id: string;
}

/**
 * Register Shorebreak endpoints on the given Fastify instance.
 * @param app - The Fastify server instance.
 * @param db - The better-sqlite3 Database instance.
 */
export function registerShorebreakRoutes(app: FastifyInstance, db: BetterSqlite3.Database): void {
  /** List all pending (unapproved) wave proposals. */
  app.get('/api/v1/shorebreak/proposals', async (_request, reply) => {
    try {
      const proposals = getPendingProposals(db);
      return reply.status(200).send({ proposals, count: proposals.length });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(500).send({ error: 'Failed to retrieve proposals', detail: message });
    }
  });

  /** Get a specific proposal with full source code and scan results. */
  app.get<{ Params: ProposalParams }>('/api/v1/shorebreak/proposals/:id', async (request, reply) => {
    try {
      const { id } = request.params;
      const row = db.prepare(
        `SELECT id, name, description, safety_tier, source_template, source_code,
                manifest, scan_result, scan_passed, test_passed, created_at
         FROM generated_waves WHERE id = ?`,
      ).get(id) as {
        id: string;
        name: string;
        description: string;
        safety_tier: string;
        source_template: string;
        source_code: string;
        manifest: string;
        scan_result: string;
        scan_passed: number;
        test_passed: number;
        created_at: string;
      } | undefined;

      if (!row) {
        return reply.status(404).send({ error: 'Proposal not found' });
      }

      return reply.status(200).send({
        id: row.id,
        name: row.name,
        description: row.description,
        safetyTier: row.safety_tier,
        sourceTemplate: row.source_template,
        sourceCode: row.source_code,
        manifest: JSON.parse(row.manifest),
        scanResult: JSON.parse(row.scan_result),
        scanPassed: row.scan_passed === 1,
        testPassed: row.test_passed === 1,
        createdAt: row.created_at,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(500).send({ error: 'Failed to retrieve proposal', detail: message });
    }
  });

  /** Approve a wave proposal — saves it to disk and enables it. */
  app.post<{ Params: ProposalParams }>('/api/v1/shorebreak/proposals/:id/approve', async (request, reply) => {
    try {
      const { id } = request.params;
      const success = approveWaveProposal(db, id);

      if (!success) {
        return reply.status(400).send({ error: 'Failed to approve proposal. It may not exist or failed security scan.' });
      }

      return reply.status(200).send({ message: 'Wave proposal approved and saved', proposalId: id });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(500).send({ error: 'Failed to approve proposal', detail: message });
    }
  });

  /** Reject a wave proposal — removes it from the pending list. */
  app.post<{ Params: ProposalParams }>('/api/v1/shorebreak/proposals/:id/reject', async (request, reply) => {
    try {
      const { id } = request.params;
      const success = rejectWaveProposal(db, id);

      if (!success) {
        return reply.status(404).send({ error: 'Proposal not found or already processed' });
      }

      return reply.status(200).send({ message: 'Wave proposal rejected', proposalId: id });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(500).send({ error: 'Failed to reject proposal', detail: message });
    }
  });
}
