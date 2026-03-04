/**
 * Tests for the install tier feature gate module.
 * Validates feature availability, tier recommendations, limits, and wave compatibility.
 */

import { describe, it, expect } from 'vitest';
import {
  isFeatureEnabled,
  getChannelLimit,
  getBudgetLimit,
  getConcurrentTaskLimit,
  getEnabledFeatures,
  getTierDescriptions,
  waveMinTierToInstallTier,
  canRunWave,
  type GatedFeature,
} from '../../../src/tiers/feature-gate.js';
import { recommendTier } from '../../../src/utils/hardware.js';
import type { InstallTier } from '../../../src/types/index.js';

describe('feature gate', () => {
  // ── isFeatureEnabled ──────────────────────────────────────────────

  describe('isFeatureEnabled', () => {
    it('webchat is enabled at all tiers', () => {
      expect(isFeatureEnabled('lite', 'webchat')).toBe(true);
      expect(isFeatureEnabled('standard', 'webchat')).toBe(true);
      expect(isFeatureEnabled('full', 'webchat')).toBe(true);
    });

    it('channels_basic is enabled at all tiers', () => {
      expect(isFeatureEnabled('lite', 'channels_basic')).toBe(true);
      expect(isFeatureEnabled('standard', 'channels_basic')).toBe(true);
      expect(isFeatureEnabled('full', 'channels_basic')).toBe(true);
    });

    it('channels_all is NOT enabled at lite tier', () => {
      expect(isFeatureEnabled('lite', 'channels_all')).toBe(false);
    });

    it('channels_all IS enabled at standard and full', () => {
      expect(isFeatureEnabled('standard', 'channels_all')).toBe(true);
      expect(isFeatureEnabled('full', 'channels_all')).toBe(true);
    });

    it('browser_automation is NOT enabled at lite', () => {
      expect(isFeatureEnabled('lite', 'browser_automation')).toBe(false);
    });

    it('browser_automation IS enabled at standard and full', () => {
      expect(isFeatureEnabled('standard', 'browser_automation')).toBe(true);
      expect(isFeatureEnabled('full', 'browser_automation')).toBe(true);
    });

    it('local_models is NOT enabled at lite', () => {
      expect(isFeatureEnabled('lite', 'local_models')).toBe(false);
    });

    it('local_models IS enabled at standard and full', () => {
      expect(isFeatureEnabled('standard', 'local_models')).toBe(true);
      expect(isFeatureEnabled('full', 'local_models')).toBe(true);
    });

    it('voice_transcription is ONLY enabled at full', () => {
      expect(isFeatureEnabled('lite', 'voice_transcription')).toBe(false);
      expect(isFeatureEnabled('standard', 'voice_transcription')).toBe(false);
      expect(isFeatureEnabled('full', 'voice_transcription')).toBe(true);
    });

    it('voice_synthesis is ONLY enabled at full', () => {
      expect(isFeatureEnabled('lite', 'voice_synthesis')).toBe(false);
      expect(isFeatureEnabled('standard', 'voice_synthesis')).toBe(false);
      expect(isFeatureEnabled('full', 'voice_synthesis')).toBe(true);
    });

    it('party_waves is NOT enabled at lite', () => {
      expect(isFeatureEnabled('lite', 'party_waves')).toBe(false);
    });

    it('party_waves IS enabled at standard and full', () => {
      expect(isFeatureEnabled('standard', 'party_waves')).toBe(true);
      expect(isFeatureEnabled('full', 'party_waves')).toBe(true);
    });

    it('waves_hub is NOT enabled at lite', () => {
      expect(isFeatureEnabled('lite', 'waves_hub')).toBe(false);
    });

    it('deterministic_waves is enabled at all tiers', () => {
      expect(isFeatureEnabled('lite', 'deterministic_waves')).toBe(true);
      expect(isFeatureEnabled('standard', 'deterministic_waves')).toBe(true);
      expect(isFeatureEnabled('full', 'deterministic_waves')).toBe(true);
    });

    it('ai_waves is enabled at all tiers', () => {
      expect(isFeatureEnabled('lite', 'ai_waves')).toBe(true);
      expect(isFeatureEnabled('standard', 'ai_waves')).toBe(true);
      expect(isFeatureEnabled('full', 'ai_waves')).toBe(true);
    });

    it('integrations is NOT enabled at lite', () => {
      expect(isFeatureEnabled('lite', 'integrations')).toBe(false);
    });

    it('model_routing is NOT enabled at lite', () => {
      expect(isFeatureEnabled('lite', 'model_routing')).toBe(false);
    });

    it('quality_checks is NOT enabled at lite', () => {
      expect(isFeatureEnabled('lite', 'quality_checks')).toBe(false);
    });

    it('returns false for unknown features', () => {
      expect(isFeatureEnabled('full', 'nonexistent_feature' as GatedFeature)).toBe(false);
    });
  });

  // ── getChannelLimit ───────────────────────────────────────────────

  describe('getChannelLimit', () => {
    it('lite tier allows 2 channels', () => {
      expect(getChannelLimit('lite')).toBe(2);
    });

    it('standard tier allows 10 channels', () => {
      expect(getChannelLimit('standard')).toBe(10);
    });

    it('full tier allows 10 channels', () => {
      expect(getChannelLimit('full')).toBe(10);
    });
  });

  // ── getBudgetLimit ────────────────────────────────────────────────

  describe('getBudgetLimit', () => {
    it('lite tier budget is $10', () => {
      expect(getBudgetLimit('lite')).toBe(10);
    });

    it('standard tier budget is $50', () => {
      expect(getBudgetLimit('standard')).toBe(50);
    });

    it('full tier budget is $200', () => {
      expect(getBudgetLimit('full')).toBe(200);
    });
  });

  // ── getConcurrentTaskLimit ────────────────────────────────────────

  describe('getConcurrentTaskLimit', () => {
    it('lite allows 1 concurrent task', () => {
      expect(getConcurrentTaskLimit('lite')).toBe(1);
    });

    it('standard allows 5 concurrent tasks', () => {
      expect(getConcurrentTaskLimit('standard')).toBe(5);
    });

    it('full allows 10 concurrent tasks', () => {
      expect(getConcurrentTaskLimit('full')).toBe(10);
    });
  });

  // ── getEnabledFeatures ────────────────────────────────────────────

  describe('getEnabledFeatures', () => {
    it('lite tier has fewer features than standard', () => {
      const liteFeatures = getEnabledFeatures('lite');
      const standardFeatures = getEnabledFeatures('standard');
      expect(liteFeatures.length).toBeLessThan(standardFeatures.length);
    });

    it('standard tier has fewer features than full', () => {
      const standardFeatures = getEnabledFeatures('standard');
      const fullFeatures = getEnabledFeatures('full');
      expect(standardFeatures.length).toBeLessThan(fullFeatures.length);
    });

    it('full tier enables all features', () => {
      const fullFeatures = getEnabledFeatures('full');
      expect(fullFeatures).toContain('webchat');
      expect(fullFeatures).toContain('voice_transcription');
      expect(fullFeatures).toContain('voice_synthesis');
      expect(fullFeatures).toContain('browser_automation');
      expect(fullFeatures).toContain('local_models');
      expect(fullFeatures).toContain('party_waves');
    });

    it('lite tier includes core features', () => {
      const liteFeatures = getEnabledFeatures('lite');
      expect(liteFeatures).toContain('webchat');
      expect(liteFeatures).toContain('channels_basic');
      expect(liteFeatures).toContain('deterministic_waves');
      expect(liteFeatures).toContain('ai_waves');
    });

    it('lite tier does NOT include advanced features', () => {
      const liteFeatures = getEnabledFeatures('lite');
      expect(liteFeatures).not.toContain('browser_automation');
      expect(liteFeatures).not.toContain('voice_transcription');
      expect(liteFeatures).not.toContain('party_waves');
      expect(liteFeatures).not.toContain('waves_hub');
    });

    it('tiers are additive — each higher tier is a superset', () => {
      const liteFeatures = new Set(getEnabledFeatures('lite'));
      const standardFeatures = new Set(getEnabledFeatures('standard'));
      const fullFeatures = new Set(getEnabledFeatures('full'));

      // Every lite feature is in standard
      for (const feature of liteFeatures) {
        expect(standardFeatures.has(feature)).toBe(true);
      }

      // Every standard feature is in full
      for (const feature of standardFeatures) {
        expect(fullFeatures.has(feature)).toBe(true);
      }
    });
  });

  // ── getTierDescriptions ───────────────────────────────────────────

  describe('getTierDescriptions', () => {
    it('returns descriptions for all three tiers', () => {
      const descriptions = getTierDescriptions();
      expect(descriptions.lite).toBeDefined();
      expect(descriptions.standard).toBeDefined();
      expect(descriptions.full).toBeDefined();
    });

    it('each tier has a name, description, and highlights', () => {
      const descriptions = getTierDescriptions();
      for (const tier of ['lite', 'standard', 'full'] as InstallTier[]) {
        expect(descriptions[tier].name).toBeTruthy();
        expect(descriptions[tier].description).toBeTruthy();
        expect(descriptions[tier].highlights.length).toBeGreaterThan(0);
      }
    });

    it('only full tier requires GPU', () => {
      const descriptions = getTierDescriptions();
      expect(descriptions.lite.gpuRequired).toBe(false);
      expect(descriptions.standard.gpuRequired).toBe(false);
      expect(descriptions.full.gpuRequired).toBe(true);
    });

    it('tier descriptions include limits', () => {
      const descriptions = getTierDescriptions();
      expect(descriptions.lite.channelLimit).toBe(2);
      expect(descriptions.standard.budgetLimit).toBe(50);
      expect(descriptions.full.concurrentTasks).toBe(10);
    });
  });

  // ── recommendTier ─────────────────────────────────────────────────

  describe('recommendTier', () => {
    it('recommends lite for 4GB RAM no GPU', () => {
      expect(recommendTier(4, false)).toBe('lite');
    });

    it('recommends lite for 8GB RAM no GPU', () => {
      expect(recommendTier(8, false)).toBe('lite');
    });

    it('recommends standard for 16GB RAM no GPU', () => {
      expect(recommendTier(16, false)).toBe('standard');
    });

    it('recommends standard for 16GB RAM with GPU', () => {
      // 16GB with GPU is standard, not full (needs 32GB)
      expect(recommendTier(16, true)).toBe('standard');
    });

    it('recommends standard for 32GB RAM no GPU', () => {
      // 32GB without GPU is standard (full requires GPU)
      expect(recommendTier(32, false)).toBe('standard');
    });

    it('recommends full for 32GB RAM with GPU', () => {
      expect(recommendTier(32, true)).toBe('full');
    });

    it('recommends full for 64GB RAM with GPU', () => {
      expect(recommendTier(64, true)).toBe('full');
    });

    it('recommends lite for very low RAM', () => {
      expect(recommendTier(2, false)).toBe('lite');
    });
  });

  // ── waveMinTierToInstallTier ──────────────────────────────────────

  describe('waveMinTierToInstallTier', () => {
    it('maps basic to lite', () => {
      expect(waveMinTierToInstallTier('basic')).toBe('lite');
    });

    it('maps standard to standard', () => {
      expect(waveMinTierToInstallTier('standard')).toBe('standard');
    });

    it('maps power to full', () => {
      expect(waveMinTierToInstallTier('power')).toBe('full');
    });

    it('defaults unknown values to lite', () => {
      expect(waveMinTierToInstallTier('unknown')).toBe('lite');
    });
  });

  // ── canRunWave ────────────────────────────────────────────────────

  describe('canRunWave', () => {
    it('lite can run basic waves', () => {
      expect(canRunWave('lite', 'basic')).toBe(true);
    });

    it('lite CANNOT run standard waves', () => {
      expect(canRunWave('lite', 'standard')).toBe(false);
    });

    it('lite CANNOT run power waves', () => {
      expect(canRunWave('lite', 'power')).toBe(false);
    });

    it('standard can run basic waves', () => {
      expect(canRunWave('standard', 'basic')).toBe(true);
    });

    it('standard can run standard waves', () => {
      expect(canRunWave('standard', 'standard')).toBe(true);
    });

    it('standard CANNOT run power waves', () => {
      expect(canRunWave('standard', 'power')).toBe(false);
    });

    it('full can run all wave tiers', () => {
      expect(canRunWave('full', 'basic')).toBe(true);
      expect(canRunWave('full', 'standard')).toBe(true);
      expect(canRunWave('full', 'power')).toBe(true);
    });
  });
});
