import type { FC } from 'react'
import { SectionHeading } from './SectionHeading'
import { useInView } from '../hooks/useInView'

interface SecurityLevel {
  level: number
  name: string
  description: string
  isDefault: boolean
}

const securityLevels: SecurityLevel[] = [
  { level: 1, name: 'Lockdown', description: 'All shell blocked, read-only files', isDefault: false },
  { level: 2, name: 'Cautious', description: 'Allowlist only, approved paths', isDefault: false },
  { level: 3, name: 'Balanced', description: 'Allowlist + approval queue', isDefault: true },
  { level: 4, name: 'Power User', description: 'Most allowed, minimal restrictions', isDefault: false },
  { level: 5, name: 'Full Trust', description: 'Everything except blocklist', isDefault: false },
]

interface KeyFeature {
  icon: string
  title: string
  description: string
}

const keyFeatures: KeyFeature[] = [
  { icon: '{}', title: 'Command Parsing', description: 'Parsed, not string-matched' },
  { icon: '🔍', title: 'Injection Detection', description: 'Content scanned before processing' },
  { icon: '✋', title: 'Approval Queue', description: 'High-risk actions require confirmation' },
  { icon: '🖥️', title: 'Cross-Platform', description: 'Unix + Windows patterns covered' },
]

export const Security: FC = () => {
  const { ref, isInView } = useInView(0.1)

  return (
    <section
      className="w-full py-20 px-4"
      style={{ backgroundColor: 'var(--bg-primary)' }}
    >
      <div className="max-w-4xl mx-auto">
        <SectionHeading
          title="Gnarly Security"
          subtitle="Five levels. Zero wipeouts."
          id="security"
        />
        <div
          ref={ref}
          className="transition-all duration-700"
          style={{
            opacity: isInView ? 1 : 0,
            transform: isInView ? 'translateY(0)' : 'translateY(24px)',
          }}
        >
          <div className="flex flex-col gap-3 mb-12">
            {securityLevels.map((tier) => (
              <div
                key={tier.level}
                className="flex items-center gap-4 rounded-lg p-4"
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  border: `1px solid ${tier.isDefault ? 'var(--border-accent)' : 'var(--border)'}`,
                }}
              >
                <span
                  className="text-2xl font-bold shrink-0 w-10 text-center"
                  style={{ color: tier.isDefault ? 'var(--accent)' : 'var(--text-primary)' }}
                >
                  {tier.level}
                </span>
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <span
                    className="font-semibold shrink-0"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    {tier.name}
                  </span>
                  {tier.isDefault && (
                    <span
                      className="text-xs font-semibold rounded-full px-2 py-0.5 shrink-0"
                      style={{
                        backgroundColor: 'var(--accent)',
                        color: '#fff',
                      }}
                    >
                      Default
                    </span>
                  )}
                  <span
                    className="text-sm hidden sm:inline"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    &mdash; {tier.description}
                  </span>
                </div>
                <span
                  className="text-sm sm:hidden"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {tier.description}
                </span>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {keyFeatures.map((feature) => (
              <div
                key={feature.title}
                className="flex items-start gap-3 rounded-lg p-4"
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  border: '1px solid var(--border)',
                }}
              >
                <span className="text-xl shrink-0">{feature.icon}</span>
                <div>
                  <h4
                    className="font-semibold text-sm"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    {feature.title}
                  </h4>
                  <p
                    className="text-xs mt-0.5"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    {feature.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
