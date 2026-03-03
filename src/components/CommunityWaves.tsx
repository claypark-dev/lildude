import type { FC } from 'react'
import { SectionHeading } from './SectionHeading'
import { useInView } from '../hooks/useInView'

interface WaveCategory {
  category: string
  waves: string[]
  color: string
}

const categories: WaveCategory[] = [
  { category: 'Productivity', waves: ['note-taker', 'todo-manager', 'file-organizer', 'timer-pomodoro', 'clipboard-saver'], color: '#10b981' },
  { category: 'Communication', waves: ['email-template', 'quick-reply', 'contact-lookup'], color: '#3b82f6' },
  { category: 'Finance', waves: ['expense-tracker', 'currency-converter', 'receipt-parser'], color: '#f59e0b' },
  { category: 'Utilities', waves: ['weather-checker', 'timezone-converter', 'unit-converter', 'text-summarizer', 'url-shortener'], color: '#8b5cf6' },
  { category: 'Social', waves: ['birthday-reminder', 'rsvp-tracker', 'gift-ideas', 'social-scheduler'], color: '#ec4899' },
]

export const CommunityWaves: FC = () => {
  const { ref, isInView } = useInView(0.1)

  return (
    <section
      className="w-full py-20 px-4"
      style={{ backgroundColor: 'var(--bg-primary)' }}
    >
      <div className="max-w-4xl mx-auto">
        <SectionHeading
          title="20+ Verified Waves"
          subtitle="Pre-built capabilities. Security-scanned. HMAC-signed. One-click install."
          id="waves"
        />
        <div
          ref={ref}
          className="transition-all duration-700"
          style={{
            opacity: isInView ? 1 : 0,
            transform: isInView ? 'translateY(0)' : 'translateY(24px)',
          }}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
            {categories.map((cat) => (
              <div
                key={cat.category}
                className="rounded-lg p-5"
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  border: '1px solid var(--border)',
                }}
              >
                <h4
                  className="font-bold text-base mb-3"
                  style={{ color: cat.color }}
                >
                  {cat.category}
                </h4>
                <div className="flex flex-wrap gap-2">
                  {cat.waves.map((wave) => (
                    <span
                      key={wave}
                      className="text-xs font-mono px-2 py-1 rounded"
                      style={{
                        backgroundColor: 'var(--bg-primary)',
                        color: 'var(--text-secondary)',
                        border: '1px solid var(--border)',
                      }}
                    >
                      {wave}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Install + Registry info */}
          <div
            className="rounded-lg p-6 text-center"
            style={{
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-accent)',
            }}
          >
            <p
              className="font-mono text-sm mb-3"
              style={{ color: 'var(--accent)' }}
            >
              lil-dude wave install hub:weather-checker
            </p>
            <p
              className="text-sm"
              style={{ color: 'var(--text-secondary)' }}
            >
              All waves are deterministic-first, verified by the CI pipeline, and auto-update from the community registry.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
