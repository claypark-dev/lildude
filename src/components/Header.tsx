import { useState, useEffect, type FC } from 'react'
import { useTheme } from '../hooks/useTheme'
import { ThemeToggle } from './ThemeToggle'

interface NavLink {
  readonly label: string
  readonly href: string
  readonly external?: boolean
}

const NAV_LINKS: readonly NavLink[] = [
  { label: 'Features', href: '#features' },
  { label: 'Channels', href: '#channels' },
  { label: 'Security', href: '#security' },
  { label: 'Quick Start', href: '#quickstart' },
  {
    label: 'GitHub',
    href: 'https://github.com/claypark-dev/lildude',
    external: true,
  },
]

export const Header: FC = () => {
  const { theme, toggle } = useTheme()
  const [scrolled, setScrolled] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 50)
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  return (
    <header
      className="fixed top-0 left-0 right-0 z-50 transition-all duration-300"
      style={{
        backgroundColor: scrolled
          ? 'color-mix(in srgb, var(--bg-primary) 80%, transparent)'
          : 'transparent',
        backdropFilter: scrolled ? 'blur(12px)' : 'none',
        borderBottom: scrolled ? '1px solid var(--border)' : '1px solid transparent',
      }}
    >
      <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Logo */}
        <a href="#" className="text-xl font-bold no-underline" style={{ color: 'var(--text-primary)' }}>
          Lil Dude<span style={{ color: '#3b82f6' }}>.</span>
        </a>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-6">
          {NAV_LINKS.map((link) => (
            <a
              key={link.label}
              href={link.href}
              className="text-sm no-underline transition-colors duration-200 hover:opacity-80"
              style={{ color: 'var(--text-secondary)' }}
              {...(link.external
                ? { target: '_blank', rel: 'noopener noreferrer' }
                : {})}
            >
              {link.label}
              {link.external && (
                <span className="ml-1 text-xs" aria-hidden="true">
                  ↗
                </span>
              )}
            </a>
          ))}

          <ThemeToggle theme={theme} onToggle={toggle} />

          <a
            href="#quickstart"
            className="text-sm font-semibold no-underline px-5 py-2 rounded-full transition-all duration-200 hover:opacity-90"
            style={{
              backgroundColor: 'var(--accent)',
              color: '#fff',
            }}
          >
            Get Started
          </a>
        </div>

        {/* Mobile hamburger */}
        <button
          className="md:hidden flex flex-col gap-1.5 p-2 cursor-pointer"
          onClick={() => setMobileOpen((prev) => !prev)}
          aria-label="Toggle navigation menu"
          style={{ background: 'none', border: 'none' }}
        >
          <span
            className="block w-5 h-0.5 rounded transition-transform duration-200"
            style={{
              backgroundColor: 'var(--text-primary)',
              transform: mobileOpen ? 'rotate(45deg) translateY(4px)' : 'none',
            }}
          />
          <span
            className="block w-5 h-0.5 rounded transition-opacity duration-200"
            style={{
              backgroundColor: 'var(--text-primary)',
              opacity: mobileOpen ? 0 : 1,
            }}
          />
          <span
            className="block w-5 h-0.5 rounded transition-transform duration-200"
            style={{
              backgroundColor: 'var(--text-primary)',
              transform: mobileOpen ? 'rotate(-45deg) translateY(-4px)' : 'none',
            }}
          />
        </button>
      </nav>

      {/* Mobile dropdown */}
      {mobileOpen && (
        <div
          className="md:hidden absolute top-16 left-0 right-0 px-4 pb-4 pt-2"
          style={{
            backgroundColor: 'var(--bg-surface)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <div className="flex flex-col gap-3">
            {NAV_LINKS.map((link) => (
              <a
                key={link.label}
                href={link.href}
                className="text-sm no-underline py-2"
                style={{ color: 'var(--text-secondary)' }}
                onClick={() => setMobileOpen(false)}
                {...(link.external
                  ? { target: '_blank', rel: 'noopener noreferrer' }
                  : {})}
              >
                {link.label}
                {link.external && (
                  <span className="ml-1 text-xs" aria-hidden="true">
                    ↗
                  </span>
                )}
              </a>
            ))}

            <div className="flex items-center gap-3 pt-2">
              <ThemeToggle theme={theme} onToggle={toggle} />
              <a
                href="#quickstart"
                className="text-sm font-semibold no-underline px-5 py-2 rounded-full flex-1 text-center"
                style={{
                  backgroundColor: 'var(--accent)',
                  color: '#fff',
                }}
                onClick={() => setMobileOpen(false)}
              >
                Get Started
              </a>
            </div>
          </div>
        </div>
      )}
    </header>
  )
}
