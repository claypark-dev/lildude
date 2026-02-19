import type { FC } from 'react'
import { SectionHeading } from './SectionHeading'
import { useInView } from '../hooks/useInView'

interface RoutingTier {
  label: string
  share: number
  color: string
  description: string
}

const routingTiers: RoutingTier[] = [
  {
    label: 'Small Tier',
    share: 80,
    color: '#3b82f6',
    description: 'Haiku, GPT-4o-mini, Gemini Flash',
  },
  {
    label: 'Medium Tier',
    share: 15,
    color: '#60a5fa',
    description: 'Sonnet, GPT-4o, Gemini Pro',
  },
  {
    label: 'Large Tier',
    share: 5,
    color: '#93c5fd',
    description: 'Opus (only when needed)',
  },
]

const guardrails = [
  { label: 'Per-task token limits' },
  { label: 'Warning at 80% usage' },
  { label: 'Hard stop when exceeded' },
  { label: 'Ollama fallback (free)' },
]

export const TokenEfficiency: FC = () => {
  const { ref, isInView } = useInView(0.1)

  return (
    <section
      className="w-full py-20 px-4"
      style={{ backgroundColor: 'var(--bg-primary)' }}
    >
      <div className="max-w-4xl mx-auto">
        <SectionHeading
          title="Zero Waste"
          subtitle="Free and open-source. Smart about every token."
        />
        <div
          ref={ref}
          className="transition-all duration-700"
          style={{
            opacity: isInView ? 1 : 0,
            transform: isInView ? 'translateY(0)' : 'translateY(24px)',
          }}
        >
          {/* Routing breakdown */}
          <div className="text-center mb-6">
            <p
              className="text-sm uppercase tracking-wider font-semibold mb-1"
              style={{ color: 'var(--accent)' }}
            >
              Smart Model Routing
            </p>
            <p
              className="text-sm"
              style={{ color: 'var(--text-muted)' }}
            >
              Most messages use the smallest, fastest model
            </p>
          </div>

          <div className="max-w-lg mx-auto mb-10">
            {/* Stacked routing bar */}
            <div
              className="w-full h-8 rounded-full overflow-hidden flex"
              style={{ backgroundColor: 'var(--bg-surface-alt)' }}
            >
              {routingTiers.map((tier) => (
                <div
                  key={tier.label}
                  className="h-full flex items-center justify-center text-xs font-semibold transition-all duration-1000"
                  style={{
                    width: isInView ? `${tier.share}%` : '0%',
                    backgroundColor: tier.color,
                    color: '#000',
                  }}
                >
                  {tier.share >= 15 ? `${tier.share}%` : ''}
                </div>
              ))}
            </div>

            {/* Legend */}
            <div className="flex flex-wrap justify-center gap-4 mt-4">
              {routingTiers.map((tier) => (
                <div key={tier.label} className="flex items-center gap-2">
                  <span
                    className="w-3 h-3 rounded-full inline-block"
                    style={{ backgroundColor: tier.color }}
                  />
                  <span
                    className="text-xs"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    {tier.label} ({tier.share}%) — {tier.description}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Guardrails */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
            {guardrails.map((point) => (
              <div
                key={point.label}
                className="rounded-lg p-4 text-center"
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  border: '1px solid var(--border)',
                }}
              >
                <span
                  className="text-sm font-medium"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {point.label}
                </span>
              </div>
            ))}
          </div>

          {/* Free callout */}
          <p
            className="text-center text-sm"
            style={{ color: 'var(--text-muted)' }}
          >
            Lil Dude is free and open-source. Budget guardrails protect your third-party API spend.
          </p>
        </div>
      </div>
    </section>
  )
}
