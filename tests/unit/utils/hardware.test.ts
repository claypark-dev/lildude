import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import os from 'node:os';

describe('hardware', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('detectHardware', () => {
    it('returns a valid HardwareProfile with all required fields', async () => {
      const { detectHardware } = await import('../../../src/utils/hardware.js');
      const profile = detectHardware();

      expect(profile).toBeDefined();
      expect(typeof profile.os).toBe('string');
      expect(profile.os.length).toBeGreaterThan(0);
      expect(typeof profile.arch).toBe('string');
      expect(profile.arch.length).toBeGreaterThan(0);
      expect(typeof profile.ramGb).toBe('number');
      expect(profile.ramGb).toBeGreaterThan(0);
      expect(typeof profile.cpuCores).toBe('number');
      expect(profile.cpuCores).toBeGreaterThan(0);
      expect(typeof profile.diskFreeGb).toBe('number');
      expect(profile.diskFreeGb).toBeGreaterThanOrEqual(0);
      expect(typeof profile.hasGpu).toBe('boolean');
    });

    it('returns correct OS platform string', async () => {
      const { detectHardware } = await import('../../../src/utils/hardware.js');
      const profile = detectHardware();

      expect(profile.os).toBe(os.platform());
    });

    it('returns correct architecture string', async () => {
      const { detectHardware } = await import('../../../src/utils/hardware.js');
      const profile = detectHardware();

      expect(profile.arch).toBe(os.arch());
    });

    it('returns RAM amount consistent with os.totalmem()', async () => {
      const { detectHardware } = await import('../../../src/utils/hardware.js');
      const profile = detectHardware();

      const expectedRamGb = Math.round((os.totalmem() / (1024 ** 3)) * 100) / 100;
      expect(profile.ramGb).toBe(expectedRamGb);
    });

    it('returns CPU core count consistent with os.cpus()', async () => {
      const { detectHardware } = await import('../../../src/utils/hardware.js');
      const profile = detectHardware();

      expect(profile.cpuCores).toBe(os.cpus().length);
    });

    it('includes feature flags object with correct shape', async () => {
      const { detectHardware } = await import('../../../src/utils/hardware.js');
      const profile = detectHardware();

      expect(profile.features).toBeDefined();
      expect(typeof profile.features.browserAutomation).toBe('boolean');
      expect(typeof profile.features.localModels).toBe('boolean');
      expect(typeof profile.features.voice).toBe('boolean');
    });
  });

  describe('calculateFeatureFlags', () => {
    it('enables browserAutomation when RAM >= 8GB', async () => {
      const { calculateFeatureFlags } = await import('../../../src/utils/hardware.js');

      const flags = calculateFeatureFlags(8, false);
      expect(flags.browserAutomation).toBe(true);
    });

    it('disables browserAutomation when RAM < 8GB', async () => {
      const { calculateFeatureFlags } = await import('../../../src/utils/hardware.js');

      const flags = calculateFeatureFlags(7.9, false);
      expect(flags.browserAutomation).toBe(false);
    });

    it('enables localModels when RAM >= 16GB', async () => {
      const { calculateFeatureFlags } = await import('../../../src/utils/hardware.js');

      const flags = calculateFeatureFlags(16, false);
      expect(flags.localModels).toBe(true);
    });

    it('disables localModels when RAM < 16GB', async () => {
      const { calculateFeatureFlags } = await import('../../../src/utils/hardware.js');

      const flags = calculateFeatureFlags(15.9, false);
      expect(flags.localModels).toBe(false);
    });

    it('enables voice when RAM >= 16GB and GPU is present', async () => {
      const { calculateFeatureFlags } = await import('../../../src/utils/hardware.js');

      const flags = calculateFeatureFlags(16, true);
      expect(flags.voice).toBe(true);
    });

    it('disables voice when RAM >= 16GB but no GPU', async () => {
      const { calculateFeatureFlags } = await import('../../../src/utils/hardware.js');

      const flags = calculateFeatureFlags(16, false);
      expect(flags.voice).toBe(false);
    });

    it('disables voice when GPU present but RAM < 16GB', async () => {
      const { calculateFeatureFlags } = await import('../../../src/utils/hardware.js');

      const flags = calculateFeatureFlags(8, true);
      expect(flags.voice).toBe(false);
    });

    it('disables all features with minimal hardware', async () => {
      const { calculateFeatureFlags } = await import('../../../src/utils/hardware.js');

      const flags = calculateFeatureFlags(2, false);
      expect(flags.browserAutomation).toBe(false);
      expect(flags.localModels).toBe(false);
      expect(flags.voice).toBe(false);
    });

    it('enables all features with high-end hardware', async () => {
      const { calculateFeatureFlags } = await import('../../../src/utils/hardware.js');

      const flags = calculateFeatureFlags(64, true);
      expect(flags.browserAutomation).toBe(true);
      expect(flags.localModels).toBe(true);
      expect(flags.voice).toBe(true);
    });
  });

  describe('getDiskFreeGb', () => {
    it('returns a non-negative number', async () => {
      const { getDiskFreeGb } = await import('../../../src/utils/hardware.js');
      const diskFreeGb = getDiskFreeGb();

      expect(typeof diskFreeGb).toBe('number');
      expect(diskFreeGb).toBeGreaterThanOrEqual(0);
    });
  });

  describe('detectGpu', () => {
    it('returns a boolean value', async () => {
      const { detectGpu } = await import('../../../src/utils/hardware.js');
      const hasGpu = detectGpu();

      expect(typeof hasGpu).toBe('boolean');
    });
  });
});
