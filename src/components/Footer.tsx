import type { FC } from 'react'
import { WaveDivider } from './WaveDivider'

const LINKS = [
  {
    heading: 'Links',
    items: [
      { label: 'GitHub', href: 'https://github.com/claypark-dev/lildude', external: true },
      { label: 'Documentation', href: '#features', external: false },
      { label: 'Quick Start', href: '#quickstart', external: false },
    ],
  },
  {
    heading: 'Community',
    items: [
      { label: 'GitHub Issues', href: 'https://github.com/claypark-dev/lildude/issues', external: true },
      { label: 'Contributing', href: 'https://github.com/claypark-dev/lildude/blob/main/CONTRIBUTING.md', external: true },
    ],
  },
] as const

export const Footer: FC = () => {
  return (
    <footer style={{ backgroundColor: '#050505' }}>
      {/* Wave at top */}
      <WaveDivider flip />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        {/* 3-column layout */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-12 mb-12">
          {/* Brand column */}
          <div>
            <h3
              className="text-xl font-bold mb-3"
              style={{ color: 'var(--text-primary)' }}
            >
              Lil Dude<span style={{ color: '#3b82f6' }}>.</span>
            </h3>
            <p
              className="text-sm mb-2"
              style={{ color: 'var(--text-secondary)' }}
            >
              Your personal AI executive assistant.
            </p>
            <p
              className="text-sm"
              style={{ color: 'var(--text-muted)' }}
            >
              MIT Licensed
            </p>
          </div>

          {/* Link columns */}
          {LINKS.map((group) => (
            <div key={group.heading}>
              <h4
                className="text-sm font-semibold uppercase tracking-wider mb-4"
                style={{ color: 'var(--text-muted)' }}
              >
                {group.heading}
              </h4>
              <ul className="list-none p-0 m-0 flex flex-col gap-3">
                {group.items.map((item) => (
                  <li key={item.label}>
                    <a
                      href={item.href}
                      className="text-sm no-underline transition-colors duration-200 hover:opacity-80"
                      style={{ color: 'var(--accent)' }}
                      {...(item.external
                        ? { target: '_blank', rel: 'noopener noreferrer' }
                        : {})}
                    >
                      {item.label}
                      {item.external && (
                        <span className="ml-1 text-xs" aria-hidden="true">
                          ↗
                        </span>
                      )}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom bar */}
        <div
          className="pt-8 text-center text-sm"
          style={{
            borderTop: '1px solid var(--border)',
            color: 'var(--text-muted)',
          }}
        >
          &copy; 2026 Lil Dude Contributors
        </div>
      </div>
    </footer>
  )
}
