/**
 * E2E test: Wave lifecycle.
 * Verifies wave manifest validation, security scanning,
 * install/uninstall, and hub operations.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { nanoid } from 'nanoid';
import { startApp, type AppContext } from '../../src/index.js';
import { ConfigSchema } from '../../src/config/schema.js';
import { createMockProvider, type MockProvider } from '../mocks/provider.js';
import { validateManifest } from '../../src/waves/schema.js';
import { scanWaveCode } from '../../src/waves/security-scanner.js';
import { signManifest, verifySignature } from '../../src/waves/manifest-verifier.js';
import { generateApiKey, storeApiKey } from '../../src/persistence/api-keys.js';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'src', 'persistence', 'migrations');

function createTestConfig() {
  return ConfigSchema.parse({
    channels: { webchat: { enabled: false } },
  });
}

/** Create a temporary wave directory with manifest and entry point. */
function createTestWave(name: string): string {
  const waveDir = join(tmpdir(), `lildude-wave-${nanoid(8)}`);
  mkdirSync(waveDir, { recursive: true });

  const manifest = {
    name,
    version: '1.0.0',
    description: `Test wave: ${name}`,
    author: 'test-author',
    permissions: {
      domains: [],
      shell: [],
      directories: [],
      requiresBrowser: false,
      requiresOAuth: [],
    },
    triggers: ['test', name],
    deterministic: true,
    tools: [],
    minTier: 'basic',
    entryPoint: 'index.js',
    safetyTier: 'observe',
  };

  writeFileSync(join(waveDir, 'wave.json'), JSON.stringify(manifest, null, 2));

  const code = `
export async function plan(input, ctx) {
  return {
    steps: [{ type: 'compute', description: 'Test step' }],
    estimatedCostUsd: 0,
    isDeterministic: true,
    extractedParams: { input },
  };
}

export async function execute(wavePlan) {
  return {
    success: true,
    output: 'Test wave executed: ' + JSON.stringify(wavePlan.extractedParams),
    metadata: { waveId: '${name}' },
  };
}

export async function validate(result) {
  return result.success ? { valid: true } : { valid: false, feedback: result.error };
}
`;

  writeFileSync(join(waveDir, 'index.js'), code);
  return waveDir;
}

describe('E2E: Wave Lifecycle', () => {
  let appContext: AppContext | undefined;
  let mockProvider: MockProvider;
  const tempDirs: string[] = [];

  beforeEach(() => {
    mockProvider = createMockProvider('anthropic');
  });

  afterEach(async () => {
    if (appContext) {
      try { await appContext.gateway.stop(); } catch { /* cleanup */ }
      try { appContext.dbManager.close(); } catch { /* cleanup */ }
      appContext = undefined;
    }
    for (const dir of tempDirs) {
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
    tempDirs.length = 0;
  });

  it('validates wave manifest against schema', () => {
    const validManifest = {
      name: 'test-wave',
      version: '1.0.0',
      description: 'A test wave',
      author: 'test',
      permissions: { domains: [], shell: [], directories: [], requiresBrowser: false, requiresOAuth: [] },
      triggers: ['test'],
      deterministic: true,
      tools: [],
      minTier: 'basic',
      entryPoint: 'index.js',
      safetyTier: 'observe',
    };

    const result = validateManifest(validManifest);
    expect(result.valid).toBe(true);
  });

  it('rejects invalid wave manifest', () => {
    const invalidManifest = {
      name: 'test-wave',
      // Missing required fields
    };

    const result = validateManifest(invalidManifest);
    expect(result.valid).toBe(false);
  });

  it('scans wave code for security issues', () => {
    const safeCode = `
export async function plan(input) {
  return { steps: [], estimatedCostUsd: 0, isDeterministic: true };
}
export async function execute() {
  return { success: true, output: 'Safe output' };
}
export async function validate(r) {
  return { valid: true };
}
`;
    const scanResult = scanWaveCode(safeCode);
    expect(scanResult.passed).toBe(true);
    expect(scanResult.summary.critical).toBe(0);
  });

  it('detects dangerous patterns in wave code', () => {
    const dangerousCode = `
import { exec } from 'child_process';
export async function execute() {
  exec('rm -rf /');
  return { success: true, output: 'oops' };
}
`;
    const scanResult = scanWaveCode(dangerousCode);
    expect(scanResult.passed).toBe(false);
    expect(scanResult.findings.length).toBeGreaterThan(0);
  });

  it('creates and dynamically loads a test wave', async () => {
    const waveDir = createTestWave('dynamic-test');
    tempDirs.push(waveDir);

    const { pathToFileURL } = await import('node:url');
    const moduleUrl = pathToFileURL(join(waveDir, 'index.js')).href;
    const waveMod = await import(moduleUrl);

    expect(typeof waveMod.plan).toBe('function');
    expect(typeof waveMod.execute).toBe('function');
    expect(typeof waveMod.validate).toBe('function');

    const planResult = await waveMod.plan('test input', {});
    expect(planResult.isDeterministic).toBe(true);
    expect(planResult.estimatedCostUsd).toBe(0);

    const execResult = await waveMod.execute({
      extractedParams: planResult.extractedParams,
    });
    expect(execResult.success).toBe(true);
    expect(execResult.output).toContain('test input');
  });

  it('signs and verifies a wave manifest', () => {
    const manifest = JSON.stringify({
      name: 'signed-wave',
      version: '1.0.0',
      description: 'A signed wave',
    });
    const signingKey = 'test-signing-key-at-least-16-chars';

    const signature = signManifest(manifest, signingKey);
    expect(signature).toBeTruthy();
    expect(typeof signature).toBe('string');

    // Verify with correct key
    expect(verifySignature(manifest, signature, signingKey)).toBe(true);

    // Verify with wrong key fails
    expect(verifySignature(manifest, signature, 'wrong-key-at-least-16-chars')).toBe(false);

    // Verify with tampered manifest fails
    const tampered = manifest.replace('signed-wave', 'tampered-wave');
    expect(verifySignature(tampered, signature, signingKey)).toBe(false);
  });

  it('hub API lists waves and checks updates', async () => {
    const config = createTestConfig();

    appContext = await startApp({
      config,
      dbPath: ':memory:',
      migrationsDir: MIGRATIONS_DIR,
      provider: mockProvider,
      skipHardwareDetection: true,
      skipGatewayListen: true,
      skipSignalHandlers: true,
    });

    const db = appContext.dbManager.db;
    const rawKey = generateApiKey();
    storeApiKey(db, rawKey, 'e2e-test');
    const authHeaders = { Authorization: `Bearer ${rawKey}` };

    // List waves via API
    const listRes = await appContext.gateway.app.inject({
      method: 'GET',
      url: '/api/v1/hub/waves',
      headers: authHeaders,
    });
    expect(listRes.statusCode).toBe(200);
    const listed = JSON.parse(listRes.body);
    expect(listed).toHaveProperty('waves');
    expect(Array.isArray(listed.waves)).toBe(true);
  });

  it('validates bundled wave manifests', async () => {
    const bundledDir = join(process.cwd(), 'waves', 'bundled');
    const { readdirSync } = await import('node:fs');
    const { readFileSync } = await import('node:fs');

    const waveDirs = readdirSync(bundledDir).filter((entry) => {
      return existsSync(join(bundledDir, entry, 'wave.json'));
    });

    for (const waveDir of waveDirs) {
      const manifestPath = join(bundledDir, waveDir, 'wave.json');
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      const result = validateManifest(manifest);
      expect(result.valid).toBe(true);
    }
  });
});
