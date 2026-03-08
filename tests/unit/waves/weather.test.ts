import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { WavePlan, ToolResult } from '../../../src/types/index.js';

// ── Type definitions for the wave module ────────────────────────────────────

interface WeatherModule {
  plan: (userInput: string, context: Record<string, unknown>) => Promise<WavePlan>;
  execute: (plan: WavePlan) => Promise<ToolResult>;
  validate: (result: ToolResult) => Promise<{ valid: boolean; feedback?: string }>;
}

// ── Open-Meteo mock response builders ───────────────────────────────────────

function buildGeocodingResponse(name: string, lat: number, lon: number, country = 'United States'): Record<string, unknown> {
  return {
    results: [
      { name, latitude: lat, longitude: lon, country, admin1: 'Washington' },
    ],
  };
}

function buildWeatherResponse(temp = 45, humidity = 72, windSpeed = 8, weatherCode = 2, precipitation = 0): Record<string, unknown> {
  return {
    current: {
      temperature_2m: temp,
      relative_humidity_2m: humidity,
      apparent_temperature: temp - 5,
      precipitation,
      weather_code: weatherCode,
      wind_speed_10m: windSpeed,
      wind_direction_10m: 180,
      is_day: 1,
    },
  };
}

function buildGeocodingEmptyResponse(): Record<string, unknown> {
  return { results: [] };
}

// ── Mock fetch helper ───────────────────────────────────────────────────────

type FetchHandler = (url: string) => Promise<Response>;

