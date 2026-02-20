import { type FC, useState } from 'react'
import { MessageCircle, Globe, Terminal } from 'lucide-react'
import { SectionHeading } from './SectionHeading'
import { channels } from '../data/channels'
import { useInView } from '../hooks/useInView'
import { brandIconMap } from './BrandIcons'

const lucideChannelIconMap: Record<string, FC<{ size?: number; strokeWidth?: number; color?: string }>> = {
  MessageCircle,
  Globe,
  Terminal,
}

interface ChannelCardProps {
  name: string
  description: string
  color: string
  iconType: 'brand' | 'lucide'
  iconName: string
}

const ChannelCard: FC<ChannelCardProps> = ({ name, description, color, iconType, iconName }) => {
  const [isHovered, setIsHovered] = useState(false)
  const iconColor = isHovered ? color : 'var(--text-secondary)'

  const renderIcon = () => {
    if (iconType === 'brand') {
      const BrandIcon = brandIconMap[iconName]
      if (BrandIcon) {
        return <BrandIcon size={24} color={iconColor} />
      }
    }
    const LucideIcon = lucideChannelIconMap[iconName]
    if (LucideIcon) {
      return <LucideIcon size={24} strokeWidth={1.5} color={iconColor} />
    }
    return null
  }

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
      <div className="flex justify-center mb-3 transition-colors duration-300">
        {renderIcon()}
      </div>
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
              iconType={channel.iconType}
              iconName={channel.iconName}
            />
          ))}
        </div>
      </div>
    </section>
  )
}
