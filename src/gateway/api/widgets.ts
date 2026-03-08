/**
 * Widget-specific API endpoints for the dashboard.
 * These provide quick, focused data for individual widgets.
 *
 * GET /api/v1/widgets/weather?location=X — current weather for a location
 * GET /api/v1/widgets/reminders — upcoming reminders from cron jobs
 */

import type { FastifyInstance } from 'fastify';
import type BetterSqlite3 from 'better-sqlite3';
import { getEnabledCronJobs } from '../../persistence/cron-jobs.js';
import { createModuleLogger } from '../../utils/logger.js';

const widgetsLogger = createModuleLogger('widgets-api');

/**
 * Register widget-specific API endpoints.
 * @param app - The Fastify server instance.
 * @param db - The better-sqlite3 Database instance.
 */
export function registerWidgetRoutes(
  app: FastifyInstance,
  db: BetterSqlite3.Database,
): void {
  // ── Weather Widget Endpoint ──────────────────────────────────────
  app.get<{
    Querystring: { location?: string };
  }>('/api/v1/widgets/weather', async (request, reply) => {
    try {
      const location = request.query.location;
      if (!location) {
        return reply.status(400).send({
          error: 'Missing "location" query parameter',
        });
      }

      // Use Open-Meteo directly (no wave execution needed — it's a simple API call)
      const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=en&format=json`;
      const geoResponse = await fetch(geoUrl, {
        headers: { 'User-Agent': 'lil-dude/1.0' },
      });

      if (!geoResponse.ok) {
        return reply.status(502).send({ error: `Geocoding failed: ${geoResponse.status}` });
      }

      const geoData = await geoResponse.json() as { results?: Array<{ name: string; latitude: number; longitude: number; country: string; admin1?: string }> };
      if (!geoData.results || geoData.results.length === 0) {
        return reply.status(404).send({ error: `Location not found: "${location}"` });
      }

      const geo = geoData.results[0];
      const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${geo.latitude}&longitude=${geo.longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m,is_day&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch`;

      const weatherResponse = await fetch(weatherUrl, {
        headers: { 'User-Agent': 'lil-dude/1.0' },
      });

      if (!weatherResponse.ok) {
        return reply.status(502).send({ error: `Weather API failed: ${weatherResponse.status}` });
      }

      const weatherData = await weatherResponse.json() as { current?: Record<string, unknown> };

      if (!weatherData.current) {
        return reply.status(502).send({ error: 'Unexpected weather API response' });
      }

      const current = weatherData.current;

      return reply.status(200).send({
        location: {
          name: geo.name,
          country: geo.country,
          region: geo.admin1 ?? null,
          latitude: geo.latitude,
          longitude: geo.longitude,
        },
        weather: {
          temperature: current.temperature_2m ?? 0,
          feelsLike: current.apparent_temperature ?? 0,
          humidity: current.relative_humidity_2m ?? 0,
          windSpeed: current.wind_speed_10m ?? 0,
          windDirection: current.wind_direction_10m ?? 0,
          weatherCode: current.weather_code ?? 0,
          isDay: current.is_day === 1,
          precipitation: current.precipitation ?? 0,
        },
        fetchedAt: new Date().toISOString(),
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      widgetsLogger.error({ error: message }, 'Weather widget fetch failed');
      return reply.status(500).send({ error: `Weather fetch failed: ${message}` });
    }
  });

  // ── Reminders Widget Endpoint ────────────────────────────────────
  app.get('/api/v1/widgets/reminders', async (_request, reply) => {
    try {
      const allJobs = getEnabledCronJobs(db);
      const reminderJobs = allJobs.filter((j) => j.waveId === 'reminders' || !j.waveId);

      const reminders = reminderJobs.map((j) => ({
        id: j.id,
        text: j.taskDescription,
        schedule: j.schedule,
        nextRunAt: j.nextRunAt?.toISOString() ?? null,
        lastRunAt: j.lastRunAt?.toISOString() ?? null,
        lastRunStatus: j.lastRunStatus,
        expiresAt: j.expiresAt?.toISOString() ?? null,
      }));

      // Sort by next run time (soonest first)
      reminders.sort((a, b) => {
        if (!a.nextRunAt) return 1;
        if (!b.nextRunAt) return -1;
        return a.nextRunAt.localeCompare(b.nextRunAt);
      });

      return reply.status(200).send({
        reminders,
        count: reminders.length,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      widgetsLogger.error({ error: message }, 'Reminders widget fetch failed');
      return reply.status(500).send({ error: `Reminders fetch failed: ${message}` });
    }
  });
}
