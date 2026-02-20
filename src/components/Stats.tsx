import type { FC } from 'react'
import { useInView } from '../hooks/useInView'
import { useAnimatedCounter } from '../hooks/useAnimatedCounter'

interface StatItemProps {
  value: number
  label: string
  prefix?: string
  suffix?: string
  isInView: boolean
  formatted?: boolean
}

const StatItem: FC<StatItemProps> = ({ value, label, prefix, suffix, isInView, formatted }) => {
  const counter = useAnimatedCounter(value, 1500, isInView)

  const displayValue = formatted
    ? counter.toLocaleString()
    : counter.toString()

  return (
    <div className="flex flex-col items-center px-6 py-4">
      <span
        className="text-4xl font-bold"
        style={{ color: 'var(--accent)' }}
      >
        {prefix ?? ''}{displayValue}{suffix ?? ''}
      </span>
      <span
        className="text-sm mt-1"
        style={{ color: 'var(--text-secondary)' }}
      >
        {label}
      </span>
    </div>
  )
}

export const Stats: FC = () => {
  const { ref, isInView } = useInView(0.2)

  return (
    <section
      ref={ref}
      className="w-full py-12"
      style={{
        background: 'linear-gradient(180deg, rgba(59,130,246,0.08) 0%, var(--bg-surface) 40%, var(--bg-surface) 100%)',
      }}
    >
      <div className="max-w-5xl mx-auto px-4">
        <div className="flex flex-wrap justify-center gap-2">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 w-full gap-2">
            <StatItem value={5} label="Providers" isInView={isInView} />
            <StatItem value={8} label="Channels" isInView={isInView} />
            <StatItem value={5} label="Security Levels" isInView={isInView} />
            <StatItem value={1569} label="Tests" isInView={isInView} formatted />
            <StatItem value={3} label="Routing Tiers" isInView={isInView} />
          </div>
        </div>
      </div>
    </section>
  )
}
