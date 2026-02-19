import type { FC } from 'react'

export const CallToAction: FC = () => {
  return (
    <section
      className="w-full py-24 px-4"
      style={{
        background: 'linear-gradient(180deg, rgba(59,130,246,0.05) 0%, transparent 100%)',
      }}
    >
      <div className="max-w-2xl mx-auto text-center">
        <h2
          className="text-3xl font-bold mb-4"
          style={{ color: 'var(--text-primary)' }}
        >
          Ready to paddle out?
        </h2>
        <p
          className="text-lg mb-10"
          style={{ color: 'var(--text-secondary)' }}
        >
          Your assistant is waiting.
        </p>
        <div className="flex items-center justify-center gap-4 flex-wrap">
          <a
            href="#quickstart"
            className="inline-flex items-center justify-center px-8 py-3 rounded-lg font-semibold text-white transition-opacity duration-200 hover:opacity-90"
            style={{ backgroundColor: 'var(--accent)' }}
          >
            Get Started
          </a>
          <a
            href="https://github.com/claypark-dev/lildude#readme"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center px-8 py-3 rounded-lg font-semibold transition-colors duration-200"
            style={{
              color: 'var(--text-primary)',
              border: '1px solid var(--border)',
              backgroundColor: 'transparent',
            }}
            onMouseEnter={(event) => {
              (event.currentTarget as HTMLAnchorElement).style.borderColor = 'var(--border-accent)'
            }}
            onMouseLeave={(event) => {
              (event.currentTarget as HTMLAnchorElement).style.borderColor = 'var(--border)'
            }}
          >
            Read the Docs
          </a>
        </div>
      </div>
    </section>
  )
}
