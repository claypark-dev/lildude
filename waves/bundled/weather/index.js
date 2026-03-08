/**
 * Weather Wave — check current weather conditions for any location.
 * DETERMINISTIC: no LLM calls needed for execution.
 * Uses Open-Meteo API (free, no API key required).
 *
 * Exports: plan, execute, validate
 */

// ── WMO Weather Code descriptions ────────────────────────────────────────────

const WMO_CODES = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Foggy',
  48: 'Depositing rime fog',
  51: 'Light drizzle',
  53: 'Moderate drizzle',
  55: 'Dense drizzle',
  56: 'Light freezing drizzle',
  57: 'Dense freezing drizzle',
  61: 'Slight rain',
  63: 'Moderate rain',
  65: 'Heavy rain',
  66: 'Light freezing rain',
  67: 'Heavy freezing rain',
  71: 'Slight snowfall',
  73: 'Moderate snowfall',
  75: 'Heavy snowfall',
  77: 'Snow grains',
  80: 'Slight rain showers',
  81: 'Moderate rain showers',
  82: 'Violent rain showers',
  85: 'Slight snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with slight hail',
  99: 'Thunderstorm with heavy hail',
};

// ── Weather emoji helper ─────────────────────────────────────────────────────

function weatherEmoji(code) {
  if (code === 0 || code === 1) return '☀️';
  if (code === 2) return '⛅';
  if (code === 3) return '☁️';
  if (code >= 45 && code <= 48) return '🌫️';
  if (code >= 51 && code <= 57) return '🌧️';
  if (code >= 61 && code <= 67) return '🌧️';
  if (code >= 71 && code <= 77) return '❄️';
  if (code >= 80 && code <= 82) return '🌦️';
  if (code >= 85 && code <= 86) return '🌨️';
  if (code >= 95) return '⛈️';
  return '🌡️';
}

// ── Location parsing ─────────────────────────────────────────────────────────

/**
 * Parse location names from user input.
 * Handles comma-separated and "and"-separated lists.
 * @param {string} input
 * @returns {string[]}
 */
