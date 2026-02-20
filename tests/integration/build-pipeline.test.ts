/**
 * Build pipeline E2E / integration tests.
 * Validates that the full build produces the expected artifacts,
 * that the app starts, responds to health checks, serves the web
 * panel, and shuts down gracefully.
 *
 * These tests assume `npm run build` has already been run.
 */

import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';

const ROOT = join(import.meta.dirname, '..', '..');

/** Wait for a condition to become true, polling every `intervalMs`. */
async function waitFor(
  fn: () => Promise<boolean>,
  timeoutMs: number = 10_000,
  intervalMs: number = 500,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

/** Attempt a fetch, returning null on network errors. */
async function tryFetch(url: string): Promise<Response | null> {
  try {
    return await fetch(url);
  } catch {
    return null;
  }
}

// ── Build Output Verification ──────────────────────────────────────

describe('Build Output Verification', () => {
  it('produces dist/cli.js entry point', () => {
    expect(existsSync(join(ROOT, 'dist', 'cli.js'))).toBe(true);
  });

  it('produces dist/index.js entry point', () => {
    expect(existsSync(join(ROOT, 'dist', 'index.js'))).toBe(true);
  });

  it('copies SQL migration files to dist/migrations/', () => {
    expect(existsSync(join(ROOT, 'dist', 'migrations', '001_initial.sql'))).toBe(true);
  });

  it('copies second migration file', () => {
    expect(existsSync(join(ROOT, 'dist', 'migrations', '002_routing_history.sql'))).toBe(true);
  });

  it('copies bundled skill manifests to dist/skills/', () => {
    expect(existsSync(join(ROOT, 'dist', 'skills', 'bundled', 'web-search', 'skill.json'))).toBe(
      true,
    );
  });

  it('builds the web panel to web/dist/', () => {
    expect(existsSync(join(ROOT, 'web', 'dist', 'index.html'))).toBe(true);
  });

  it('web panel build includes JS assets', () => {
    const html = readFileSync(join(ROOT, 'web', 'dist', 'index.html'), 'utf-8');
    expect(html).toContain('<div id="root">');
    expect(html).toContain('<script');
  });
});

// ── App Startup Integration ────────────────────────────────────────
// These tests require a compatible Node.js version (20.x LTS).
// Node.js 25+ has module resolution issues with @anthropic-ai/sdk@0.39.
// Run manually with: NODE_VERSION=20 npx vitest run tests/integration/build-pipeline.test.ts

/** Check if the app can actually start (compatible Node + SDK). */
function canStartApp(): boolean {
  const major = parseInt(process.version.slice(1), 10);
  return major >= 20 && major < 23;
}

describe('App Startup Integration', () => {
  let appProcess: ChildProcess | null = null;

  beforeAll(() => {
    if (!canStartApp()) {
      // eslint-disable-next-line no-console
      console.warn(
        `Skipping startup tests: Node.js ${process.version} has SDK compatibility issues. Use Node.js 20-22 LTS.`,
      );
    }
  });

  afterAll(async () => {
    if (appProcess && !appProcess.killed) {
      appProcess.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          appProcess?.kill('SIGKILL');
          resolve();
        }, 5000);
        appProcess?.on('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  });

  /** Spawn the app and wait for the health endpoint. */
  async function startApp(): Promise<ChildProcess> {
    const child = spawn('node', ['dist/cli.js', 'start'], {
      cwd: ROOT,
      stdio: 'pipe',
      env: {
        ...process.env,
        NODE_ENV: 'test',
        LIL_DUDE_DATA_DIR: join(ROOT, '.test-data-integration'),
      },
    });

    await waitFor(async () => {
      const res = await tryFetch('http://127.0.0.1:18421/api/v1/health');
      return res !== null && res.ok;
    }, 15_000);

    return child;
  }

  it.skipIf(!canStartApp())(
    'starts the app and health endpoint responds',
    async () => {
      appProcess = await startApp();
      const res = await tryFetch('http://127.0.0.1:18421/api/v1/health');
      expect(res).not.toBeNull();
      expect(res!.ok).toBe(true);
      const body = await res!.json();
      expect(body).toHaveProperty('status');
    },
    20_000,
  );

  it.skipIf(!canStartApp())(
    'serves the web panel at root path',
    async () => {
      if (!appProcess) appProcess = await startApp();
      const res = await tryFetch('http://127.0.0.1:18421/');
      expect(res).not.toBeNull();
      expect(res!.ok).toBe(true);
      const html = await res!.text();
      expect(html).toContain('<div id="root">');
    },
    20_000,
  );

  it.skipIf(!canStartApp())(
    'exits gracefully on SIGTERM',
    async () => {
      if (!appProcess) appProcess = await startApp();

      const exitPromise = new Promise<number | null>((resolve) => {
        appProcess!.on('exit', (code) => resolve(code));
      });

      appProcess.kill('SIGTERM');
      const exitCode = await exitPromise;
      expect(exitCode === 0 || exitCode === null).toBe(true);
      appProcess = null;
    },
    20_000,
  );
});

// ── API Endpoint Smoke Tests ───────────────────────────────────────

describe('API Endpoint Smoke Tests', () => {
  let appProcess: ChildProcess | null = null;

  afterAll(async () => {
    if (appProcess && !appProcess.killed) {
      appProcess.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          appProcess?.kill('SIGKILL');
          resolve();
        }, 5000);
        appProcess?.on('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  });

  it.skipIf(!canStartApp())(
    'all key API endpoints return valid JSON',
    async () => {
      appProcess = spawn('node', ['dist/cli.js', 'start'], {
        cwd: ROOT,
        stdio: 'pipe',
        env: {
          ...process.env,
          NODE_ENV: 'test',
          LIL_DUDE_DATA_DIR: join(ROOT, '.test-data-api-smoke'),
        },
      });

      await waitFor(async () => {
        const res = await tryFetch('http://127.0.0.1:18421/api/v1/health');
        return res !== null && res.ok;
      }, 15_000);

      const endpoints = [
        '/api/v1/health',
        '/api/v1/budget',
        '/api/v1/tasks',
        '/api/v1/config',
        '/api/v1/conversations',
        '/api/v1/knowledge',
      ];

      for (const path of endpoints) {
        const res = await tryFetch(`http://127.0.0.1:18421${path}`);
        expect(res, `${path} should respond`).not.toBeNull();
        expect(res!.ok, `${path} should return 2xx`).toBe(true);
        const contentType = res!.headers.get('content-type') ?? '';
        expect(contentType, `${path} should return JSON`).toContain('application/json');
      }
    },
    25_000,
  );
});
