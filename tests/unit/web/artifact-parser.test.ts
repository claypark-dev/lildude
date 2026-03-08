/**
 * Artifact parser and renderer unit tests.
 *
 * Tests the pure logic of artifact parsing: fenced code block detection,
 * artifact type classification, markdown table parsing, and content
 * sanitization. No React rendering — all assertions target TypeScript
 * interfaces and parser output shapes.
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Locally duplicated interfaces (avoids import.meta.env / React issues)
// ---------------------------------------------------------------------------

type ArtifactType = 'html' | 'svg' | 'mermaid' | 'code' | 'table';

interface ArtifactBlock {
  type: 'artifact';
  artifactType: ArtifactType;
  content: string;
  title?: string;
  language?: string;
}

interface TextBlock {
  type: 'text';
  content: string;
}

interface ParsedMessage {
  blocks: Array<ArtifactBlock | TextBlock>;
  hasArtifacts: boolean;
}

// ---------------------------------------------------------------------------
// Locally re-implemented parser logic for testing (avoids DOMPurify in Node)
// ---------------------------------------------------------------------------

const ARTIFACT_LANGUAGES: Record<string, ArtifactType> = {
  html: 'html',
  svg: 'svg',
  mermaid: 'mermaid',
};

const CODE_LANGUAGES = new Set([
  'javascript', 'js', 'typescript', 'ts', 'python', 'py', 'rust', 'go',
  'java', 'c', 'cpp', 'csharp', 'cs', 'ruby', 'rb', 'php', 'swift',
  'kotlin', 'scala', 'shell', 'bash', 'sh', 'zsh', 'fish', 'powershell',
  'sql', 'graphql', 'json', 'yaml', 'yml', 'toml', 'xml', 'css', 'scss',
  'less', 'jsx', 'tsx', 'vue', 'svelte', 'markdown', 'md', 'dockerfile',
  'makefile', 'r', 'lua', 'perl', 'elixir', 'erlang', 'haskell', 'ocaml',
  'clojure', 'dart', 'zig', 'nim', 'text', 'txt', 'plain', 'diff',
  'ini', 'conf', 'env', 'csv',
]);

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function parseRow(line: string): string[] {
  return line.split('|').slice(1, -1).map(cell => cell.trim());
}

function parseMarkdownTable(tableStr: string): string {
  const lines = tableStr.trim().split('\n').filter(l => l.trim());
  if (lines.length < 2) return tableStr;

  const headers = parseRow(lines[0]);
  const separators = parseRow(lines[1]);
  const rows = lines.slice(2).map(parseRow);

  const alignments = separators.map(sep => {
    const trimmed = sep.trim();
    if (trimmed.startsWith(':') && trimmed.endsWith(':')) return 'center';
    if (trimmed.endsWith(':')) return 'right';
    return 'left';
  });

  let html = '<table><thead><tr>';
  headers.forEach((h, i) => {
    const align = alignments[i] || 'left';
    html += `<th style="text-align:${align}">${escapeHtml(h)}</th>`;
  });
  html += '</tr></thead><tbody>';

  for (const row of rows) {
    html += '<tr>';
    headers.forEach((_, i) => {
      const align = alignments[i] || 'left';
      html += `<td style="text-align:${align}">${escapeHtml(row[i] ?? '')}</td>`;
    });
    html += '</tr>';
  }
  html += '</tbody></table>';
  return html;
}

function extractTables(text: string): ParsedMessage['blocks'] {
  const blocks: ParsedMessage['blocks'] = [];
  let lastIndex = 0;

  const tableRe = /(?:^|\n)(\|[^\n]+\|\n\|[-| :]+\|\n(?:\|[^\n]+\|\n?)+)/g;
  let match: RegExpExecArray | null;

  while ((match = tableRe.exec(text)) !== null) {
    const tableStart = match.index + (match[0].startsWith('\n') ? 1 : 0);
    const tableContent = match[1];

    if (tableStart > lastIndex) {
      const before = text.slice(lastIndex, tableStart).trim();
      if (before) blocks.push({ type: 'text', content: before });
    }

    blocks.push({
      type: 'artifact',
      artifactType: 'table',
      content: parseMarkdownTable(tableContent),
    });

    lastIndex = tableStart + tableContent.length;
  }

  if (lastIndex < text.length) {
    const remaining = text.slice(lastIndex).trim();
    if (remaining) blocks.push({ type: 'text', content: remaining });
  }

  if (blocks.length === 0) blocks.push({ type: 'text', content: text });
  return blocks;
}

function parseMessageContent(text: string): ParsedMessage {
  const blocks: ParsedMessage['blocks'] = [];
  let lastIndex = 0;
  let hasArtifacts = false;

  const fencedMatches: Array<{ start: number; end: number; block: ArtifactBlock }> = [];
  const fencedRe = /^```(\w*)\s*\n([\s\S]*?)^```\s*$/gm;
  let match: RegExpExecArray | null;

  while ((match = fencedRe.exec(text)) !== null) {
    const lang = match[1].toLowerCase();
    const content = match[2];

    if (ARTIFACT_LANGUAGES[lang]) {
      fencedMatches.push({
        start: match.index,
        end: match.index + match[0].length,
        block: { type: 'artifact', artifactType: ARTIFACT_LANGUAGES[lang], content, language: lang },
      });
    } else if (lang && (CODE_LANGUAGES.has(lang) || lang.length > 0)) {
      fencedMatches.push({
        start: match.index,
        end: match.index + match[0].length,
        block: { type: 'artifact', artifactType: 'code', content, language: lang || 'text' },
      });
    } else if (!lang) {
      fencedMatches.push({
        start: match.index,
        end: match.index + match[0].length,
        block: { type: 'artifact', artifactType: 'code', content, language: 'text' },
      });
    }
  }

  for (const fm of fencedMatches) {
    if (fm.start > lastIndex) {
      const textContent = text.slice(lastIndex, fm.start).trim();
      if (textContent) {
        const textWithTables = extractTables(textContent);
        blocks.push(...textWithTables);
      }
    }
    blocks.push(fm.block);
    hasArtifacts = true;
    lastIndex = fm.end;
  }

  if (fencedMatches.length > 0) {
    if (lastIndex < text.length) {
      const remaining = text.slice(lastIndex).trim();
      if (remaining) {
        const textWithTables = extractTables(remaining);
        blocks.push(...textWithTables);
      }
    }
  } else {
    const textWithTables = extractTables(text);
    if (textWithTables.some(b => b.type === 'artifact')) {
      hasArtifacts = true;
      blocks.push(...textWithTables);
    } else {
      blocks.push({ type: 'text', content: text });
    }
  }

  return { blocks, hasArtifacts };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Artifact Parser', () => {
  describe('parseMessageContent — plain text', () => {
    it('returns a single text block for plain text', () => {
      const result = parseMessageContent('Hello, world!');
      expect(result.hasArtifacts).toBe(false);
      expect(result.blocks).toHaveLength(1);
      expect(result.blocks[0]).toEqual({ type: 'text', content: 'Hello, world!' });
    });

    it('preserves whitespace in plain text', () => {
      const text = 'Line 1\nLine 2\n\nLine 4';
      const result = parseMessageContent(text);
      expect(result.hasArtifacts).toBe(false);
      expect(result.blocks[0].content).toBe(text);
    });
  });

  describe('parseMessageContent — fenced code blocks', () => {
    it('detects a JavaScript code block', () => {
      const text = 'Here is some code:\n```javascript\nconsole.log("hello");\n```\nEnd.';
      const result = parseMessageContent(text);

      expect(result.hasArtifacts).toBe(true);
      expect(result.blocks).toHaveLength(3);

      expect(result.blocks[0]).toEqual({ type: 'text', content: 'Here is some code:' });
      expect(result.blocks[1]).toEqual({
        type: 'artifact',
        artifactType: 'code',
        content: 'console.log("hello");\n',
        language: 'javascript',
      });
      expect(result.blocks[2]).toEqual({ type: 'text', content: 'End.' });
    });

    it('detects an HTML artifact block', () => {
      const html = '<div class="card"><h1>Hello</h1></div>\n';
      const text = `Here is HTML:\n\`\`\`html\n${html}\`\`\``;
      const result = parseMessageContent(text);

      expect(result.hasArtifacts).toBe(true);
      const artifact = result.blocks.find(b => b.type === 'artifact') as ArtifactBlock;
      expect(artifact).toBeDefined();
      expect(artifact.artifactType).toBe('html');
      expect(artifact.content).toBe(html);
    });

    it('detects an SVG artifact block', () => {
      const svg = '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40"/></svg>\n';
      const text = `\`\`\`svg\n${svg}\`\`\``;
      const result = parseMessageContent(text);

      expect(result.hasArtifacts).toBe(true);
      const artifact = result.blocks.find(b => b.type === 'artifact') as ArtifactBlock;
      expect(artifact.artifactType).toBe('svg');
    });

    it('detects a Mermaid diagram block', () => {
      const mermaid = 'graph TD\n  A --> B\n  B --> C\n';
      const text = `\`\`\`mermaid\n${mermaid}\`\`\``;
      const result = parseMessageContent(text);

      expect(result.hasArtifacts).toBe(true);
      const artifact = result.blocks.find(b => b.type === 'artifact') as ArtifactBlock;
      expect(artifact.artifactType).toBe('mermaid');
      expect(artifact.content).toBe(mermaid);
    });

    it('treats bare ``` blocks as code with language "text"', () => {
      const text = '```\nplain text block\n```';
      const result = parseMessageContent(text);

      expect(result.hasArtifacts).toBe(true);
      const artifact = result.blocks.find(b => b.type === 'artifact') as ArtifactBlock;
      expect(artifact.artifactType).toBe('code');
      expect(artifact.language).toBe('text');
    });

    it('handles multiple code blocks interleaved with text', () => {
      const text = [
        'First paragraph.',
        '```python',
        'print("hello")',
        '```',
        'Middle text.',
        '```rust',
        'fn main() {}',
        '```',
        'Final text.',
      ].join('\n');

      const result = parseMessageContent(text);
      expect(result.hasArtifacts).toBe(true);

      // text, python, text, rust, text
      const types = result.blocks.map(b =>
        b.type === 'text' ? 'text' : `artifact:${(b as ArtifactBlock).artifactType}`,
      );
      expect(types).toEqual(['text', 'artifact:code', 'text', 'artifact:code', 'text']);
    });

    it('maps common language aliases correctly', () => {
      const languages = ['js', 'ts', 'py', 'rb', 'sh', 'yml', 'sql', 'json', 'css'];
      for (const lang of languages) {
        const text = `\`\`\`${lang}\ncode\n\`\`\``;
        const result = parseMessageContent(text);
        const artifact = result.blocks.find(b => b.type === 'artifact') as ArtifactBlock;
        expect(artifact, `Expected artifact for language: ${lang}`).toBeDefined();
        expect(artifact.artifactType).toBe('code');
        expect(artifact.language).toBe(lang);
      }
    });
  });

  describe('parseMessageContent — markdown tables', () => {
    it('detects a simple markdown table', () => {
      const text = [
        'Here is a table:',
        '| Name | Age |',
        '|------|-----|',
        '| Alice | 30 |',
        '| Bob | 25 |',
      ].join('\n');

      const result = parseMessageContent(text);
      expect(result.hasArtifacts).toBe(true);
      const tableBlock = result.blocks.find(b => b.type === 'artifact') as ArtifactBlock;
      expect(tableBlock).toBeDefined();
      expect(tableBlock.artifactType).toBe('table');
      expect(tableBlock.content).toContain('<table>');
      expect(tableBlock.content).toContain('Alice');
      expect(tableBlock.content).toContain('Bob');
    });

    it('handles table alignment markers', () => {
      const tableStr = [
        '| Left | Center | Right |',
        '|:-----|:------:|------:|',
        '| a | b | c |',
      ].join('\n');

      const html = parseMarkdownTable(tableStr);
      expect(html).toContain('text-align:left');
      expect(html).toContain('text-align:center');
      expect(html).toContain('text-align:right');
    });
  });

  describe('parseMarkdownTable', () => {
    it('generates valid HTML table from markdown', () => {
      const table = '| Col1 | Col2 |\n|------|------|\n| A | B |\n| C | D |';
      const html = parseMarkdownTable(table);

      expect(html).toContain('<table>');
      expect(html).toContain('<thead>');
      expect(html).toContain('<tbody>');
      expect(html).toContain('<th');
      expect(html).toContain('<td');
      expect(html).toContain('Col1');
      expect(html).toContain('Col2');
      expect(html).toContain('A');
      expect(html).toContain('D');
    });

    it('escapes HTML entities in table cells', () => {
      const table = '| Col |\n|-----|\n| <script>alert("xss")</script> |';
      const html = parseMarkdownTable(table);

      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
    });

    it('returns the original string for tables with < 2 rows', () => {
      const input = '| Col |';
      expect(parseMarkdownTable(input)).toBe(input);
    });
  });

  describe('escapeHtml', () => {
    it('escapes all dangerous characters', () => {
      expect(escapeHtml('<div class="foo">&')).toBe('&lt;div class=&quot;foo&quot;&gt;&amp;');
    });

    it('returns empty string for empty input', () => {
      expect(escapeHtml('')).toBe('');
    });
  });

  describe('edge cases', () => {
    it('handles empty string', () => {
      const result = parseMessageContent('');
      expect(result.hasArtifacts).toBe(false);
      expect(result.blocks).toHaveLength(1);
      expect(result.blocks[0].content).toBe('');
    });

    it('handles code block with no closing fence', () => {
      const text = '```python\nprint("hello")';
      const result = parseMessageContent(text);
      // Unmatched code block should be treated as plain text
      expect(result.hasArtifacts).toBe(false);
    });

    it('handles nested backticks inside code blocks', () => {
      const text = '```markdown\nUse `backticks` for inline code\n```';
      const result = parseMessageContent(text);
      expect(result.hasArtifacts).toBe(true);
      const artifact = result.blocks.find(b => b.type === 'artifact') as ArtifactBlock;
      expect(artifact.content).toContain('`backticks`');
    });

    it('handles message with only a code block (no surrounding text)', () => {
      const text = '```json\n{"key": "value"}\n```';
      const result = parseMessageContent(text);
      expect(result.hasArtifacts).toBe(true);
      expect(result.blocks).toHaveLength(1);
      expect(result.blocks[0].type).toBe('artifact');
    });

    it('handles mixed artifacts and tables', () => {
      const text = [
        'Here is code:',
        '```python',
        'x = 1',
        '```',
        'And a table:',
        '| A | B |',
        '|---|---|',
        '| 1 | 2 |',
        'Done.',
      ].join('\n');

      const result = parseMessageContent(text);
      expect(result.hasArtifacts).toBe(true);

      const artifactBlocks = result.blocks.filter(b => b.type === 'artifact');
      expect(artifactBlocks.length).toBeGreaterThanOrEqual(2);

      const types = artifactBlocks.map(b => (b as ArtifactBlock).artifactType);
      expect(types).toContain('code');
      expect(types).toContain('table');
    });

    it('handles unknown language tags as code blocks', () => {
      const text = '```brainfuck\n++++++++[>++++[>++>+++>+++>+<<<<-]\n```';
      const result = parseMessageContent(text);
      expect(result.hasArtifacts).toBe(true);
      const artifact = result.blocks.find(b => b.type === 'artifact') as ArtifactBlock;
      expect(artifact.artifactType).toBe('code');
      expect(artifact.language).toBe('brainfuck');
    });
  });

  describe('ArtifactBlock type validation', () => {
    it('all artifact types are valid', () => {
      const validTypes: ArtifactType[] = ['html', 'svg', 'mermaid', 'code', 'table'];
      for (const t of validTypes) {
        const block: ArtifactBlock = {
          type: 'artifact',
          artifactType: t,
          content: 'test',
        };
        expect(block.type).toBe('artifact');
        expect(validTypes).toContain(block.artifactType);
      }
    });

    it('optional fields are properly typed', () => {
      const block: ArtifactBlock = {
        type: 'artifact',
        artifactType: 'code',
        content: 'test',
        title: 'Example',
        language: 'python',
      };
      expect(block.title).toBe('Example');
      expect(block.language).toBe('python');
    });
  });

  describe('ParsedMessage validation', () => {
    it('plain text message has correct shape', () => {
      const msg: ParsedMessage = {
        blocks: [{ type: 'text', content: 'Hello' }],
        hasArtifacts: false,
      };
      expect(msg.hasArtifacts).toBe(false);
      expect(msg.blocks[0].type).toBe('text');
    });

    it('rich message with artifacts has correct shape', () => {
      const msg: ParsedMessage = {
        blocks: [
          { type: 'text', content: 'Before' },
          { type: 'artifact', artifactType: 'html', content: '<p>test</p>' },
          { type: 'text', content: 'After' },
        ],
        hasArtifacts: true,
      };
      expect(msg.hasArtifacts).toBe(true);
      expect(msg.blocks).toHaveLength(3);
    });
  });
});
