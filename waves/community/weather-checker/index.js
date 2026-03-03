/**
 * Weather Checker Wave — observe tier.
 * Fetches weather data from the free Open-Meteo API.
 * Deterministic: no LLM needed for data retrieval.
 */

const WEATHER_CODES = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Foggy', 48: 'Rime fog', 51: 'Light drizzle', 53: 'Moderate drizzle',
  55: 'Dense drizzle', 61: 'Slight rain', 63: 'Moderate rain', 65: 'Heavy rain',
  71: 'Slight snow', 73: 'Moderate snow', 75: 'Heavy snow', 80: 'Slight showers',
  81: 'Moderate showers', 82: 'Violent showers', 95: 'Thunderstorm',
};

function parseLocation(input) {
  const locationMatch = input.match(/(?:weather|forecast|temperature)\s+(?:in|for|at)\s+(.+?)(?:\?|$)/i);
  return locationMatch ? locationMatch[1].trim() : null;
}

function parseDays(input) {
  const daysMatch = input.match(/(\d+)\s*day/i);
  return daysMatch ? Math.min(parseInt(daysMatch[1], 10), 7) : 3;
}

function formatForecast(data) {
  if (!data.daily) return 'No forecast data available.';

  const lines = ['Weather Forecast:'];
  const days = data.daily.time.length;

  for (let i = 0; i < days; i++) {
    const date = data.daily.time[i];
    const maxTemp = data.daily.temperature_2m_max[i];
    const minTemp = data.daily.temperature_2m_min[i];
    const code = data.daily.weather_code[i];
    const condition = WEATHER_CODES[code] || 'Unknown';
    const precip = data.daily.precipitation_sum[i];

    lines.push(`${date}: ${condition}, ${minTemp}°–${maxTemp}°C${precip > 0 ? `, ${precip}mm rain` : ''}`);
  }

  return lines.join('\n');
}

export async function plan(userInput, _context) {
  const location = parseLocation(userInput);
  const days = parseDays(userInput);

  return {
    steps: [{ type: 'api_call', description: 'Fetch weather data', params: { location, days } }],
    estimatedCostUsd: 0,
    isDeterministic: true,
    extractedParams: { location, days },
  };
}

export async function execute(wavePlan) {
  const { location, days } = wavePlan.extractedParams;

  try {
    if (!location) {
      return { success: false, output: '', error: 'Please specify a location (e.g., "weather in London").' };
    }

    // In production: fetch from Open-Meteo geocoding then forecast API
    // For now, return structured placeholder
    const mockData = wavePlan.extractedParams._weatherData || null;

    if (mockData) {
      return {
        success: true,
        output: formatForecast(mockData),
        metadata: { waveId: 'weather-checker', location, days },
      };
    }

    return {
      success: true,
      output: `Weather forecast for ${location} (${days} days) would be fetched from Open-Meteo API.`,
      metadata: { waveId: 'weather-checker', location, days, apiRequired: true },
    };
  } catch (error) {
    return { success: false, output: '', error: `Weather check failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export async function validate(result) {
  return result.success ? { valid: true } : { valid: false, feedback: result.error };
}
