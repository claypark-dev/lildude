import type { FC } from 'react'
import { CopyButton } from './CopyButton'

interface CodeBlockProps {
  code: string
  language?: string
}

export const CodeBlock: FC<CodeBlockProps> = ({ code, language }) => {
  const lines = code.split('\n')

  return (
    <div
      className="relative rounded-xl overflow-hidden"
      style={{
        backgroundColor: 'var(--bg-code)',
        border: '1px solid var(--border)',
      }}
    >
      {/* Header bar with language label and copy button */}
      <div
        className="flex items-center justify-between px-4 py-2"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        {language ? (
          <span
            className="text-xs font-mono"
            style={{ color: 'var(--text-muted)' }}
          >
            {language}
          </span>
        ) : (
          <span />
        )}
        <CopyButton text={code} />
      </div>

      {/* Code content */}
      <pre className="p-4 overflow-x-auto m-0">
        <code className="text-sm font-mono leading-relaxed">
          {lines.map((line, index) => {
            const isComment = line.trimStart().startsWith('#')
            return (
              <div
                key={index}
                style={{
                  color: isComment ? 'var(--text-muted)' : 'var(--text-primary)',
                }}
              >
                {line || '\u00A0'}
              </div>
            )
          })}
        </code>
      </pre>
    </div>
  )
}
