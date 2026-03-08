/**
 * ArtifactRenderer — renders rich content blocks inline in chat messages.
 *
 * Supported artifact types:
 * - HTML: Rendered in a sandboxed iframe (srcdoc + sandbox attribute)
 * - SVG: Inline rendering with DOMPurify sanitization
 * - Mermaid: Client-side rendering via mermaid.js (lazy loaded)
 * - Code: Syntax-highlighted with language label
 * - Table: Rendered as styled HTML table
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import type { ArtifactBlock } from '../lib/types.ts';
import { sanitizeHtml, sanitizeSvg } from '../lib/artifact-parser.ts';

interface ArtifactRendererProps {
  block: ArtifactBlock;
}

/** Copy-to-clipboard button used on all artifact types */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may fail in non-HTTPS contexts
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="text-xs text-[#8b949e] hover:text-white transition-colors px-2 py-0.5"
      title="Copy to clipboard"
    >
      {copied ? '\u2713 Copied' : '\u2398 Copy'}
    </button>
  );
}

/** Collapse/expand toggle */
function CollapseToggle({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="text-xs text-[#8b949e] hover:text-white transition-colors px-2 py-0.5"
      title={collapsed ? 'Expand' : 'Collapse'}
    >
      {collapsed ? '\u25B6 Expand' : '\u25BC Collapse'}
    </button>
  );
}

/** Header bar for artifact blocks */
function ArtifactHeader({
  label,
  content,
  collapsed,
  onToggle,
}: {
  label: string;
  content: string;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between bg-[#0d1117] border-b border-[#30363d] px-3 py-1.5 rounded-t-lg">
      <span className="text-xs text-[#8b949e] font-mono">{label}</span>
      <span className="flex items-center gap-1">
        <CopyButton text={content} />
        <CollapseToggle collapsed={collapsed} onToggle={onToggle} />
      </span>
    </div>
  );
}

// ── Individual Renderers ──────────────────────────────────────────

/** Render HTML in a sandboxed iframe */
function HtmlArtifact({ content }: { content: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(200);

  const sanitized = useMemo(() => sanitizeHtml(content), [content]);

  // Build a complete HTML document for the iframe
  const srcdoc = useMemo(() => `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: -apple-system, system-ui, sans-serif;
          background: #161b22;
          color: #c9d1d9;
          padding: 12px;
          overflow: auto;
        }
        a { color: #58a6ff; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #30363d; padding: 6px 12px; text-align: left; }
        th { background: #0d1117; }
        code { background: #0d1117; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; }
        pre { background: #0d1117; padding: 12px; border-radius: 6px; overflow-x: auto; }
        img { max-width: 100%; height: auto; }
      </style>
    </head>
    <body>${sanitized}</body>
    </html>
  `, [sanitized]);

  // Auto-resize iframe to content height
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    function handleLoad() {
      try {
        const doc = iframe?.contentDocument;
        if (doc) {
          const h = doc.documentElement.scrollHeight;
          setHeight(Math.min(Math.max(h, 60), 600));
        }
      } catch {
        // Cross-origin — use default height
      }
    }

    iframe.addEventListener('load', handleLoad);
    return () => iframe.removeEventListener('load', handleLoad);
  }, [srcdoc]);

  return (
    <iframe
      ref={iframeRef}
      srcDoc={srcdoc}
      sandbox="allow-same-origin"
      className="w-full border-0 rounded-b-lg bg-[#161b22]"
      style={{ height: `${height}px` }}
      title="HTML artifact"
    />
  );
}

/** Render sanitized SVG inline */
function SvgArtifact({ content }: { content: string }) {
  const sanitized = useMemo(() => sanitizeSvg(content), [content]);

  return (
    <div
      className="p-3 bg-[#161b22] rounded-b-lg flex items-center justify-center overflow-auto"
      dangerouslySetInnerHTML={{ __html: sanitized }}
    />
  );
}

