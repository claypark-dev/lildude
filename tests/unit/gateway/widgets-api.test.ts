/**
 * Unit tests for widget-specific API endpoints.
 * GET /api/v1/widgets/weather?location=X — current weather for a location
 * GET /api/v1/widgets/reminders — upcoming reminders from cron jobs
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { startApp, type AppContext } from '../../../src/index.js';
import { ConfigSchema } from '../../../src/config/schema.js';
import { createMockProvider, type MockProvider } from '../../mocks/provider.js';
import { clearRegistry } from '../../../src/waves/registry.js';
import { createCronJob } from '../../../src/persistence/cron-jobs.js';
import { storeApiKey } from '../../../src/persistence/api-keys.js';

const MIGRATIONS_DIR = join(__dirname, '..', '..', '..', 'src', 'persistence', 'migrations');
const TEST_API_KEY = 'test-widgets-api-key-12345';

function createTestConfig() {
  return ConfigSchema.parse({
    channels: { webchat: { enabled: false } },
  });
}

function authHeaders() {
  return { authorization: `Bearer ${TEST_API_KEY}` };
}

describe('Widgets API', () => {
  let appContext: AppContext | undefined;
  let mockProvider: MockProvider;

  beforeEach(() => {
    mockProvider = createMockProvider('anthropic');
  });

  afterEach(async () => {
    clearRegistry();
    vi.restoreAllMocks();
    if (appContext) {
      try { await appContext.gateway.stop(); } catch { /* ignore */ }
      try { appContext.dbManager.close(); } catch { /* ignore */ }
      appContext = undefined;
    }
  });

  // ── Reminders Widget ────────────────────────────────────────────

  describe('GET /api/v1/widgets/reminders', () => {
    it('returns empty reminders when no cron jobs exist', async () => {
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

      storeApiKey(appContext.dbManager.db, TEST_API_KEY, 'test');

      const response = await appContext.gateway.app.inject({
        method: 'GET',
        url: '/api/v1/widgets/reminders',
        headers: authHeaders(),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as { reminders: unknown[]; count: number };
      expect(body.count).toBe(0);
      expect(body.reminders).toEqual([]);
    });

    it('returns cron jobs as reminders sorted by next run', async () => {
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
      storeApiKey(db, TEST_API_KEY, 'test');

      // Create reminders (later one first to test sorting)
      createCronJob(db, {
        schedule: '0 9 * * *',
        taskDescription: 'Take vitamins',
        waveId: 'reminders',
        nextRunAt: new Date(Date.now() + 7200_000), // 2h from now
      });

      createCronJob(db, {
        schedule: '0 8 * * *',
        taskDescription: 'Morning standup',
        waveId: 'reminders',
        nextRunAt: new Date(Date.now() + 3600_000), // 1h from now
      });

      const response = await appContext.gateway.app.inject({
        method: 'GET',
        url: '/api/v1/widgets/reminders',
        headers: authHeaders(),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        reminders: Array<{ text: string; schedule: string; nextRunAt: string | null }>;
        count: number;
      };

      expect(body.count).toBe(2);
      expect(body.reminders).toHaveLength(2);

      // Should be sorted by next run (soonest first)
      expect(body.reminders[0].text).toBe('Morning standup');
      expect(body.reminders[1].text).toBe('Take vitamins');
    });

    it('includes schedule and timing fields in reminder items', async () => {
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
      storeApiKey(db, TEST_API_KEY, 'test');

      createCronJob(db, {
        schedule: '*/30 * * * *',
        taskDescription: 'Drink water',
        waveId: 'reminders',
        nextRunAt: new Date(Date.now() + 1800_000),
      });

      const response = await appContext.gateway.app.inject({
        method: 'GET',
        url: '/api/v1/widgets/reminders',
        headers: authHeaders(),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        reminders: Array<Record<string, unknown>>;
      };

      const reminder = body.reminders[0];
      expect(reminder).toHaveProperty('id');
      expect(reminder).toHaveProperty('text', 'Drink water');
      expect(reminder).toHaveProperty('schedule', '*/30 * * * *');
      expect(reminder).toHaveProperty('nextRunAt');
      expect(reminder).toHaveProperty('lastRunAt');
      expect(reminder).toHaveProperty('lastRunStatus');
    });

    it('returns 401 without auth header', async () => {
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

      const response = await appContext.gateway.app.inject({
        method: 'GET',
        url: '/api/v1/widgets/reminders',
      });

      expect(response.statusCode).toBe(401);
    });
  });

  // ── Weather Widget ──────────────────────────────────────────────

  describe('GET /api/v1/widgets/weather', () => {
    it('returns 400 when location parameter is missing', async () => {
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

      storeApiKey(appContext.dbManager.db, TEST_API_KEY, 'test');

      const response = await appContext.gateway.app.inject({
        method: 'GET',
        url: '/api/v1/widgets/weather',
        headers: authHeaders(),
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body) as { error: string };
      expect(body.error).toContain('location');
    });

    it('returns weather data for a valid location (mocked)', async () => {
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

      storeApiKey(appContext.dbManager.db, TEST_API_KEY, 'test');

      // Mock fetch for geocoding + weather APIs
      const originalFetch = global.fetch;
      vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
        const url = typeof input === 'string' ? input : (input as Request).url;

        if (url.includes('geocoding-api.open-meteo.com')) {
          return new Response(JSON.stringify({
            results: [{
              name: 'Seattle',
              latitude: 47.6062,
              longitude: -122.3321,
              country: 'United States',
              admin1: 'Washington',
            }],
          }), { status: 200 });
        }

        if (url.includes('api.open-meteo.com/v1/forecast')) {
          return new Response(JSON.stringify({
            current: {
              temperature_2m: 55.2,
              apparent_temperature: 52.1,
              relative_humidity_2m: 72,
              wind_speed_10m: 8.3,
              wind_direction_10m: 225,
              weather_code: 3,
              is_day: 1,
              precipitation: 0,
            },
          }), { status: 200 });
        }

        // Fall through to real fetch for non-weather URLs (Fastify internal)
        return originalFetch(input, init);
      });

      const response = await appContext.gateway.app.inject({
        method: 'GET',
        url: '/api/v1/widgets/weather?location=Seattle',
        headers: authHeaders(),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as Record<string, unknown>;

      // Check location data
      const location = body.location as Record<string, unknown>;
      expect(location.name).toBe('Seattle');
      expect(location.country).toBe('United States');
      expect(location.region).toBe('Washington');

      // Check weather data
      const weather = body.weather as Record<string, unknown>;
      expect(weather.temperature).toBe(55.2);
      expect(weather.feelsLike).toBe(52.1);
      expect(weather.humidity).toBe(72);
      expect(typeof weather.windSpeed).toBe('number');
      expect(weather.isDay).toBe(true);

      // Check fetchedAt timestamp
      expect(body).toHaveProperty('fetchedAt');
    });

    it('returns 404 for unknown location (mocked)', async () => {
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

      storeApiKey(appContext.dbManager.db, TEST_API_KEY, 'test');

      const originalFetch = global.fetch;
      vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
        const url = typeof input === 'string' ? input : (input as Request).url;

        if (url.includes('geocoding-api.open-meteo.com')) {
          return new Response(JSON.stringify({ results: [] }), { status: 200 });
        }

        return originalFetch(input, init);
      });

      const response = await appContext.gateway.app.inject({
        method: 'GET',
        url: '/api/v1/widgets/weather?location=Zzznotarealplace',
        headers: authHeaders(),
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body) as { error: string };
      expect(body.error).toContain('not found');
    });

    it('returns 401 without auth header', async () => {
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

      const response = await appContext.gateway.app.inject({
        method: 'GET',
        url: '/api/v1/widgets/weather?location=Seattle',
      });

      expect(response.statusCode).toBe(401);
    });
  });
});
