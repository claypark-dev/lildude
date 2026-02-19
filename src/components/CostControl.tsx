import type { FC } from 'react'
import { SectionHeading } from './SectionHeading'
import { useInView } from '../hooks/useInView'

interface CostPoint {
  label: string
}

const costPoints: CostPoint[] = [
  { label: '$0.50 per task budget' },
  { label: 'Warning at 80%' },
  { label: 'Hard stop when exceeded' },
  { label: 'Ollama fallback (free)' },
]

export const CostControl: FC = () => {
  const { ref, isInView } = useInView(0.1)

  return (
    <section
      className="w-full py-20 px-4"
      style={{ backgroundColor: 'var(--bg-primary)' }}
    >
      <div className="max-w-4xl mx-auto">
        <SectionHeading
          title="Zero Surprises"
          subtitle="Absurdly affordable by design"
        />
        <div
          ref={ref}
          className="transition-all duration-700"
          style={{
            opacity: isInView ? 1 : 0,
            transform: isInView ? 'translateY(0)' : 'translateY(24px)',
          }}
        >
          <div className="text-center mb-10">
            <div className="flex items-baseline justify-center gap-1">
              <span
                className="text-7xl font-bold"
                style={{ color: 'var(--accent)' }}
              >
                $20
              </span>
              <span
                className="text-2xl"
                style={{ color: 'var(--text-secondary)' }}
              >
                /mo
              </span>
            </div>
            <p
              className="mt-2 text-sm"
              style={{ color: 'var(--text-muted)' }}
            >
              default monthly budget
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
            {costPoints.map((point) => (
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

          <div className="max-w-lg mx-auto">
            <div
              className="w-full h-4 rounded-full overflow-hidden"
              style={{ backgroundColor: 'var(--bg-surface-alt)' }}
            >
              <div
                className="h-full rounded-full transition-all duration-1000"
                style={{
                  width: '35%',
                  backgroundColor: 'var(--accent)',
                }}
              />
            </div>
            <p
              className="text-center mt-3 text-sm"
              style={{ color: 'var(--text-secondary)' }}
            >
              $7.00 / $20.00 this month
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
