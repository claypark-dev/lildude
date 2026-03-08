/**
 * Tests for Sprint 30: ClawHub Converter Tool.
 *
 * Covers:
 * - SKILL.md parser (frontmatter extraction)
 * - Safety tier inference
 * - WaveManifest mapping
 * - index.js code generation
 * - Batch conversion
 * - Env var mappings
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseSkillMd } from '../../../scripts/clawhub-converter/parser.js';
import { inferSafetyTier, inferMinTier } from '../../../scripts/clawhub-converter/safety-mapper.js';
import { mapToWaveManifest } from '../../../scripts/clawhub-converter/mapper.js';
import { generateIndexJs } from '../../../scripts/clawhub-converter/codegen.js';
import { convertSingle, convertBatch, convertFromContents } from '../../../scripts/clawhub-converter/batch.js';
import { getDomainsForEnvVars, inferCategory, ENV_VAR_MAPPINGS } from '../../../scripts/clawhub-converter/clawhub-mappings.js';

// ─── Fixtures ───────────────────────────────────────────────────────────────

const FIXTURE_DIR = join(__dirname, '../../fixtures/clawhub-skills');

const API_SKILL = `---
name: web-search
description: Search the web using Tavily API
version: 1.2.0
metadata:
  openclaw:
    requires:
      env: [TAVILY_API_KEY]
    emoji: "🔍"
---
# Web Search
Search the web for information.
`;

const SHELL_SKILL = `---
name: file-organizer
description: Organize files by type and date
version: 1.0.0
metadata:
  openclaw:
    requires:
      bins: [mv, mkdir, find]
    emoji: "📁"
---
# File Organizer
Sort files into subdirectories.
`;

const DESTRUCTIVE_SKILL = `---
name: disk-cleaner
description: Clean up temporary files
version: 1.0.0
metadata:
  openclaw:
    requires:
      bins: [rm, find, du]
    emoji: "🧹"
---
# Disk Cleaner
Remove temporary files safely.
`;

const BASIC_SKILL = `---
name: simple-note
description: Take and retrieve text notes
version: 1.0.0
metadata:
  openclaw:
    emoji: "📝"
---
# Simple Note
A basic note-taking skill.
`;

const MULTI_ENV_SKILL = `---
name: slack-github-bridge
description: Bridge Slack messages to GitHub issues
version: 1.0.0
metadata:
  openclaw:
    requires:
      env: [SLACK_BOT_TOKEN, GITHUB_TOKEN]
    emoji: "🔗"
---
# Slack-GitHub Bridge
Convert Slack conversations into GitHub issues.
`;

// ─── Parser Tests ───────────────────────────────────────────────────────────

describe('parseSkillMd', () => {
  it('parses API skill with env vars', () => {
    const skill = parseSkillMd(API_SKILL);
    expect(skill.name).toBe('web-search');
    expect(skill.description).toBe('Search the web using Tavily API');
    expect(skill.version).toBe('1.2.0');
    expect(skill.metadata.openclaw?.requires?.env).toEqual(['TAVILY_API_KEY']);
    expect(skill.metadata.openclaw?.emoji).toBe('🔍');
    expect(skill.body).toContain('Web Search');
  });

  it('parses shell skill with bins', () => {
    const skill = parseSkillMd(SHELL_SKILL);
    expect(skill.name).toBe('file-organizer');
    expect(skill.metadata.openclaw?.requires?.bins).toEqual(['mv', 'mkdir', 'find']);
  });

  it('parses basic skill with no requires', () => {
    const skill = parseSkillMd(BASIC_SKILL);
    expect(skill.name).toBe('simple-note');
    expect(skill.metadata.openclaw?.requires?.env).toBeUndefined();
    expect(skill.metadata.openclaw?.requires?.bins).toBeUndefined();
  });

  it('parses skill with multiple env vars', () => {
    const skill = parseSkillMd(MULTI_ENV_SKILL);
    expect(skill.metadata.openclaw?.requires?.env).toEqual(['SLACK_BOT_TOKEN', 'GITHUB_TOKEN']);
  });

  it('defaults version to 1.0.0 when not specified', () => {
    const content = `---
name: test-skill
description: Test
---
Body text`;
    const skill = parseSkillMd(content);
    expect(skill.version).toBe('1.0.0');
  });

  it('throws for missing frontmatter', () => {
    expect(() => parseSkillMd('Just text, no frontmatter')).toThrow('missing YAML frontmatter');
  });

  it('throws for missing closing delimiter', () => {
    expect(() => parseSkillMd('---\nname: test\n')).toThrow('missing closing frontmatter');
  });

  it('throws for missing name field', () => {
    expect(() => parseSkillMd('---\ndescription: Test\n---\nBody')).toThrow('missing required field: name');
  });

  it('throws for missing description field', () => {
    expect(() => parseSkillMd('---\nname: test\n---\nBody')).toThrow('missing required field: description');
  });

  it('extracts body content correctly', () => {
    const skill = parseSkillMd(API_SKILL);
    expect(skill.body).toContain('# Web Search');
    expect(skill.body).toContain('Search the web for information.');
    expect(skill.body).not.toContain('name:');
  });
});

// ─── Safety Tier Tests ──────────────────────────────────────────────────────

describe('inferSafetyTier', () => {
  it('returns observe for no requirements', () => {
    expect(inferSafetyTier([], [])).toBe('observe');
    expect(inferSafetyTier(undefined, undefined)).toBe('observe');
  });

  it('returns create for env-only skills', () => {
    expect(inferSafetyTier(['TAVILY_API_KEY'], [])).toBe('create');
    expect(inferSafetyTier(['SLACK_BOT_TOKEN', 'GITHUB_TOKEN'])).toBe('create');
  });

  it('returns modify for non-destructive bins', () => {
    expect(inferSafetyTier([], ['mv', 'mkdir', 'find'])).toBe('modify');
    expect(inferSafetyTier([], ['git', 'npm'])).toBe('modify');
  });

  it('returns destroy for destructive bins', () => {
    expect(inferSafetyTier([], ['rm', 'find'])).toBe('destroy');
    expect(inferSafetyTier([], ['kill', 'killall'])).toBe('destroy');
  });

  it('returns execute for unknown bins', () => {
    expect(inferSafetyTier([], ['custom-tool'])).toBe('execute');
    expect(inferSafetyTier([], ['my-script'])).toBe('execute');
  });

  it('returns observe for read-only bins', () => {
    expect(inferSafetyTier([], ['cat', 'ls', 'grep'])).toBe('observe');
  });

  it('destructive takes priority over modify', () => {
    expect(inferSafetyTier([], ['mv', 'rm'])).toBe('destroy');
  });

  it('unknown takes priority over modify', () => {
    expect(inferSafetyTier([], ['mv', 'custom-tool'])).toBe('execute');
  });
});

describe('inferMinTier', () => {
  it('maps observe to basic', () => {
    expect(inferMinTier('observe')).toBe('basic');
  });

  it('maps create to standard', () => {
    expect(inferMinTier('create')).toBe('standard');
  });

  it('maps modify/destroy/execute to power', () => {
    expect(inferMinTier('modify')).toBe('power');
    expect(inferMinTier('destroy')).toBe('power');
    expect(inferMinTier('execute')).toBe('power');
  });
});

// ─── Env Var Mapping Tests ──────────────────────────────────────────────────

describe('getDomainsForEnvVars', () => {
  it('returns domains for known env vars', () => {
    const domains = getDomainsForEnvVars(['TAVILY_API_KEY']);
    expect(domains).toContain('api.tavily.com');
  });

  it('returns multiple domains for multiple env vars', () => {
    const domains = getDomainsForEnvVars(['SLACK_BOT_TOKEN', 'GITHUB_TOKEN']);
    expect(domains).toContain('slack.com');
    expect(domains).toContain('api.github.com');
  });

  it('returns empty for unknown env vars', () => {
    const domains = getDomainsForEnvVars(['UNKNOWN_VAR']);
    expect(domains).toEqual([]);
  });

  it('deduplicates domains', () => {
    const domains = getDomainsForEnvVars(['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY']);
    expect(domains).toEqual(['amazonaws.com']);
  });
});

describe('inferCategory', () => {
  it('infers utilities for search-related env vars', () => {
    expect(inferCategory(['TAVILY_API_KEY'])).toBe('utilities');
  });

  it('infers communication for Slack/Discord', () => {
    expect(inferCategory(['SLACK_BOT_TOKEN'])).toBe('communication');
  });

  it('infers development for GitHub', () => {
    expect(inferCategory(['GITHUB_TOKEN'])).toBe('development');
  });

  it('returns majority category for mixed env vars', () => {
    expect(inferCategory(['SLACK_BOT_TOKEN', 'DISCORD_BOT_TOKEN', 'GITHUB_TOKEN'])).toBe('communication');
  });
});

describe('ENV_VAR_MAPPINGS', () => {
  it('has entries for common API keys', () => {
    expect(ENV_VAR_MAPPINGS).toHaveProperty('OPENAI_API_KEY');
    expect(ENV_VAR_MAPPINGS).toHaveProperty('GITHUB_TOKEN');
    expect(ENV_VAR_MAPPINGS).toHaveProperty('TAVILY_API_KEY');
  });

  it('each mapping has a description', () => {
    for (const [key, mapping] of Object.entries(ENV_VAR_MAPPINGS)) {
      expect(mapping.description, `${key} missing description`).toBeDefined();
      expect(mapping.description.length, `${key} empty description`).toBeGreaterThan(0);
    }
  });
});

// ─── Mapper Tests ───────────────────────────────────────────────────────────

describe('mapToWaveManifest', () => {
  it('maps API skill correctly', () => {
    const skill = parseSkillMd(API_SKILL);
    const manifest = mapToWaveManifest(skill);

    expect(manifest.name).toBe('web-search');
    expect(manifest.version).toBe('1.2.0');
    expect(manifest.author).toBe('clawhub-community');
    expect(manifest.safetyTier).toBe('create');
    expect(manifest.minTier).toBe('standard');
    expect(manifest.deterministic).toBe(true);
    expect(manifest.permissions.domains).toContain('api.tavily.com');
    expect(manifest.permissions.shell).toEqual([]);
    expect(manifest.entryPoint).toBe('index.js');
    expect(manifest.triggers.length).toBeGreaterThan(0);
  });

  it('maps shell skill correctly', () => {
    const skill = parseSkillMd(SHELL_SKILL);
    const manifest = mapToWaveManifest(skill);

    expect(manifest.safetyTier).toBe('modify');
    expect(manifest.minTier).toBe('power');
    expect(manifest.deterministic).toBe(false);
    expect(manifest.permissions.shell).toEqual(['mv', 'mkdir', 'find']);
  });

  it('maps destructive skill correctly', () => {
    const skill = parseSkillMd(DESTRUCTIVE_SKILL);
    const manifest = mapToWaveManifest(skill);

    expect(manifest.safetyTier).toBe('destroy');
    expect(manifest.minTier).toBe('power');
  });

  it('maps basic skill correctly', () => {
    const skill = parseSkillMd(BASIC_SKILL);
    const manifest = mapToWaveManifest(skill);

    expect(manifest.safetyTier).toBe('observe');
    expect(manifest.minTier).toBe('basic');
    expect(manifest.deterministic).toBe(true);
  });

  it('uses author override when provided', () => {
    const skill = parseSkillMd(API_SKILL);
    const manifest = mapToWaveManifest(skill, 'my-author');
    expect(manifest.author).toBe('my-author');
  });

  it('generates at least one tool', () => {
    const skill = parseSkillMd(API_SKILL);
    const manifest = mapToWaveManifest(skill);

    expect(manifest.tools.length).toBeGreaterThan(0);
    expect(manifest.tools[0].name).toBe('web_search');
    expect(manifest.tools[0].parameters).toHaveProperty('input');
  });

  it('generates triggers from name and description', () => {
    const skill = parseSkillMd(API_SKILL);
    const manifest = mapToWaveManifest(skill);

    expect(manifest.triggers).toContain('web search');
    expect(manifest.triggers.length).toBeGreaterThanOrEqual(2);
    expect(manifest.triggers.length).toBeLessThanOrEqual(8);
  });

  it('adds args parameter for shell skills', () => {
    const skill = parseSkillMd(SHELL_SKILL);
    const manifest = mapToWaveManifest(skill);

    expect(manifest.tools[0].parameters).toHaveProperty('args');
  });
});

// ─── Codegen Tests ──────────────────────────────────────────────────────────

describe('generateIndexJs', () => {
  it('generates basic wave code', () => {
    const skill = parseSkillMd(BASIC_SKILL);
    const manifest = mapToWaveManifest(skill);
    const code = generateIndexJs(skill, manifest);

    expect(code).toContain('export async function plan');
    expect(code).toContain('export async function execute');
    expect(code).toContain('export async function validate');
    expect(code).toContain('simple-note');
  });

  it('generates API wave with fetch call', () => {
    const skill = parseSkillMd(API_SKILL);
    const manifest = mapToWaveManifest(skill);
    const code = generateIndexJs(skill, manifest);

    expect(code).toContain('TAVILY_API_KEY');
    expect(code).toContain('fetch');
    expect(code).toContain('api.tavily.com');
    expect(code).toContain('Missing env');
  });

  it('generates shell wave with execFile', () => {
    const skill = parseSkillMd(SHELL_SKILL);
    const manifest = mapToWaveManifest(skill);
    const code = generateIndexJs(skill, manifest);

    expect(code).toContain('execFile');
    expect(code).toContain('ALLOWED_BINS');
    expect(code).toContain('timeout');
  });

  it('includes instructions from body', () => {
    const skill = parseSkillMd(API_SKILL);
    const manifest = mapToWaveManifest(skill);
    const code = generateIndexJs(skill, manifest);

    expect(code).toContain('INSTRUCTIONS');
    expect(code).toContain('Web Search');
  });

  it('escapes template string characters in body', () => {
    const skillWithBackticks = `---
name: code-runner
description: Run code snippets
version: 1.0.0
---
Use \`backticks\` for code and $variables.
`;
    const skill = parseSkillMd(skillWithBackticks);
    const manifest = mapToWaveManifest(skill);
    const code = generateIndexJs(skill, manifest);

    // Should not have unescaped backticks or $ in template string
    expect(code).toContain('\\`');
    expect(code).toContain('\\$');
  });

  it('sets isDeterministic correctly for API skills', () => {
    const skill = parseSkillMd(API_SKILL);
    const manifest = mapToWaveManifest(skill);
    const code = generateIndexJs(skill, manifest);

    expect(code).toContain('isDeterministic: true');
  });

  it('sets isDeterministic to false for shell skills', () => {
    const skill = parseSkillMd(SHELL_SKILL);
    const manifest = mapToWaveManifest(skill);
    const code = generateIndexJs(skill, manifest);

    expect(code).toContain('isDeterministic: false');
  });
});

// ─── Batch Conversion Tests ─────────────────────────────────────────────────

describe('convertSingle', () => {
  let outputDir: string;

  beforeEach(() => {
    outputDir = join(tmpdir(), `clawhub-test-${Date.now()}`);
    mkdirSync(outputDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(outputDir, { recursive: true, force: true });
  });

  it('converts a fixture SKILL.md to wave directory', () => {
    const skillPath = join(FIXTURE_DIR, 'web-search', 'SKILL.md');
    const result = convertSingle(skillPath, outputDir);

    expect(result.success).toBe(true);
    expect(result.name).toBe('web-search');
    expect(result.manifest).toBeDefined();
    expect(result.outputDir).toBeDefined();

    // Check files were created
    const waveJson = JSON.parse(readFileSync(join(result.outputDir!, 'wave.json'), 'utf-8'));
    expect(waveJson.name).toBe('web-search');
    expect(waveJson.safetyTier).toBe('create');

    const indexJs = readFileSync(join(result.outputDir!, 'index.js'), 'utf-8');
    expect(indexJs).toContain('export async function plan');
  });

  it('returns error for invalid SKILL.md', () => {
    const badPath = join(outputDir, 'bad-skill.md');
    writeFileSync(badPath, 'No frontmatter here');

    const result = convertSingle(badPath, outputDir);
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

describe('convertBatch', () => {
  let outputDir: string;

  beforeEach(() => {
    outputDir = join(tmpdir(), `clawhub-batch-${Date.now()}`);
  });

  afterEach(() => {
    rmSync(outputDir, { recursive: true, force: true });
  });

  it('converts all fixture skills', () => {
    const result = convertBatch(FIXTURE_DIR, outputDir);

    expect(result.total).toBeGreaterThanOrEqual(6);
    expect(result.succeeded).toBe(result.total);
    expect(result.failed).toBe(0);

    // Verify each wave directory exists
    for (const r of result.results) {
      expect(r.success).toBe(true);
      expect(existsSync(join(r.outputDir!, 'wave.json'))).toBe(true);
      expect(existsSync(join(r.outputDir!, 'index.js'))).toBe(true);
    }
  });

  it('generates valid wave.json manifests', () => {
    const result = convertBatch(FIXTURE_DIR, outputDir);

    for (const r of result.results) {
      const manifest = JSON.parse(readFileSync(join(r.outputDir!, 'wave.json'), 'utf-8'));
      expect(manifest.name).toBeDefined();
      expect(manifest.version).toBeDefined();
      expect(manifest.description).toBeDefined();
      expect(manifest.author).toBeDefined();
      expect(manifest.entryPoint).toBe('index.js');
      expect(manifest.triggers).toBeInstanceOf(Array);
      expect(manifest.triggers.length).toBeGreaterThan(0);
      expect(['observe', 'create', 'modify', 'destroy', 'execute']).toContain(manifest.safetyTier);
      expect(['basic', 'standard', 'power']).toContain(manifest.minTier);
    }
  });
});

describe('convertFromContents', () => {
  let outputDir: string;

  beforeEach(() => {
    outputDir = join(tmpdir(), `clawhub-contents-${Date.now()}`);
  });

  afterEach(() => {
    rmSync(outputDir, { recursive: true, force: true });
  });

  it('converts skill contents from strings', () => {
    const result = convertFromContents(
      [
        { name: 'api-skill', content: API_SKILL },
        { name: 'basic-skill', content: BASIC_SKILL },
      ],
      outputDir,
    );

    expect(result.total).toBe(2);
    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(0);
  });

  it('handles mixed valid and invalid content', () => {
    const result = convertFromContents(
      [
        { name: 'valid', content: API_SKILL },
        { name: 'invalid', content: 'not a valid skill file' },
      ],
      outputDir,
    );

    expect(result.total).toBe(2);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(1);
  });

  it('uses author override', () => {
    const result = convertFromContents(
      [{ name: 'test', content: API_SKILL }],
      outputDir,
      'custom-author',
    );

    expect(result.results[0].manifest?.author).toBe('custom-author');
  });
});
