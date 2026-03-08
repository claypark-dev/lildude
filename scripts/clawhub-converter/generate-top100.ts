/**
 * Generate top 100 community waves from the curated skill list.
 * Reads skill-list-top100.json and produces wave directories in waves/community/.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertFromContents } from './batch.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface SkillEntry {
  name: string;
  description: string;
  env?: string[];
  bins?: string[];
  category: string;
}

/**
 * Generate a SKILL.md content string from a skill entry.
 */
function generateSkillMd(entry: SkillEntry): string {
  const requires: string[] = [];
  if (entry.env && entry.env.length > 0) {
    requires.push(`      env: [${entry.env.join(', ')}]`);
  }
  if (entry.bins && entry.bins.length > 0) {
    requires.push(`      bins: [${entry.bins.join(', ')}]`);
  }

  const requiresBlock = requires.length > 0
    ? `\n    requires:\n${requires.join('\n')}`
    : '';

  return `---
name: ${entry.name}
description: ${entry.description}
version: 1.0.0
metadata:
  openclaw:${requiresBlock}
    emoji: "⚡"
---
# ${entry.name.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}

${entry.description}.

## Category
${entry.category}
`;
}

/**
 * Run the top 100 generation.
 */
export function generateTop100(outputDir: string): {
  total: number;
  succeeded: number;
  failed: number;
} {
  const skillListPath = join(__dirname, 'skill-list-top100.json');
  const skillList: SkillEntry[] = JSON.parse(readFileSync(skillListPath, 'utf-8'));

  const skills = skillList.map((entry) => ({
    name: entry.name,
    content: generateSkillMd(entry),
  }));

  const result = convertFromContents(skills, outputDir, 'clawhub-community');

  return {
    total: result.total,
    succeeded: result.succeeded,
    failed: result.failed,
  };
}

// Run if executed directly
if (process.argv[1] === __filename) {
  const projectRoot = join(__dirname, '../..');
  const outputDir = join(projectRoot, 'waves/community');
  mkdirSync(outputDir, { recursive: true });

  console.log('Generating top 100 community waves...');
  const result = generateTop100(outputDir);
  console.log(`Done: ${result.succeeded}/${result.total} succeeded, ${result.failed} failed`);
}
