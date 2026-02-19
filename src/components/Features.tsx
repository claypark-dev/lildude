import type { FC } from 'react'
import { SectionHeading } from './SectionHeading'
import { FeatureCard } from './FeatureCard'
import { WaveDivider } from './WaveDivider'
import { features } from '../data/features'
import { useInView } from '../hooks/useInView'

export const Features: FC = () => {
  const { ref, isInView } = useInView(0.1)

  return (
    <section
      className="w-full py-20 px-4"
      style={{ backgroundColor: 'var(--bg-primary)' }}
    >
      <div className="max-w-6xl mx-auto">
        <SectionHeading
          title="The Lineup"
          subtitle="Everything your lil dude can do"
          id="features"
        />
        <div
          ref={ref}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 transition-all duration-700"
          style={{
            opacity: isInView ? 1 : 0,
            transform: isInView ? 'translateY(0)' : 'translateY(24px)',
          }}
        >
          {features.map((feature) => (
            <FeatureCard
              key={feature.title}
              icon={feature.icon}
              title={feature.title}
              description={feature.description}
            />
          ))}
        </div>
      </div>
      <WaveDivider />
    </section>
  )
}