function createMockFetch(handler: FetchHandler): typeof fetch {
  return vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return handler(url);
  }) as unknown as typeof fetch;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('weather wave', () => {
  let mod: WeatherModule;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(async () => {
    originalFetch = globalThis.fetch;
    const { pathToFileURL } = await import('node:url');
    const modulePath = pathToFileURL(
      new URL('../../../waves/bundled/weather/index.js', import.meta.url).pathname,
    ).href;
    mod = await import(modulePath);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ── plan() ──────────────────────────────────────────────────────────────

  describe('plan()', () => {
    it('extracts a single location', async () => {
      const result = await mod.plan('weather in Seattle', {});
      expect(result.extractedParams.locations).toEqual(['Seattle']);
      expect(result.extractedParams.parseError).toBeNull();
    });

    it('extracts multiple comma-separated locations', async () => {
      const result = await mod.plan('weather for Seattle, Portland, and Tacoma', {});
      expect(result.extractedParams.locations).toEqual(['Seattle', 'Portland', 'Tacoma']);
    });

    it('extracts locations with "and" separator', async () => {
      const result = await mod.plan('weather in Snoqualmie Pass and Enumclaw', {});
      expect(result.extractedParams.locations).toEqual(['Snoqualmie Pass', 'Enumclaw']);
    });

    it('returns parseError for no location', async () => {
      const result = await mod.plan('weather', {});
      expect(result.extractedParams.locations).toBeNull();
      expect(result.extractedParams.parseError).toBeTruthy();
    });

    it('detects every 30 minutes schedule', async () => {
      const result = await mod.plan('weather in Seattle every 30 minutes', {});
      expect(result.extractedParams.cronSchedule).toBe('*/30 * * * *');
    });

    it('detects every hour schedule', async () => {
      const result = await mod.plan('weather in Seattle every hour', {});
      expect(result.extractedParams.cronSchedule).toBe('0 * * * *');
    });

    it('detects time-bounded schedule with expiry', async () => {
      const result = await mod.plan('weather in Seattle every 30 minutes for the next 2 hours', {});
      expect(result.extractedParams.cronSchedule).toBe('*/30 * * * *');
      expect(result.extractedParams.expiresAt).toBeTruthy();
      // Expiry should be ~2 hours from now
      const expiry = new Date(result.extractedParams.expiresAt as string);
      const diff = expiry.getTime() - Date.now();
      expect(diff).toBeGreaterThan(7_000_000); // > 1h 56m
      expect(diff).toBeLessThan(7_300_000);    // < 2h 2m
    });

    it('no schedule for simple weather query', async () => {
      const result = await mod.plan("what's the weather in Tokyo", {});
      expect(result.extractedParams.cronSchedule).toBeNull();
      expect(result.extractedParams.expiresAt).toBeNull();
    });

    it('handles "check weather for" prefix', async () => {
      const result = await mod.plan('check weather for Denver', {});
      expect(result.extractedParams.locations).toEqual(['Denver']);
    });

    it('handles "temperature in" prefix', async () => {
      const result = await mod.plan('temperature in San Francisco', {});
      expect(result.extractedParams.locations).toEqual(['San Francisco']);
    });
  });

  // ── execute() ───────────────────────────────────────────────────────────

  describe('execute()', () => {
    it('fetches weather for a single location', async () => {
      globalThis.fetch = createMockFetch(async (url) => {
        if (url.includes('geocoding-api')) {
          return jsonResponse(buildGeocodingResponse('Seattle', 47.6, -122.3));
        }
        return jsonResponse(buildWeatherResponse(52, 65, 12, 2));
      });

      const plan = await mod.plan('weather in Seattle', {});
      const result = await mod.execute(plan);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Seattle');
      expect(result.output).toContain('°F');
      expect(result.output).toContain('Partly cloudy');
    });

    it('fetches weather for multiple locations', async () => {
      let geoCallCount = 0;
      const locations = [
        { name: 'Seattle', lat: 47.6, lon: -122.3 },
        { name: 'Portland', lat: 45.5, lon: -122.6 },
      ];

      globalThis.fetch = createMockFetch(async (url) => {
        if (url.includes('geocoding-api')) {
          const loc = locations[geoCallCount++];
          return jsonResponse(buildGeocodingResponse(loc.name, loc.lat, loc.lon));
        }
        return jsonResponse(buildWeatherResponse(48, 70, 10, 3));
      });

      const plan = await mod.plan('weather for Seattle and Portland', {});
      const result = await mod.execute(plan);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Seattle');
      expect(result.output).toContain('Portland');
    });

    it('returns error for unknown location', async () => {
      globalThis.fetch = createMockFetch(async (url) => {
        if (url.includes('geocoding-api')) {
          return jsonResponse(buildGeocodingEmptyResponse());
        }
        return jsonResponse({}, 404);
      });

      const plan = await mod.plan('weather in Xyzzyville', {});
      const result = await mod.execute(plan);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Xyzzyville');
    });

    it('returns error for missing location', async () => {
      const plan = await mod.plan('weather', {});
      const result = await mod.execute(plan);

      expect(result.success).toBe(false);
    });

    it('includes cron metadata when schedule detected', async () => {
      globalThis.fetch = createMockFetch(async (url) => {
        if (url.includes('geocoding-api')) {
          return jsonResponse(buildGeocodingResponse('Seattle', 47.6, -122.3));
        }
        return jsonResponse(buildWeatherResponse(52, 65, 12, 2));
      });

      const plan = await mod.plan('weather in Seattle every 30 minutes for the next 2 hours', {});
      const result = await mod.execute(plan);

      expect(result.success).toBe(true);
      expect(result.metadata).toBeDefined();
      expect(result.metadata?.action).toBe('create_cron_job');
      expect(result.metadata?.cronSchedule).toBe('*/30 * * * *');
      expect(result.metadata?.waveId).toBe('weather');
      expect(result.metadata?.expiresAt).toBeTruthy();
    });

    it('does not include cron metadata for simple queries', async () => {
      globalThis.fetch = createMockFetch(async (url) => {
        if (url.includes('geocoding-api')) {
          return jsonResponse(buildGeocodingResponse('Denver', 39.7, -104.9));
        }
        return jsonResponse(buildWeatherResponse(70, 30, 5, 0));
      });

      const plan = await mod.plan('weather in Denver', {});
      const result = await mod.execute(plan);

      expect(result.success).toBe(true);
      expect(result.metadata?.action).toBeUndefined();
    });

    it('formats precipitation when present', async () => {
      globalThis.fetch = createMockFetch(async (url) => {
        if (url.includes('geocoding-api')) {
          return jsonResponse(buildGeocodingResponse('Seattle', 47.6, -122.3));
        }
        return jsonResponse(buildWeatherResponse(45, 90, 15, 63, 0.25));
      });

      const plan = await mod.plan('weather in Seattle', {});
      const result = await mod.execute(plan);

      expect(result.success).toBe(true);
      expect(result.output).toContain('Precipitation');
      expect(result.output).toContain('0.25');
    });

    it('handles API error gracefully', async () => {
      globalThis.fetch = createMockFetch(async (url) => {
        if (url.includes('geocoding-api')) {
          return jsonResponse(buildGeocodingResponse('Seattle', 47.6, -122.3));
        }
        return jsonResponse({}, 500);
      });

      const plan = await mod.plan('weather in Seattle', {});
      const result = await mod.execute(plan);

      expect(result.success).toBe(false);
    });

    it('handles partial failures with multiple locations', async () => {
      let geoCallCount = 0;
      globalThis.fetch = createMockFetch(async (url) => {
        if (url.includes('geocoding-api')) {
          geoCallCount++;
          if (geoCallCount === 1) {
            return jsonResponse(buildGeocodingResponse('Seattle', 47.6, -122.3));
          }
          return jsonResponse(buildGeocodingEmptyResponse());
        }
        return jsonResponse(buildWeatherResponse(50, 60, 8, 1));
      });

      const plan = await mod.plan('weather for Seattle and Nonexistentplace', {});
      const result = await mod.execute(plan);

      // Should still succeed for the valid location
      expect(result.success).toBe(true);
      expect(result.output).toContain('Seattle');
      expect(result.output).toContain('Errors');
    });
  });

  // ── validate() ──────────────────────────────────────────────────────────

  describe('validate()', () => {
    it('passes valid weather output', async () => {
      const result = await mod.validate({
        success: true,
        output: '☀️ Seattle, Washington: Clear sky\n  🌡️ 52°F (feels like 47°F)\n  💧 Humidity: 65%\n  💨 Wind: 12 mph',
      });
      expect(result.valid).toBe(true);
    });

    it('passes failed results (errors already handled)', async () => {
      const result = await mod.validate({
        success: false,
        output: 'Location not found',
        error: 'not_found',
      });
      expect(result.valid).toBe(true);
    });

    it('fails output missing temperature', async () => {
      const result = await mod.validate({
        success: true,
        output: 'Seattle weather data',
      });
      expect(result.valid).toBe(false);
    });
  });
});
