/**
 * Unit Converter Wave — observe tier.
 * Converts between units of measurement using deterministic math.
 * Supports length, weight, temperature, and volume.
 */

const CONVERSIONS = {
  // Length (all to meters)
  m: 1, km: 1000, cm: 0.01, mm: 0.001, mi: 1609.344, yd: 0.9144, ft: 0.3048, in: 0.0254,
  mile: 1609.344, miles: 1609.344, yard: 0.9144, yards: 0.9144, feet: 0.3048, inch: 0.0254, inches: 0.0254,
  meter: 1, meters: 1, kilometer: 1000, kilometers: 1000, centimeter: 0.01, centimeters: 0.01,
  // Weight (all to grams)
  g: 1, kg: 1000, mg: 0.001, lb: 453.592, lbs: 453.592, oz: 28.3495, ton: 907185,
  gram: 1, grams: 1, kilogram: 1000, kilograms: 1000, pound: 453.592, pounds: 453.592, ounce: 28.3495, ounces: 28.3495,
  // Volume (all to liters)
  l: 1, ml: 0.001, gal: 3.78541, gallon: 3.78541, gallons: 3.78541, cup: 0.236588, cups: 0.236588,
  liter: 1, liters: 1, milliliter: 0.001, milliliters: 0.001,
};

const TEMP_UNITS = ['c', 'f', 'k', 'celsius', 'fahrenheit', 'kelvin'];

function isTemp(unit) { return TEMP_UNITS.includes(unit.toLowerCase()); }
function normTemp(unit) {
  const u = unit.toLowerCase();
  if (u === 'celsius' || u === 'c') return 'C';
  if (u === 'fahrenheit' || u === 'f') return 'F';
  if (u === 'kelvin' || u === 'k') return 'K';
  return u;
}

function convertTemp(value, from, to) {
  const f = normTemp(from);
  const t = normTemp(to);
  let celsius;
  if (f === 'C') celsius = value;
  else if (f === 'F') celsius = (value - 32) * 5 / 9;
  else if (f === 'K') celsius = value - 273.15;
  else return null;

  if (t === 'C') return celsius;
  if (t === 'F') return celsius * 9 / 5 + 32;
  if (t === 'K') return celsius + 273.15;
  return null;
}

function parseConversion(input) {
  const match = input.match(/(\d+(?:\.\d+)?)\s*([a-zA-Z]+)\s+(?:to|in|as)\s+([a-zA-Z]+)/i);
  if (match) return { value: parseFloat(match[1]), from: match[2], to: match[3] };
  return { value: null, from: null, to: null };
}

export async function plan(userInput, _context) {
  const parsed = parseConversion(userInput);
  return {
    steps: [{ type: 'compute', description: 'Convert units', params: parsed }],
    estimatedCostUsd: 0, isDeterministic: true, extractedParams: parsed,
  };
}

export async function execute(wavePlan) {
  const { value, from, to } = wavePlan.extractedParams;
  try {
    if (value === null || !from || !to) {
      return { success: false, output: '', error: 'Format: "10 miles to km" or "100 fahrenheit to celsius"' };
    }
    if (isTemp(from) && isTemp(to)) {
      const result = convertTemp(value, from, to);
      if (result === null) return { success: false, output: '', error: `Cannot convert ${from} to ${to}` };
      return {
        success: true,
        output: `${value} ${from} = ${result.toFixed(2)} ${to}`,
        metadata: { waveId: 'unit-converter', value, from, to, result },
      };
    }
    const fromFactor = CONVERSIONS[from.toLowerCase()];
    const toFactor = CONVERSIONS[to.toLowerCase()];
    if (!fromFactor || !toFactor) {
      return { success: false, output: '', error: `Unknown unit: ${!fromFactor ? from : to}` };
    }
    const result = (value * fromFactor) / toFactor;
    return {
      success: true,
      output: `${value} ${from} = ${result.toFixed(4)} ${to}`,
      metadata: { waveId: 'unit-converter', value, from, to, result },
    };
  } catch (error) {
    return { success: false, output: '', error: `Conversion failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export async function validate(result) {
  return result.success ? { valid: true } : { valid: false, feedback: result.error };
}
