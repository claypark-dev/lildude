import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { validateManifest } from '../../../src/waves/schema.js';

const COMMUNITY_DIR = join(process.cwd(), 'waves/community');
const REGISTRY_PATH = join(COMMUNITY_DIR, 'registry.json');

describe('community wave registry', () => {
  it('registry.json is valid JSON', () => {
    const raw = readFileSync(REGISTRY_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.version).toBeDefined();
    expect(parsed.waves).toBeInstanceOf(Array);
  });

  it('contains 20 waves', () => {
    const raw = readFileSync(REGISTRY_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.waves.length).toBe(20);
  });

  it('all entries have required fields', () => {
    const raw = readFileSync(REGISTRY_PATH, 'utf-8');
    const parsed = JSON.parse(raw);

    for (const wave of parsed.waves) {
      expect(wave.name).toBeTruthy();
      expect(wave.description).toBeTruthy();
      expect(wave.author).toBeTruthy();
      expect(wave.source).toMatch(/^github:/);
      expect(wave.triggers).toBeInstanceOf(Array);
      expect(wave.triggers.length).toBeGreaterThan(0);
      expect(wave.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(wave.verified).toBe(true);
    }
  });

  it('all names are unique', () => {
    const raw = readFileSync(REGISTRY_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    const names = parsed.waves.map((w: { name: string }) => w.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('all safety tiers are valid', () => {
    const raw = readFileSync(REGISTRY_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    const validTiers = ['observe', 'create', 'modify', 'destroy', 'execute'];

    for (const wave of parsed.waves) {
      expect(validTiers).toContain(wave.safetyTier);
    }
  });
});

describe('community wave implementations', () => {
  const waveDirs = readdirSync(COMMUNITY_DIR).filter(
    (entry) => entry !== 'registry.json' && existsSync(join(COMMUNITY_DIR, entry, 'wave.json')),
  );

  for (const waveDir of waveDirs) {
    describe(waveDir, () => {
      const wavePath = join(COMMUNITY_DIR, waveDir);

      it('has a valid wave.json manifest', () => {
        const raw = readFileSync(join(wavePath, 'wave.json'), 'utf-8');
        const parsed = JSON.parse(raw);
        const result = validateManifest(parsed);
        expect(result.valid).toBe(true);
      });

      it('has an index.js entry point', () => {
        expect(existsSync(join(wavePath, 'index.js'))).toBe(true);
      });

      it('exports plan, execute, validate functions', async () => {
        const { pathToFileURL } = await import('node:url');
        const moduleUrl = pathToFileURL(join(wavePath, 'index.js')).href;
        const mod = await import(moduleUrl);

        expect(typeof mod.plan).toBe('function');
        expect(typeof mod.execute).toBe('function');
        expect(typeof mod.validate).toBe('function');
      });

      it('plan returns deterministic result', async () => {
        const { pathToFileURL } = await import('node:url');
        const moduleUrl = pathToFileURL(join(wavePath, 'index.js')).href;
        const mod = await import(moduleUrl);

        const result = await mod.plan('test input', {});
        expect(result.isDeterministic).toBe(true);
        expect(result.estimatedCostUsd).toBe(0);
        expect(result.steps).toBeInstanceOf(Array);
      });
    });
  }
});

describe('weather-checker wave', () => {
  it('parses location from input', async () => {
    const { plan } = await import('../../../waves/community/weather-checker/index.js');
    const result = await plan('weather in London', {});
    expect(result.extractedParams.location).toBe('London');
  });

  it('parses days from input', async () => {
    const { plan } = await import('../../../waves/community/weather-checker/index.js');
    const result = await plan('5 day forecast in Paris', {});
    expect(result.extractedParams.days).toBe(5);
  });

  it('caps days at 7', async () => {
    const { plan } = await import('../../../waves/community/weather-checker/index.js');
    const result = await plan('10 day forecast in Tokyo', {});
    expect(result.extractedParams.days).toBe(7);
  });

  it('rejects missing location', async () => {
    const { execute } = await import('../../../waves/community/weather-checker/index.js');
    const result = await execute({ extractedParams: { location: null, days: 3 } });
    expect(result.success).toBe(false);
    expect(result.error).toContain('specify a location');
  });

  it('formats mock weather data', async () => {
    const { execute } = await import('../../../waves/community/weather-checker/index.js');
    const result = await execute({
      extractedParams: {
        location: 'London',
        days: 1,
        _weatherData: {
          daily: {
            time: ['2025-01-06'],
            temperature_2m_max: [8.5],
            temperature_2m_min: [2.1],
            weather_code: [3],
            precipitation_sum: [1.2],
          },
        },
      },
    });
    expect(result.success).toBe(true);
    expect(result.output).toContain('Overcast');
    expect(result.output).toContain('1.2mm');
  });
});

describe('todo-manager wave', () => {
  it('parses add action', async () => {
    const { plan } = await import('../../../waves/community/todo-manager/index.js');
    const result = await plan('add task buy groceries', {});
    expect(result.extractedParams.action).toBe('add');
    expect(result.extractedParams.text).toContain('buy groceries');
  });

  it('parses list action', async () => {
    const { plan } = await import('../../../waves/community/todo-manager/index.js');
    const result = await plan('show my tasks', {});
    expect(result.extractedParams.action).toBe('list');
  });

  it('parses priority', async () => {
    const { plan } = await import('../../../waves/community/todo-manager/index.js');
    const result = await plan('urgent: fix the server', {});
    expect(result.extractedParams.priority).toBe('urgent');
  });

  it('adds a todo', async () => {
    const { execute } = await import('../../../waves/community/todo-manager/index.js');
    const result = await execute({ extractedParams: { action: 'add', text: 'buy milk', priority: 'medium' } });
    expect(result.success).toBe(true);
    expect(result.output).toContain('buy milk');
    expect(result.metadata.action).toBe('add');
  });

  it('rejects empty todo', async () => {
    const { execute } = await import('../../../waves/community/todo-manager/index.js');
    const result = await execute({ extractedParams: { action: 'add', text: '', priority: 'medium' } });
    expect(result.success).toBe(false);
  });
});

describe('timezone-converter wave', () => {
  it('converts current time to a timezone', async () => {
    const { execute } = await import('../../../waves/community/timezone-converter/index.js');
    const result = await execute({ extractedParams: { toTz: 'Asia/Tokyo' } });
    expect(result.success).toBe(true);
    expect(result.output).toContain('Asia/Tokyo');
  });

  it('rejects missing timezone', async () => {
    const { execute } = await import('../../../waves/community/timezone-converter/index.js');
    const result = await execute({ extractedParams: { toTz: null } });
    expect(result.success).toBe(false);
  });

  it('handles timezone aliases', async () => {
    const { plan } = await import('../../../waves/community/timezone-converter/index.js');
    const result = await plan('time in tokyo', {});
    expect(result.extractedParams.toTz).toBe('Asia/Tokyo');
  });
});

describe('unit-converter wave', () => {
  it('converts miles to km', async () => {
    const { execute } = await import('../../../waves/community/unit-converter/index.js');
    const result = await execute({ extractedParams: { value: 10, from: 'miles', to: 'km' } });
    expect(result.success).toBe(true);
    expect(result.metadata.result).toBeCloseTo(16.09, 1);
  });

  it('converts celsius to fahrenheit', async () => {
    const { execute } = await import('../../../waves/community/unit-converter/index.js');
    const result = await execute({ extractedParams: { value: 100, from: 'celsius', to: 'fahrenheit' } });
    expect(result.success).toBe(true);
    expect(result.metadata.result).toBeCloseTo(212, 0);
  });

  it('converts kg to lbs', async () => {
    const { execute } = await import('../../../waves/community/unit-converter/index.js');
    const result = await execute({ extractedParams: { value: 1, from: 'kg', to: 'lbs' } });
    expect(result.success).toBe(true);
    expect(result.metadata.result).toBeCloseTo(2.205, 2);
  });

  it('rejects unknown units', async () => {
    const { execute } = await import('../../../waves/community/unit-converter/index.js');
    const result = await execute({ extractedParams: { value: 10, from: 'wibbles', to: 'km' } });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown unit');
  });

  it('rejects missing input', async () => {
    const { execute } = await import('../../../waves/community/unit-converter/index.js');
    const result = await execute({ extractedParams: { value: null, from: null, to: null } });
    expect(result.success).toBe(false);
  });

  it('parses natural language input', async () => {
    const { plan } = await import('../../../waves/community/unit-converter/index.js');
    const result = await plan('convert 10 miles to km', {});
    expect(result.extractedParams.value).toBe(10);
    expect(result.extractedParams.from).toBe('miles');
    expect(result.extractedParams.to).toBe('km');
  });
});
