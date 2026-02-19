/**
 * Hardware detection module.
 * Detects OS, architecture, RAM, CPU, disk space, and GPU availability.
 * Calculates feature flags based on hardware capabilities.
 * See HLD Section S0.B.3.
 */

import os from 'node:os';
import { execSync } from 'node:child_process';
import type { HardwareProfile } from '../types/index.js';
import { createModuleLogger } from './logger.js';

const log = createModuleLogger('hardware');

/** RAM threshold in GB for browser automation features */
const BROWSER_AUTOMATION_RAM_GB = 8;

/** RAM threshold in GB for local model features */
const LOCAL_MODELS_RAM_GB = 16;

/** RAM threshold in GB for voice features */
const VOICE_RAM_GB = 16;

/**
 * Detect GPU availability on the current platform.
 * On macOS, queries system_profiler for display data.
 * On Linux, checks for NVIDIA driver presence.
 * On Windows, queries wmic for video controller names.
 * Returns false on unsupported platforms or detection failure.
 */
export function detectGpu(): boolean {
  const platform = os.platform();

  try {
    if (platform === 'darwin') {
      const output = execSync('system_profiler SPDisplaysDataType', {
        encoding: 'utf-8',
        timeout: 5000,
      });
      const hasDiscreteGpu = /Vendor:\s+(?!Apple)/i.test(output)
        || /Chipset Model:\s+.*(Radeon|NVIDIA|GeForce)/i.test(output);
      const hasAppleSiliconGpu = /Chipset Model:\s+Apple/i.test(output);
      return hasDiscreteGpu || hasAppleSiliconGpu;
    }

    if (platform === 'linux') {
      const nvidiaPath = '/proc/driver/nvidia/version';
      execSync(`test -f ${nvidiaPath}`, { timeout: 2000 });
      return true;
    }

    if (platform === 'win32') {
      const output = execSync(
        'wmic path win32_VideoController get Name /value',
        { encoding: 'utf-8', timeout: 5000 },
      );
      return /Name=.*(NVIDIA|GeForce|RTX|GTX|Radeon|AMD|Intel\s+(?:Arc|Iris|UHD|HD))/i.test(output);
    }
  } catch {
    log.debug({ platform }, 'GPU detection failed or no GPU found');
  }

  return false;
}

/**
 * Get free disk space in gigabytes for the root filesystem.
 * Uses `df` on macOS/Linux and `wmic` on Windows.
 * Returns 0 if detection fails.
 */
export function getDiskFreeGb(): number {
  try {
    const platform = os.platform();

    if (platform === 'darwin' || platform === 'linux') {
      const output = execSync("df -k / | tail -1 | awk '{print $4}'", {
        encoding: 'utf-8',
        timeout: 5000,
      });
      const freeKb = parseInt(output.trim(), 10);
      if (!Number.isFinite(freeKb) || freeKb < 0) {
        return 0;
      }
      return Math.round((freeKb / (1024 * 1024)) * 100) / 100;
    }

    if (platform === 'win32') {
      // Query free space on the system drive (usually C:)
      const output = execSync(
        'wmic logicaldisk where "DeviceID=\'C:\'" get FreeSpace /value',
        { encoding: 'utf-8', timeout: 5000 },
      );
      const match = output.match(/FreeSpace=(\d+)/);
      if (match) {
        const freeBytes = parseInt(match[1], 10);
        if (Number.isFinite(freeBytes) && freeBytes >= 0) {
          return Math.round((freeBytes / (1024 ** 3)) * 100) / 100;
        }
      }
      return 0;
    }

    log.warn({ platform }, 'Disk space detection not supported on this platform');
    return 0;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn({ error: message }, 'Failed to detect disk free space');
    return 0;
  }
}

/**
 * Calculate feature flags based on detected hardware capabilities.
 * - browserAutomation: requires 8GB+ RAM
 * - localModels: requires 16GB+ RAM
 * - voice: requires 16GB+ RAM and GPU
 */
export function calculateFeatureFlags(ramGb: number, hasGpu: boolean): HardwareProfile['features'] {
  return {
    browserAutomation: ramGb >= BROWSER_AUTOMATION_RAM_GB,
    localModels: ramGb >= LOCAL_MODELS_RAM_GB,
    voice: ramGb >= VOICE_RAM_GB && hasGpu,
  };
}

/**
 * Detect hardware profile of the current machine.
 * Returns a complete HardwareProfile including OS, architecture,
 * RAM, CPU cores, disk space, GPU availability, and feature flags.
 */
export function detectHardware(): HardwareProfile {
  const detectedOs = os.platform();
  const arch = os.arch();
  const ramGb = Math.round((os.totalmem() / (1024 ** 3)) * 100) / 100;
  const cpuCores = os.cpus().length;
  const diskFreeGb = getDiskFreeGb();
  const hasGpu = detectGpu();

  const features = calculateFeatureFlags(ramGb, hasGpu);

  const profile: HardwareProfile = {
    os: detectedOs,
    arch,
    ramGb,
    cpuCores,
    diskFreeGb,
    hasGpu,
    features,
  };

  log.info(
    {
      os: profile.os,
      arch: profile.arch,
      ramGb: profile.ramGb,
      cpuCores: profile.cpuCores,
      diskFreeGb: profile.diskFreeGb,
      hasGpu: profile.hasGpu,
      features: profile.features,
    },
    'Hardware profile detected',
  );

  return profile;
}