function parseLocations(input) {
  let cleaned = input;

  // Remove common prefixes
  cleaned = cleaned.replace(
    /^(what('?s| is) the )?weather (for|in|at|of|near|around)\s+/i, ''
  );
  cleaned = cleaned.replace(
    /^(check|get|show|tell me)( the)? weather (for|in|at|of)\s+/i, ''
  );
  cleaned = cleaned.replace(/^weather (for|in|at|of)\s+/i, '');
  cleaned = cleaned.replace(/^(how('?s| is) the weather (in|at|for))\s+/i, '');
  cleaned = cleaned.replace(/^(temperature|forecast) (for|in|at)\s+/i, '');

  // Strip conversational phrasing before "weather for/in/at" (e.g., "can you ping me with the weather for")
  cleaned = cleaned.replace(/^.*?\b(?:the\s+)?weather\s+(for|in|at|of)\s+/i, '');

  // Remove bare trigger words when they are the only content (no location follows)
  cleaned = cleaned.replace(/^(weather|forecast|temperature)$/i, '');

  // Remove scheduling phrases (handled separately)
  cleaned = cleaned.replace(
    /\bevery\s+\d+\s*(min(ute)?s?|hours?)\b/gi, ''
  );
  cleaned = cleaned.replace(
    /\bfor\s+the\s+next\s+(\d+\s*)?(hours?|minutes?)\b/gi, ''
  );
  cleaned = cleaned.replace(/\bevery\s+(hour|day|minute)\b/gi, '');

  // Clean up
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  if (!cleaned) return [];

  // Split on comma, "and", "&"
  const parts = cleaned
    .split(/\s*(?:,\s*(?:and\s+)?|\s+and\s+|\s*&\s*)\s*/i)
    .map(s => s.trim())
    .filter(s => s.length > 0);

  return parts;
}

/**
 * Detect recurring schedule pattern from input.
 * @param {string} input
 * @returns {{ cronSchedule: string, expiresAt?: string } | null}
 */
function detectSchedule(input) {
  // "every N minutes"
  const everyMinMatch = input.match(/\bevery\s+(\d+)\s*min(ute)?s?\b/i);
  if (everyMinMatch) {
    const mins = parseInt(everyMinMatch[1], 10);
    const cronSchedule = `*/${mins} * * * *`;

    // Check for "for the next N hours/minutes"
    const expiresAt = parseExpiry(input);

    return { cronSchedule, expiresAt };
  }

  // "every hour"
  const everyHourMatch = input.match(/\bevery\s+hour\b/i);
  if (everyHourMatch) {
    const expiresAt = parseExpiry(input);
    return { cronSchedule: '0 * * * *', expiresAt };
  }

  return null;
}

/**
 * Parse "for the next N hours/minutes" into an ISO expiry timestamp.
 * @param {string} input
 * @returns {string | undefined}
 */
function parseExpiry(input) {
  // "for the next 2 hours", "for the next 30 minutes"
  const forMatch = input.match(
    /\bfor\s+the\s+next\s+(\d+)\s*(hours?|minutes?)\b/i
  );
  if (forMatch) {
    const amount = parseInt(forMatch[1], 10);
    const unit = forMatch[2].toLowerCase().startsWith('h') ? 'hours' : 'minutes';
    const ms = unit === 'hours' ? amount * 3_600_000 : amount * 60_000;
    return new Date(Date.now() + ms).toISOString();
  }

  // "for the next hour" / "for the next minute" (implied 1)
  const forSingleMatch = input.match(
    /\bfor\s+the\s+next\s+(hour|minute)\b/i
  );
  if (forSingleMatch) {
    const unit = forSingleMatch[1].toLowerCase().startsWith('h') ? 'hours' : 'minutes';
    const ms = unit === 'hours' ? 3_600_000 : 60_000;
    return new Date(Date.now() + ms).toISOString();
  }

  return undefined;
}

// ── Open-Meteo API ───────────────────────────────────────────────────────────

/**
 * @typedef {{ name: string, latitude: number, longitude: number, country: string, admin1?: string }} GeoResult
 */

/**
 * Geocode a location name to latitude/longitude via Open-Meteo Geocoding API.
 * @param {string} name - Location name (e.g., "Seattle", "Snoqualmie Pass").
 * @returns {Promise<GeoResult>}
 */
async function geocodeLocation(name) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=en&format=json`;

  const response = await fetch(url, {
    headers: { 'User-Agent': 'lil-dude/1.0' },
  });

  if (!response.ok) {
    throw new Error(`Geocoding API returned ${response.status} for "${name}"`);
  }

  const data = /** @type {Record<string, unknown>} */ (await response.json());

  if (!data.results || !Array.isArray(data.results) || data.results.length === 0) {
    throw new Error(`Location not found: "${name}"`);
  }

  const result = data.results[0];
  return {
    name: result.name || name,
    latitude: result.latitude,
    longitude: result.longitude,
    country: result.country || '',
    admin1: result.admin1,
  };
}

/**
 * @typedef {{ temperature: number, feelsLike: number, humidity: number, windSpeed: number, windDirection: number, weatherCode: number, isDay: boolean, precipitation: number }} CurrentWeather
 */

/**
 * Fetch current weather conditions from Open-Meteo API.
 * @param {number} latitude
 * @param {number} longitude
 * @returns {Promise<CurrentWeather>}
 */
async function fetchWeather(latitude, longitude) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m,is_day&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch`;

  const response = await fetch(url, {
    headers: { 'User-Agent': 'lil-dude/1.0' },
  });

  if (!response.ok) {
    throw new Error(`Weather API returned ${response.status}`);
  }

  const data = /** @type {Record<string, unknown>} */ (await response.json());

  if (!data.current || typeof data.current !== 'object') {
    throw new Error('Unexpected weather API response structure');
  }

  const current = /** @type {Record<string, unknown>} */ (data.current);

  return {
    temperature: /** @type {number} */ (current.temperature_2m) || 0,
    feelsLike: /** @type {number} */ (current.apparent_temperature) || 0,
    humidity: /** @type {number} */ (current.relative_humidity_2m) || 0,
    windSpeed: /** @type {number} */ (current.wind_speed_10m) || 0,
    windDirection: /** @type {number} */ (current.wind_direction_10m) || 0,
    weatherCode: /** @type {number} */ (current.weather_code) ?? 0,
    isDay: /** @type {number} */ (current.is_day) === 1,
    precipitation: /** @type {number} */ (current.precipitation) || 0,
  };
}

// ── Formatting ───────────────────────────────────────────────────────────────

/**
 * Format weather data into a human-readable string.
 * @param {GeoResult} geo
 * @param {CurrentWeather} weather
 * @returns {string}
 */
function formatWeather(geo, weather) {
  const description = WMO_CODES[weather.weatherCode] || 'Unknown';
  const emoji = weatherEmoji(weather.weatherCode);
  const locationLabel = geo.admin1
    ? `${geo.name}, ${geo.admin1}`
    : `${geo.name}, ${geo.country}`;

  const lines = [
    `${emoji} ${locationLabel}: ${description}`,
    `  🌡️ ${weather.temperature.toFixed(0)}°F (feels like ${weather.feelsLike.toFixed(0)}°F)`,
    `  💧 Humidity: ${weather.humidity}%`,
    `  💨 Wind: ${weather.windSpeed.toFixed(0)} mph`,
  ];

  if (weather.precipitation > 0) {
    lines.push(`  🌧️ Precipitation: ${weather.precipitation.toFixed(2)} in`);
  }

  return lines.join('\n');
}

// ── Wave exports ─────────────────────────────────────────────────────────────

/**
 * Plan: parse user input for location(s) and optional schedule.
 * @param {string} userInput
 * @param {Record<string, unknown>} _context
 * @returns {Promise<import('../../../src/types/index.js').WavePlan>}
 */
export async function plan(userInput, _context) {
  const locations = parseLocations(userInput);
  const schedule = detectSchedule(userInput);

  /** @type {Record<string, unknown>} */
  const extractedParams = {
    locations: locations.length > 0 ? locations : null,
    cronSchedule: schedule?.cronSchedule ?? null,
    expiresAt: schedule?.expiresAt ?? null,
    parseError: locations.length === 0 ? 'No location found in input' : null,
  };

  return {
    steps: [
      {
        type: 'api_call',
        description: 'Fetch weather conditions from Open-Meteo',
        params: extractedParams,
      },
    ],
    estimatedCostUsd: 0,
    isDeterministic: true,
    extractedParams,
  };
}

/**
 * Execute: fetch weather for one or more locations.
 * @param {import('../../../src/types/index.js').WavePlan} wavePlan
 * @returns {Promise<import('../../../src/types/index.js').ToolResult>}
 */
export async function execute(wavePlan) {
  const params = wavePlan.extractedParams;

  if (params.parseError) {
    return {
      success: false,
      output: '',
      error: String(params.parseError),
    };
  }

  const locations = /** @type {string[]} */ (params.locations);
  if (!locations || locations.length === 0) {
    return {
      success: false,
      output: '',
      error: 'No location provided',
    };
  }

  /** @type {string[]} */
  const reports = [];
  /** @type {string[]} */
  const errors = [];

  // Fetch weather for each location (in parallel for performance)
  const results = await Promise.allSettled(
    locations.map(async (loc) => {
      const geo = await geocodeLocation(loc);
      const weather = await fetchWeather(geo.latitude, geo.longitude);
      return { geo, weather };
    })
  );

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === 'fulfilled') {
      reports.push(formatWeather(result.value.geo, result.value.weather));
    } else {
      const msg = result.reason instanceof Error ? result.reason.message : String(result.reason);
      errors.push(`${locations[i]}: ${msg}`);
    }
  }

  if (reports.length === 0) {
    return {
      success: false,
      output: `Failed to fetch weather:\n${errors.join('\n')}`,
      error: errors.join('; '),
    };
  }

  const output = reports.join('\n\n');
  const hasErrors = errors.length > 0;
  const fullOutput = hasErrors ? `${output}\n\nErrors:\n${errors.join('\n')}` : output;

  /** @type {Record<string, unknown>} */
  const metadata = {
    locations,
    fetchedAt: new Date().toISOString(),
  };

  // If a recurring schedule was detected, signal cron job creation
  const cronSchedule = params.cronSchedule;
  if (cronSchedule) {
    metadata.action = 'create_cron_job';
    metadata.cronSchedule = cronSchedule;
    metadata.taskDescription = `Weather check for ${locations.join(', ')}`;
    metadata.waveId = 'weather';
    metadata.usesAi = false;
    metadata.estimatedCostPerRun = 0;
    if (params.expiresAt) {
      metadata.expiresAt = params.expiresAt;
    }
  }

  return {
    success: true,
    output: fullOutput,
    metadata,
  };
}

/**
 * Validate: check that output contains expected weather data.
 * @param {import('../../../src/types/index.js').ToolResult} result
 * @returns {Promise<{ valid: boolean, feedback?: string }>}
 */
export async function validate(result) {
  if (!result.success) {
    return { valid: true }; // Errors are already handled
  }

  const output = result.output;

  // Should contain temperature and location info
  const hasTemp = /°F/.test(output);
  const hasLocation = output.length > 10;

  if (!hasTemp || !hasLocation) {
    return {
      valid: false,
      feedback: 'Output missing expected temperature or location data',
    };
  }

  return { valid: true };
}
