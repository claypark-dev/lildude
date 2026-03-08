/**
 * Batch converter for ClawHub SKILL.md files.
 * Processes a directory of skills and outputs lildude wave directories.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseSkillMd } from './parser.js';
import { mapToWaveManifest, type WaveManifestOutput } from './mapper.js';
import { generateIndexJs } from './codegen.js';

export interface ConversionResult {
  name: string;
  success: boolean;
  error?: string;
  manifest?: WaveManifestOutput;
  outputDir?: string;
}

export interface BatchResult {
  total: number;
  succeeded: number;
  failed: number;
  results: ConversionResult[];
}

/**
 * Convert a single SKILL.md file to a lildude wave directory.
 *
 * @param skillMdPath - Path to the SKILL.md file.
 * @param outputDir - Base output directory for wave directories.
 * @param author - Optional author name override.
 * @returns The conversion result.
 */
export function convertSingle(
  skillMdPath: string,
  outputDir: string,
  author?: string,
): ConversionResult {
  try {
    const content = readFileSync(skillMdPath, 'utf-8');
    const skill = parseSkillMd(content);
    const manifest = mapToWaveManifest(skill, author);
    const indexJs = generateIndexJs(skill, manifest);

    // Create wave directory
    const waveDir = join(outputDir, manifest.name);
    mkdirSync(waveDir, { recursive: true });

    // Write wave.json
    writeFileSync(
      join(waveDir, 'wave.json'),
      JSON.stringify(manifest, null, 2) + '\n',
    );

    // Write index.js
    writeFileSync(join(waveDir, 'index.js'), indexJs);

    return {
      name: manifest.name,
      success: true,
      manifest,
      outputDir: waveDir,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      name: skillMdPath,
      success: false,
      error: message,
    };
  }
}

/**
 * Batch convert all SKILL.md files in a directory.
 *
 * Expects directory structure:
 * ```
 * inputDir/
 *   skill-name-1/
 *     SKILL.md
 *   skill-name-2/
 *     SKILL.md
 * ```
 *
 * @param inputDir - Directory containing skill subdirectories.
 * @param outputDir - Base output directory for wave directories.
 * @param author - Optional author name override.
 * @returns Batch conversion results.
 */
export function convertBatch(
  inputDir: string,
  outputDir: string,
  author?: string,
): BatchResult {
  const resolvedInput = resolve(inputDir);
  const resolvedOutput = resolve(outputDir);

  mkdirSync(resolvedOutput, { recursive: true });

  const entries = readdirSync(resolvedInput);
  const results: ConversionResult[] = [];

  for (const entry of entries) {
    const entryPath = join(resolvedInput, entry);

    // Check if entry is a directory
    if (!statSync(entryPath).isDirectory()) continue;

    // Look for SKILL.md in the directory
    const skillMdPath = join(entryPath, 'SKILL.md');
    if (!existsSync(skillMdPath)) continue;

    const result = convertSingle(skillMdPath, resolvedOutput, author);
    results.push(result);
  }

  const succeeded = results.filter((r) => r.success).length;

  return {
    total: results.length,
    succeeded,
    failed: results.length - succeeded,
    results,
  };
}

/**
 * Convert a list of SKILL.md content strings (for testing/in-memory use).
 *
 * @param skills - Array of { name, content } pairs.
 * @param outputDir - Base output directory for wave directories.
 * @param author - Optional author name override.
 * @returns Batch conversion results.
 */
export function convertFromContents(
  skills: Array<{ name: string; content: string }>,
  outputDir: string,
  author?: string,
): BatchResult {
  mkdirSync(outputDir, { recursive: true });

  const results: ConversionResult[] = [];

  for (const { name, content } of skills) {
    try {
      const skill = parseSkillMd(content);
      const manifest = mapToWaveManifest(skill, author);
      const indexJs = generateIndexJs(skill, manifest);

      const waveDir = join(outputDir, manifest.name);
      mkdirSync(waveDir, { recursive: true });

      writeFileSync(
        join(waveDir, 'wave.json'),
        JSON.stringify(manifest, null, 2) + '\n',
      );
      writeFileSync(join(waveDir, 'index.js'), indexJs);

      results.push({
        name: manifest.name,
        success: true,
        manifest,
        outputDir: waveDir,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ name, success: false, error: message });
    }
  }

  const succeeded = results.filter((r) => r.success).length;

  return {
    total: results.length,
    succeeded,
    failed: results.length - succeeded,
    results,
  };
}