/** Render a Mermaid diagram (lazy-loaded) */
function MermaidArtifact({ content }: { content: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [rendered, setRendered] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function renderMermaid() {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: 'dark',
          themeVariables: {
            primaryColor: '#1f6feb',
            primaryTextColor: '#c9d1d9',
            primaryBorderColor: '#30363d',
            lineColor: '#8b949e',
            secondaryColor: '#161b22',
            tertiaryColor: '#0d1117',
          },
        });

        const id = `mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const { svg } = await mermaid.render(id, content.trim());

        if (!cancelled) {
          setRendered(svg);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to render diagram');
          setRendered(null);
        }
      }
    }

    renderMermaid();
    return () => { cancelled = true; };
  }, [content]);

  if (error) {
    return (
      <div className="p-3 bg-[#161b22] rounded-b-lg">
        <div className="text-red-400 text-xs mb-2">Mermaid rendering error: {error}</div>
        <pre className="text-xs text-[#8b949e] font-mono whitespace-pre-wrap">{content}</pre>
      </div>
    );
  }

  if (!rendered) {
    return (
      <div className="p-4 bg-[#161b22] rounded-b-lg flex items-center justify-center">
        <span className="inline-block w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin mr-2" />
        <span className="text-xs text-[#8b949e]">Rendering diagram...</span>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="p-3 bg-[#161b22] rounded-b-lg flex items-center justify-center overflow-auto"
      dangerouslySetInnerHTML={{ __html: rendered }}
    />
  );
}

/** Render syntax-highlighted code */
function CodeArtifact({ content, language }: { content: string; language?: string }) {
  // Simple keyword-based highlighting
  const highlighted = useMemo(() => highlightCode(content, language), [content, language]);

  return (
    <div className="bg-[#0d1117] rounded-b-lg overflow-x-auto">
      <pre className="p-3 text-xs font-mono leading-relaxed">
        <code dangerouslySetInnerHTML={{ __html: highlighted }} />
      </pre>
    </div>
  );
}

/** Render an HTML table (already parsed from markdown) */
function TableArtifact({ content }: { content: string }) {
  const sanitized = useMemo(() => sanitizeHtml(content), [content]);

  return (
    <div className="bg-[#161b22] rounded-b-lg overflow-x-auto artifact-table">
      <style>{`
        .artifact-table table { width: 100%; border-collapse: collapse; }
        .artifact-table th, .artifact-table td {
          border: 1px solid #30363d;
          padding: 8px 12px;
          text-align: left;
          font-size: 0.8rem;
        }
        .artifact-table th {
          background: #0d1117;
          color: #58a6ff;
          font-weight: 600;
        }
        .artifact-table td { color: #c9d1d9; }
        .artifact-table tr:nth-child(even) td { background: #0d111788; }
      `}</style>
      <div dangerouslySetInnerHTML={{ __html: sanitized }} />
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────

export function ArtifactRenderer({ block }: ArtifactRendererProps) {
  const [collapsed, setCollapsed] = useState(false);

  const label = (() => {
    switch (block.artifactType) {
      case 'html': return 'HTML';
      case 'svg': return 'SVG';
      case 'mermaid': return 'Mermaid Diagram';
      case 'table': return 'Table';
      case 'code': return block.language ?? 'Code';
    }
  })();

  return (
    <div className="my-2 border border-[#30363d] rounded-lg overflow-hidden">
      <ArtifactHeader
        label={label}
        content={block.content}
        collapsed={collapsed}
        onToggle={() => setCollapsed(!collapsed)}
      />

      {!collapsed && (
        <>
          {block.artifactType === 'html' && <HtmlArtifact content={block.content} />}
          {block.artifactType === 'svg' && <SvgArtifact content={block.content} />}
          {block.artifactType === 'mermaid' && <MermaidArtifact content={block.content} />}
          {block.artifactType === 'code' && (
            <CodeArtifact content={block.content} language={block.language} />
          )}
          {block.artifactType === 'table' && <TableArtifact content={block.content} />}
        </>
      )}
    </div>
  );
}

// ── Syntax Highlighting Helpers ───────────────────────────────────

/** Simple regex-based syntax highlighting (no external dependency) */
function highlightCode(code: string, language?: string): string {
  let escaped = code
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Apply language-specific highlighting
  const lang = language?.toLowerCase() ?? '';

  // Comments
  if (['js', 'javascript', 'ts', 'typescript', 'jsx', 'tsx', 'java', 'c', 'cpp', 'csharp', 'cs', 'go', 'rust', 'swift', 'kotlin', 'scala', 'dart', 'zig'].includes(lang)) {
    // Single-line comments
    escaped = escaped.replace(/(\/\/[^\n]*)/g, '<span class="hljs-comment" style="color:#6a737d">$1</span>');
    // Multi-line comments
    escaped = escaped.replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="hljs-comment" style="color:#6a737d">$1</span>');
  } else if (['python', 'py', 'ruby', 'rb', 'shell', 'bash', 'sh', 'zsh', 'yaml', 'yml', 'toml', 'r', 'perl', 'elixir'].includes(lang)) {
    escaped = escaped.replace(/(#[^\n]*)/g, '<span class="hljs-comment" style="color:#6a737d">$1</span>');
  } else if (['sql'].includes(lang)) {
    escaped = escaped.replace(/(--[^\n]*)/g, '<span class="hljs-comment" style="color:#6a737d">$1</span>');
  }

  // Strings (double and single quoted)
  escaped = escaped.replace(/(&quot;[^&]*?&quot;|'[^']*?'|`[^`]*?`)/g,
    '<span style="color:#a5d6ff">$1</span>');

  // Numbers
  escaped = escaped.replace(/\b(\d+\.?\d*)\b/g,
    '<span style="color:#79c0ff">$1</span>');

  // Common keywords across languages
  const keywords = [
    'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while',
    'class', 'interface', 'type', 'import', 'export', 'from', 'default', 'async',
    'await', 'try', 'catch', 'throw', 'new', 'this', 'super', 'extends',
    'implements', 'abstract', 'public', 'private', 'protected', 'static',
    'def', 'self', 'True', 'False', 'None', 'lambda', 'yield', 'pass',
    'fn', 'pub', 'mod', 'use', 'impl', 'trait', 'struct', 'enum', 'match',
    'func', 'package', 'defer', 'go', 'chan', 'select', 'case', 'switch',
    'break', 'continue', 'do', 'in', 'of', 'with', 'as', 'is', 'not',
    'and', 'or', 'elif', 'except', 'finally', 'raise', 'print',
    'SELECT', 'FROM', 'WHERE', 'JOIN', 'INSERT', 'UPDATE', 'DELETE',
    'CREATE', 'ALTER', 'DROP', 'TABLE', 'INDEX', 'INTO', 'VALUES',
    'ORDER', 'BY', 'GROUP', 'HAVING', 'LIMIT', 'OFFSET', 'AND', 'OR',
    'NOT', 'NULL', 'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES',
    'true', 'false', 'null', 'undefined', 'void', 'typeof', 'instanceof',
  ];

  const kwPattern = new RegExp(`\\b(${keywords.join('|')})\\b`, 'g');
  escaped = escaped.replace(kwPattern, '<span style="color:#ff7b72">$1</span>');

  return escaped;
}
