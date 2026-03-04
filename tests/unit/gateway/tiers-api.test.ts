/**
 * Tests for the install tier REST API routes.
 * Validates tier listing, current tier info, feature checks, and wave compatibility.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerTierRoutes } from '../../../src/gateway/api/tiers.js';
import type { InstallTier } from '../../../src/types/index.js';

describe('tiers API', () => {
  let app: FastifyInstance;
  let currentTier: InstallTier;

  beforeEach(async () => {
    currentTier = 'standard';
    app = Fastify({ logger: false });
    registerTierRoutes(app, () => currentTier);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  // ── GET /api/v1/tiers ───────────────────────────────────────────

  describe('GET /api/v1/tiers', () => {
    it('returns 200 with tier descriptions', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/tiers',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        tiers: Record<string, unknown>;
        currentTier: string;
        recommendedTier: string;
      };
      expect(body.tiers).toBeDefined();
      expect(body.currentTier).toBe('standard');
      expect(body.recommendedTier).toBeDefined();
    });

    it('includes all three tiers', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/tiers',
      });

      const body = JSON.parse(response.body) as {
        tiers: Record<string, { name: string }>;
      };
      expect(body.tiers['lite']).toBeDefined();
      expect(body.tiers['standard']).toBeDefined();
      expect(body.tiers['full']).toBeDefined();
    });

    it('includes hardware info', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/tiers',
      });

      const body = JSON.parse(response.body) as {
        hardware: { ramGb: number; cpuCores: number; hasGpu: boolean };
      };
      expect(typeof body.hardware.ramGb).toBe('number');
      expect(typeof body.hardware.cpuCores).toBe('number');
      expect(typeof body.hardware.hasGpu).toBe('boolean');
    });
  });

  // ── GET /api/v1/tiers/current ───────────────────────────────────

  describe('GET /api/v1/tiers/current', () => {
    it('returns 200 with current tier info', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/tiers/current',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        tier: string;
        enabledFeatures: string[];
        channelLimit: number;
        budgetLimit: number;
        concurrentTaskLimit: number;
      };
      expect(body.tier).toBe('standard');
      expect(Array.isArray(body.enabledFeatures)).toBe(true);
      expect(body.channelLimit).toBe(10);
      expect(body.budgetLimit).toBe(50);
      expect(body.concurrentTaskLimit).toBe(5);
    });

    it('includes tier description', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/tiers/current',
      });

      const body = JSON.parse(response.body) as {
        description: { name: string; highlights: string[] };
      };
      expect(body.description.name).toBe('Standard');
      expect(body.description.highlights.length).toBeGreaterThan(0);
    });

    it('reflects the current tier when changed to lite', async () => {
      currentTier = 'lite';

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/tiers/current',
      });

      const body = JSON.parse(response.body) as {
        tier: string;
        channelLimit: number;
        budgetLimit: number;
      };
      expect(body.tier).toBe('lite');
      expect(body.channelLimit).toBe(2);
      expect(body.budgetLimit).toBe(10);
    });

    it('reflects the current tier when changed to full', async () => {
      currentTier = 'full';

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/tiers/current',
      });

      const body = JSON.parse(response.body) as {
        tier: string;
        concurrentTaskLimit: number;
      };
      expect(body.tier).toBe('full');
      expect(body.concurrentTaskLimit).toBe(10);
    });
  });

  // ── GET /api/v1/tiers/features/:feature ─────────────────────────

  describe('GET /api/v1/tiers/features/:feature', () => {
    it('returns enabled=true for webchat on standard', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/tiers/features/webchat',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { feature: string; enabled: boolean };
      expect(body.feature).toBe('webchat');
      expect(body.enabled).toBe(true);
    });

    it('returns enabled=false for voice_synthesis on standard', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/tiers/features/voice_synthesis',
      });

      const body = JSON.parse(response.body) as { enabled: boolean };
      expect(body.enabled).toBe(false);
    });

    it('returns enabled=true for voice_synthesis on full', async () => {
      currentTier = 'full';

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/tiers/features/voice_synthesis',
      });

      const body = JSON.parse(response.body) as { enabled: boolean };
      expect(body.enabled).toBe(true);
    });

    it('returns enabled=false for browser_automation on lite', async () => {
      currentTier = 'lite';

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/tiers/features/browser_automation',
      });

      const body = JSON.parse(response.body) as { enabled: boolean };
      expect(body.enabled).toBe(false);
    });
  });

  // ── POST /api/v1/tiers/check-wave ───────────────────────────────

  describe('POST /api/v1/tiers/check-wave', () => {
    it('allows basic wave on standard tier', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/tiers/check-wave',
        payload: { waveMinTier: 'basic' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { allowed: boolean };
      expect(body.allowed).toBe(true);
    });

    it('allows standard wave on standard tier', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/tiers/check-wave',
        payload: { waveMinTier: 'standard' },
      });

      const body = JSON.parse(response.body) as { allowed: boolean };
      expect(body.allowed).toBe(true);
    });

    it('denies power wave on standard tier', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/tiers/check-wave',
        payload: { waveMinTier: 'power' },
      });

      const body = JSON.parse(response.body) as { allowed: boolean };
      expect(body.allowed).toBe(false);
    });

    it('denies standard wave on lite tier', async () => {
      currentTier = 'lite';

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/tiers/check-wave',
        payload: { waveMinTier: 'standard' },
      });

      const body = JSON.parse(response.body) as { allowed: boolean };
      expect(body.allowed).toBe(false);
    });

    it('returns 400 for invalid waveMinTier', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/tiers/check-wave',
        payload: { waveMinTier: 'mega' },
      });

      expect(response.statusCode).toBe(400);
    });
  });
});
