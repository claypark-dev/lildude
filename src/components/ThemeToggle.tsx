import type { FC } from 'react'

interface ThemeToggleProps {
  theme: 'dark' | 'light'
  onToggle: () => void
}

export const ThemeToggle: FC<ThemeToggleProps> = ({ theme, onToggle }) => {
  return (
    <button
      onClick={onToggle}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      className="w-10 h-10 flex items-center justify-center rounded-full text-lg transition-all duration-200 cursor-pointer hover:scale-110"
      style={{
        backgroundColor: 'var(--bg-surface)',
        color: 'var(--text-primary)',
        border: '1px solid var(--border)',
      }}
    >
      {theme === 'dark' ? '☀' : '☾'}
    </button>
  )
}
