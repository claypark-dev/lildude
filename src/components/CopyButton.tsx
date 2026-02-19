import type { FC } from 'react'
import { useCopyToClipboard } from '../hooks/useCopyToClipboard'

interface CopyButtonProps {
  text: string
}

export const CopyButton: FC<CopyButtonProps> = ({ text }) => {
  const { copied, copy } = useCopyToClipboard()

  return (
    <button
      onClick={() => copy(text)}
      aria-label={copied ? 'Copied to clipboard' : 'Copy to clipboard'}
      className="flex items-center gap-1.5 text-xs px-2 py-1 rounded transition-all duration-200 cursor-pointer"
      style={{
        backgroundColor: 'transparent',
        border: 'none',
        color: copied ? 'var(--accent)' : 'var(--text-muted)',
      }}
    >
      {copied ? (
        <>
          <span style={{ color: 'var(--accent)' }}>&#10003;</span>
          <span style={{ color: 'var(--accent)' }}>Copied!</span>
        </>
      ) : (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  )
}
