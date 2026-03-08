/**
 * ClawHub SKILL.md parser.
 * Extracts YAML frontmatter and markdown body from SKILL.md files.
 */

export interface ClawHubSkill {
  /** Parsed YAML frontmatter fields. */
  name: string;
  description: string;
  version: string;
  metadata: {
    openclaw?: {
      requires?: {
        env?: string[];
        bins?: string[];
      };
      emoji?: string;
    };
  };
  /** The markdown body (instructions) below the frontmatter. */
  body: string;
}

/**
 * Parse a SKILL.md file content into structured data.
 * Expects YAML frontmatter delimited by `---` lines.
 *
 * @param content - Raw SKILL.md file content.
 * @returns Parsed skill data.
 * @throws If frontmatter is missing or malformed.
 */
export function parseSkillMd(content: string): ClawHubSkill {
  const trimmed = content.trim();

  if (!trimmed.startsWith('---')) {
    throw new Error('SKILL.md missing YAML frontmatter delimiter (---)');
  }

  const secondDelimiter = trimmed.indexOf('---', 3);
  if (secondDelimiter === -1) {
    throw new Error('SKILL.md missing closing frontmatter delimiter (---)');
  }

  const frontmatterRaw = trimmed.slice(3, secondDelimiter).trim();
  const body = trimmed.slice(secondDelimiter + 3).trim();

  const fields = parseSimpleYaml(frontmatterRaw);

  const name = fields['name'];
  const description = fields['description'];
  const version = fields['version'] ?? '1.0.0';

  if (!name) throw new Error('SKILL.md missing required field: name');
  if (!description) throw new Error('SKILL.md missing required field: description');

  // Parse metadata.openclaw.requires
  const metadata: ClawHubSkill['metadata'] = {};
  const requiresEnv = fields['metadata.openclaw.requires.env'];
  const requiresBins = fields['metadata.openclaw.requires.bins'];
  const emoji = fields['metadata.openclaw.emoji'];

  if (requiresEnv || requiresBins || emoji) {
    metadata.openclaw = {
      requires: {
        env: requiresEnv ? parseYamlArray(requiresEnv) : undefined,
        bins: requiresBins ? parseYamlArray(requiresBins) : undefined,
      },
      emoji: emoji ? emoji.replace(/["']/g, '') : undefined,
    };
  }

  return { name, description, version, metadata, body };
}

/**
 * Simple YAML parser for flat and nested dotted key-value pairs.
 * Handles indented blocks by flattening to dotted keys.
 */
function parseSimpleYaml(yaml: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = yaml.split('\n');
  const keyStack: string[] = [];
  const indentStack: number[] = [-1];

  for (const line of lines) {
    // Skip empty lines and comments
    if (line.trim() === '' || line.trim().startsWith('#')) continue;

    const indent = line.search(/\S/);
    const content = line.trim();

    // Pop stack until we're at the right nesting level
    while (indentStack.length > 1 && indent <= indentStack[indentStack.length - 1]) {
      keyStack.pop();
      indentStack.pop();
    }

    // Check if this is a key: value pair
    const colonIdx = content.indexOf(':');
    if (colonIdx === -1) continue;

    const key = content.slice(0, colonIdx).trim();
    const value = content.slice(colonIdx + 1).trim();

    if (value === '' || value === '|' || value === '>') {
      // This is a parent key — push onto stack
      keyStack.push(key);
      indentStack.push(indent);
    } else {
      // This is a leaf value
      const fullKey = [...keyStack, key].join('.');
      result[fullKey] = value;
    }
  }

  return result;
}

/**
 * Parse a YAML inline array like `[TAVILY_API_KEY, OTHER_KEY]`.
 */
function parseYamlArray(value: string): string[] {
  const trimmed = value.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return trimmed
      .slice(1, -1)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  // Single value
  return trimmed ? [trimmed] : [];
}
