import { type FC, useState } from 'react'
import { SectionHeading } from './SectionHeading'
import { channels } from '../data/channels'
import { useInView } from '../hooks/useInView'

interface ChannelCardProps {
  name: string
  description: string
  color: string
}

const ChannelCard: FC<ChannelCardProps> = ({ name, description, color }) => {
  const [isHovered, setIsHovered] = useState(false)

  return (
    <div
      className="rounded-xl p-5 text-center transition-colors duration-300"
      style={{
        backgroundColor: 'var(--bg-surface)',
        border: `1px solid ${isHovered ? color : 'var(--border)'}`,
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <h3
        className="font-semibold mb-1"
        style={{ color: 'var(--text-primary)' }}
      >
        {name}
      </h3>
      <p
        className="text-xs"
        style={{ color: 'var(--text-secondary)' }}
      >
        {description}
      </p>
    </div>
  )
}

export const Channels: FC = () => {
  const { ref, isInView } = useInView(0.1)

  return (
    <section
      className="w-full py-20 px-4"
      style={{ backgroundColor: 'var(--bg-primary)' }}
    >
      <div className="max-w-4xl mx-auto">
        <SectionHeading
          title="Catch Every Wave"
          subtitle="8 messaging platforms. One assistant."
          id="channels"
        />
        <div
          ref={ref}
          className="grid grid-cols-2 md:grid-cols-4 gap-4 transition-all duration-700"
          style={{
            opacity: isInView ? 1 : 0,
            transform: isInView ? 'translateY(0)' : 'translateY(24px)',
          }}
        >
          {channels.map((channel) => (
            <ChannelCard
              key={channel.name}
              name={channel.name}
              description={channel.description}
              color={channel.color}
            />
          ))}
        </div>
      </div>
    </section>
  )
}
