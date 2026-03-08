/**
 * Artifact parser — extracts rich content blocks from markdown text.
 *
 * Detects fenced code blocks with language hints and converts them into
 * typed ArtifactBlock objects for rendering by ArtifactRenderer.
 */

import DOMPurify from 'dompurify';
import type { ArtifactBlock, ParsedMessage } from './types.ts';

/** Language aliases that map to artifact types */
const ARTIFACT_LANGUAGES: Record<string, ArtifactBlock['artifactType']> = {
  html: 'html',
  svg: 'svg',
  mermaid: 'mermaid',
  // Table detection is handled separately via markdown pipe syntax
};

/** Languages treated as syntax-highlighted code blocks */
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

/** Regex to match fenced code blocks: ```lang\ncontent\n``` (used inside parseMessageContent) */
// Pattern: /^```(\w*)\s*\n([\s\S]*?)^```\s*$/gm

/** Regex to detect markdown tables (used inside extractTables) */
// Pattern: /(?:^|\n)(\|[^\n]+\|\n\|[-| :]+\|\n(?:\|[^\n]+\|\n?)+)/g

/**
 * Sanitize HTML content using DOMPurify.
 * Strips scripts, event handlers, and other dangerous markup.
 */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'ul', 'ol', 'li', 'a', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'strong', 'em', 'b', 'i', 'u', 'code', 'pre', 'blockquote',
      'br', 'hr', 'sup', 'sub', 'mark', 'small', 'dl', 'dt', 'dd',
      'figure', 'figcaption', 'details', 'summary', 'section', 'article',
      'header', 'footer', 'nav', 'main', 'aside',
    ],
    ALLOWED_ATTR: [
      'class', 'id', 'style', 'href', 'src', 'alt', 'title', 'width', 'height',
      'target', 'rel', 'colspan', 'rowspan', 'scope',
    ],
    ALLOW_DATA_ATTR: false,
  });
}

/**
 * Sanitize SVG content — more restrictive than HTML.
 */
export function sanitizeSvg(svg: string): string {
  return DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ALLOW_DATA_ATTR: false,
  });
}

/**
 * Parse a markdown table string into an HTML table.
 */
function parseMarkdownTable(tableStr: string): string {
  const lines = tableStr.trim().split('\n').filter(l => l.trim());
  if (lines.length < 2) return tableStr;

  const parseRow = (line: string): string[] =>
    line.split('|').slice(1, -1).map(cell => cell.trim());

  const headers = parseRow(lines[0]);
  // lines[1] is the separator row (|---|---|)
  const rows = lines.slice(2).map(parseRow);

  // Detect alignment from separator row
  const separators = parseRow(lines[1]);
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

/** Escape HTML entities in plain text */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Parse a message's text content into a sequence of text and artifact blocks.
 *
 * @param text - The raw message text (may contain fenced code blocks).
 * @returns Parsed message with interleaved text and artifact blocks.
 */
export function parseMessageContent(text: string): ParsedMessage {
  const blocks: ParsedMessage['blocks'] = [];
  let lastIndex = 0;
  let hasArtifacts = false;

  // First pass: extract fenced code blocks
  const fencedMatches: Array<{ start: number; end: number; block: ArtifactBlock }> = [];

  // Use a fresh regex instance for each call
  const fencedRe = /^```(\w*)\s*\n([\s\S]*?)^```\s*$/gm;
  let match: RegExpExecArray | null;

  while ((match = fencedRe.exec(text)) !== null) {
    const lang = match[1].toLowerCase();
    const content = match[2];

    if (ARTIFACT_LANGUAGES[lang]) {
      // Rich artifact (HTML, SVG, Mermaid)
      fencedMatches.push({
        start: match.index,
        end: match.index + match[0].length,
        block: {
          type: 'artifact',
          artifactType: ARTIFACT_LANGUAGES[lang],
          content,
          language: lang,
        },
      });
    } else if (lang && (CODE_LANGUAGES.has(lang) || lang.length > 0)) {
      // Code block with syntax highlighting
      fencedMatches.push({
        start: match.index,
        end: match.index + match[0].length,
        block: {
          type: 'artifact',
          artifactType: 'code',
          content,
          language: lang || 'text',
        },
      });
    } else if (!lang) {
      // Bare ``` block — treat as plain code
      fencedMatches.push({
        start: match.index,
        end: match.index + match[0].length,
        block: {
          type: 'artifact',
          artifactType: 'code',
          content,
          language: 'text',
        },
      });
    }
  }

  // Build interleaved text + artifact blocks
  for (const fm of fencedMatches) {
    // Add preceding text block
    if (fm.start > lastIndex) {
      const textContent = text.slice(lastIndex, fm.start).trim();
      if (textContent) {
        // Check for tables in the text segment
        const textWithTables = extractTables(textContent);
        blocks.push(...textWithTables);
      }
    }

    blocks.push(fm.block);
    hasArtifacts = true;
    lastIndex = fm.end;
  }

  if (fencedMatches.length > 0) {
    // Add remaining text after the last fenced block
    if (lastIndex < text.length) {
      const remaining = text.slice(lastIndex).trim();
      if (remaining) {
        const textWithTables = extractTables(remaining);
        blocks.push(...textWithTables);
      }
    }
  } else {
    // No fenced blocks — check the entire text for tables
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

/**
 * Extract markdown tables from a text segment, returning interleaved
 * text and table artifact blocks.
 */
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
      if (before) {
        blocks.push({ type: 'text', content: before });
      }
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
    if (remaining) {
      blocks.push({ type: 'text', content: remaining });
    }
  }

  if (blocks.length === 0) {
    blocks.push({ type: 'text', content: text });
  }

  return blocks;
}
