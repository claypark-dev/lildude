/**
 * E2E Scenario: Recurring Weather Pings
 *
 * Tests the motivating scenario: "Weather for Seattle every 30 min for 2 hours"
 * → weather wave matches → extracts locations + schedule + expiry →
 * returns cron metadata → agent loop creates cron job with expiresAt →
 * cron handler fires → re-executes weather wave → delivers to channel.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { startApp, type AppContext } from '../../src/index.js';
import { ConfigSchema } from '../../src/config/schema.js';
import { createMockProvider, type MockProvider } from '../mocks/provider.js';
import { createMockChannelAdapter, type MockChannelAdapter } from '../mocks/channel.js';
import { clearRegistry } from '../../src/waves/registry.js';
import { getEnabledCronJobs } from '../../src/persistence/cron-jobs.js';
import { createCronJobHandler } from '../../src/orchestrator/cron-job-handler.js';
import type { ChatResponse } from '../../src/types/index.js';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'src', 'persistence', 'migrations');

function createTestConfig() {
  return ConfigSchema.parse({
    channels: { webchat: { enabled: false } },
  });
}

function buildMockResponse(text: string): ChatResponse {
  return {
    content: [{ type: 'text', text }],
    model: 'claude-haiku-4-5-20251001',
    usage: { inputTokens: 100, outputTokens: 50 },
    stopReason: 'end_turn',
  };
}

// ── Mock fetch for Open-Meteo API ──────────────────────────────────────────

function buildGeocodingResponse(name: string, lat: number, lon: number) {
  return {
    results: [
      { name, latitude: lat, longitude: lon, country: 'United States', admin1: 'Washington' },
    ],
  };
}

function buildWeatherResponse(temp = 45, humidity = 72, windSpeed = 8, weatherCode = 2) {
  return {
    current: {
      temperature_2m: temp,
      relative_humidity_2m: humidity,
      apparent_temperature: temp - 5,
      precipitation: 0,
      weather_code: weatherCode,
      wind_speed_10m: windSpeed,
      wind_direction_10m: 180,
      is_day: 1,
    },
  };
}

function createWeatherMockFetch() {
  const geoLocations: Record<string, { lat: number; lon: number }> = {
    seattle: { lat: 47.6, lon: -122.3 },
    'snoqualmie pass': { lat: 47.4, lon: -121.4 },
    enumclaw: { lat: 47.2, lon: -121.9 },
    portland: { lat: 45.5, lon: -122.6 },
  };

  return vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

    if (url.includes('geocoding-api.open-meteo.com')) {
      const nameMatch = url.match(/name=([^&]+)/);
      const name = nameMatch ? decodeURIComponent(nameMatch[1]).toLowerCase() : '';
      const loc = geoLocations[name];
      if (loc) {
        return new Response(JSON.stringify(buildGeocodingResponse(name, loc.lat, loc.lon)), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.includes('api.open-meteo.com')) {
      return new Response(JSON.stringify(buildWeatherResponse(52, 65, 12, 2)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Fall through for other URLs
    return new Response('Not Found', { status: 404 });
  }) as unknown as typeof fetch;
}

describe('E2E: Recurring Weather Pings', () => {
  let appContext: AppContext | undefined;
  let mockProvider: MockProvider;
  let mockChannel: MockChannelAdapter;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    mockProvider = createMockProvider('anthropic');
    mockChannel = createMockChannelAdapter('webchat', 'MockChannel');
    mockProvider.setDefault(buildMockResponse('OK'));
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    clearRegistry();
    if (appContext) {
      try { await appContext.gateway.stop(); } catch { /* ignore */ }
      try { appContext.dbManager.close(); } catch { /* ignore */ }
      appContext = undefined;
    }
  });

  it('creates a time-bounded cron job for recurring weather checks', async () => {
    globalThis.fetch = createWeatherMockFetch();
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

    const result = await appContext.agentLoop.processMessage(
      'test-conv-weather',
      'weather for Seattle every 30 minutes for the next 2 hours',
      'webchat',
    );

    // Response should include weather data + scheduling confirmation
    expect(result.responseText).toBeTruthy();
    expect(result.responseText).toContain('°F');

    // A cron job should have been created
    const cronJobs = getEnabledCronJobs(appContext.dbManager.db);
    const weatherJob = cronJobs.find((j) => j.waveId === 'weather');

    expect(weatherJob).toBeDefined();
    expect(weatherJob!.schedule).toBe('*/30 * * * *');
    expect(weatherJob!.channelType).toBe('webchat');
    expect(weatherJob!.channelId).toBe('test-conv-weather');
    expect(weatherJob!.nextRunAt).toBeTruthy();

    // Should have expiry ~2 hours from now
    expect(weatherJob!.expiresAt).toBeTruthy();
    const expiryDiff = weatherJob!.expiresAt!.getTime() - Date.now();
    expect(expiryDiff).toBeGreaterThan(1.8 * 3_600_000);
    expect(expiryDiff).toBeLessThan(2.2 * 3_600_000);
  });

  it('handles multi-location weather with schedule', async () => {
    globalThis.fetch = createWeatherMockFetch();
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

    const result = await appContext.agentLoop.processMessage(
      'test-conv-multi',
      'weather for Snoqualmie Pass, Seattle, and Enumclaw every 30 minutes for the next 2 hours',
      'webchat',
    );

    // Should have weather data for multiple locations
    expect(result.responseText).toBeTruthy();
    // The output should contain at least one location's weather
    expect(result.responseText).toContain('°F');

    // Cron job created
    const cronJobs = getEnabledCronJobs(appContext.dbManager.db);
    const weatherJob = cronJobs.find((j) => j.waveId === 'weather');
    expect(weatherJob).toBeDefined();
    expect(weatherJob!.schedule).toBe('*/30 * * * *');
    // Task description should reference the locations
    expect(weatherJob!.taskDescription).toBeTruthy();
  });

  it('cron handler re-executes weather wave and delivers to channel', async () => {
    globalThis.fetch = createWeatherMockFetch();
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

    // Connect mock channel
    await mockChannel.connect({ enabled: true });
    appContext.channelManager.registerAdapter(mockChannel);

    // Process weather request to create cron job
    await appContext.agentLoop.processMessage(
      'test-conv-cron-fire',
      'weather for Seattle every 30 minutes for the next 2 hours',
      'webchat',
    );

    const cronJobs = getEnabledCronJobs(appContext.dbManager.db);
    const weatherJob = cronJobs.find((j) => j.waveId === 'weather');
    expect(weatherJob).toBeDefined();

    // Simulate cron firing by invoking the handler directly
    const handler = createCronJobHandler({
      db: appContext.dbManager.db,
      channelManager: appContext.channelManager,
      provider: mockProvider,
      enabledProviders: ['anthropic'],
    });

    await handler(weatherJob!);

    // The mock channel should have received a weather report
    expect(mockChannel.sentMessages.length).toBeGreaterThanOrEqual(1);
    const delivered = mockChannel.sentMessages.find(
      (m) => m.text.includes('°F') || m.text.includes('Weather') || m.text.includes('weather'),
    );
    expect(delivered).toBeDefined();
    expect(delivered!.channelId).toBe('test-conv-cron-fire');
  });

  it('exact prompt: "For the next hour ping me with weather for Snoqualmie Pass, Seattle, and Enumclaw every 30 minutes"', async () => {
    globalThis.fetch = createWeatherMockFetch();
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

    // Connect mock channel so we can verify delivery
    await mockChannel.connect({ enabled: true });
    appContext.channelManager.registerAdapter(mockChannel);

    const result = await appContext.agentLoop.processMessage(
      'test-conv-exact-prompt',
      'For the next hour can you ping me with the weather for Snoqualmie pass, Seattle, and Enumclaw every 30 minutes',
      'webchat',
    );

    // 1) Should return immediate weather data for all 3 locations
    expect(result.responseText).toBeTruthy();
    expect(result.responseText).toContain('°F');

    // 2) A cron job should have been created
    const cronJobs = getEnabledCronJobs(appContext.dbManager.db);
    const weatherJob = cronJobs.find((j) => j.waveId === 'weather');

    expect(weatherJob).toBeDefined();
    expect(weatherJob!.schedule).toBe('*/30 * * * *');
    expect(weatherJob!.taskDescription).toContain('Snoqualmie');
    expect(weatherJob!.taskDescription).toContain('Seattle');
    expect(weatherJob!.taskDescription).toContain('Enumclaw');

    // 3) Should expire in ~1 hour
    expect(weatherJob!.expiresAt).toBeTruthy();
    const expiryDiff = weatherJob!.expiresAt!.getTime() - Date.now();
    expect(expiryDiff).toBeGreaterThan(0.8 * 3_600_000);  // > ~48 min
    expect(expiryDiff).toBeLessThan(1.2 * 3_600_000);     // < ~72 min

    // 4) Channel and conversation ID should be set for delivery
    expect(weatherJob!.channelType).toBe('webchat');
    expect(weatherJob!.channelId).toBe('test-conv-exact-prompt');

    // 5) Simulate the cron firing — should deliver weather to the channel
    const handler = createCronJobHandler({
      db: appContext.dbManager.db,
      channelManager: appContext.channelManager,
      provider: mockProvider,
      enabledProviders: ['anthropic'],
    });

    await handler(weatherJob!);

    const delivered = mockChannel.sentMessages.find(
      (m) => m.text.includes('°F'),
    );
    expect(delivered).toBeDefined();
    expect(delivered!.channelId).toBe('test-conv-exact-prompt');
  });

  it('simple weather query creates no cron job', async () => {
    globalThis.fetch = createWeatherMockFetch();
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

    const result = await appContext.agentLoop.processMessage(
      'test-conv-simple',
      'weather in Seattle',
      'webchat',
    );

    // Should return weather data
    expect(result.responseText).toContain('°F');

    // No cron jobs should have been created
    const cronJobs = getEnabledCronJobs(appContext.dbManager.db);
    const weatherJobs = cronJobs.filter((j) => j.waveId === 'weather');
    expect(weatherJobs).toHaveLength(0);
  });
});
