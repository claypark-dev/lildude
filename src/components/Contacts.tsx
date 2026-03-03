import type { FC } from 'react'
import { SectionHeading } from './SectionHeading'
import { useInView } from '../hooks/useInView'

interface TrustLevel {
  level: string
  label: string
  access: string
  color: string
}

const trustLevels: TrustLevel[] = [
  { level: 'owner', label: 'Owner', access: 'Full access to all waves and features', color: '#10b981' },
  { level: 'trusted', label: 'Trusted', access: 'observe, create, and modify waves', color: '#3b82f6' },
  { level: 'known', label: 'Known', access: 'observe-tier waves only (read-only)', color: '#f59e0b' },
  { level: 'unknown', label: 'Unknown', access: 'Messages only — no wave access', color: '#ef4444' },
]

interface ExternalWave {
  name: string
  tier: string
  description: string
}

const externalWaves: ExternalWave[] = [
  { name: 'availability-check', tier: 'observe', description: "Check owner's free time slots (no event details)" },
  { name: 'meeting-request', tier: 'create', description: 'Propose meeting times for owner approval' },
  { name: 'message-relay', tier: 'create', description: 'Leave messages with urgency tagging' },
  { name: 'contact-share', tier: 'observe', description: "Get owner's shareable contact info" },
  { name: 'auto-responder', tier: 'observe', description: "Automatic away message (deterministic)" },
]

export const Contacts: FC = () => {
  const { ref, isInView } = useInView(0.1)

  return (
    <section
      className="w-full py-20 px-4"
      style={{ backgroundColor: 'var(--bg-surface)' }}
    >
      <div className="max-w-4xl mx-auto">
        <SectionHeading
          title="Contact Management"
          subtitle="Your Lil Dude knows who's talking to it. Trust levels gate what each person can do."
          id="contacts"
        />
        <div
          ref={ref}
          className="transition-all duration-700"
          style={{
            opacity: isInView ? 1 : 0,
            transform: isInView ? 'translateY(0)' : 'translateY(24px)',
          }}
        >
          {/* Trust Levels */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-12">
            {trustLevels.map((tl) => (
              <div
                key={tl.level}
                className="rounded-lg p-5"
                style={{
                  backgroundColor: 'var(--bg-primary)',
                  border: '1px solid var(--border)',
                }}
              >
                <div className="flex items-center gap-3 mb-2">
                  <span
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: tl.color }}
                  />
                  <h4
                    className="font-bold text-lg"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    {tl.label}
                  </h4>
                </div>
                <p
                  className="text-sm"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {tl.access}
                </p>
              </div>
            ))}
          </div>

          {/* External Waves */}
          <h3
            className="text-xl font-bold mb-4 text-center"
            style={{ color: 'var(--text-primary)' }}
          >
            External User Waves
          </h3>
          <p
            className="text-sm text-center mb-6 max-w-xl mx-auto"
            style={{ color: 'var(--text-secondary)' }}
          >
            Friends interact with your Lil Dude safely — checking availability, requesting meetings, and leaving messages — without needing you present.
          </p>
          <div className="flex flex-col gap-3">
            {externalWaves.map((wave) => (
              <div
                key={wave.name}
                className="flex items-center gap-4 rounded-lg p-4"
                style={{
                  backgroundColor: 'var(--bg-primary)',
                  border: '1px solid var(--border)',
                }}
              >
                <code
                  className="text-sm font-mono shrink-0 px-2 py-1 rounded"
                  style={{
                    backgroundColor: 'var(--bg-surface)',
                    color: 'var(--accent)',
                  }}
                >
                  {wave.name}
                </code>
                <span
                  className="text-xs font-semibold rounded-full px-2 py-0.5 shrink-0"
                  style={{
                    backgroundColor: wave.tier === 'observe' ? 'rgba(16,185,129,0.15)' : 'rgba(59,130,246,0.15)',
                    color: wave.tier === 'observe' ? '#10b981' : '#3b82f6',
                  }}
                >
                  {wave.tier}
                </span>
                <span
                  className="text-sm hidden sm:inline"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {wave.description}
                </span>
              </div>
            ))}
          </div>

          {/* Features list */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-8">
            <div
              className="rounded-lg p-4 text-center"
              style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border)' }}
            >
              <p className="text-2xl font-bold" style={{ color: 'var(--accent)' }}>Per-Contact</p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>Rate limits + budget caps</p>
            </div>
            <div
              className="rounded-lg p-4 text-center"
              style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border)' }}
            >
              <p className="text-2xl font-bold" style={{ color: 'var(--accent)' }}>Groups</p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>Organize contacts by category</p>
            </div>
            <div
              className="rounded-lg p-4 text-center"
              style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border)' }}
            >
              <p className="text-2xl font-bold" style={{ color: 'var(--accent)' }}>Full Audit</p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>Every external interaction logged</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
