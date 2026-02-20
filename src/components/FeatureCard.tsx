import { type FC, useState } from 'react'
import { Zap, MessageSquare, Shield, Puzzle, Mic, Sunrise, Globe, HardDrive, Layers } from 'lucide-react'

const lucideIconMap: Record<string, FC<{ size?: number; strokeWidth?: number; color?: string }>> = {
  Zap,
  MessageSquare,
  Shield,
  Puzzle,
  Mic,
  Sunrise,
  Globe,
  HardDrive,
  Layers,
}

interface FeatureCardProps {
  icon: string
  title: string
  description: string
}

export const FeatureCard: FC<FeatureCardProps> = ({ icon, title, description }) => {
  const [isHovered, setIsHovered] = useState(false)
  const IconComponent = lucideIconMap[icon]

  return (
    <div
      className="rounded-xl p-6 transition-all duration-300"
      style={{
        backgroundColor: 'var(--bg-surface)',
        border: `1px solid ${isHovered ? 'var(--border-accent)' : 'var(--border)'}`,
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="mb-4">
        {IconComponent ? (
          <IconComponent size={28} strokeWidth={1.5} color="var(--accent)" />
        ) : (
          <span className="text-3xl">{icon}</span>
        )}
      </div>
      <h3
        className="text-lg font-semibold mb-2"
        style={{ color: 'var(--text-primary)' }}
      >
        {title}
      </h3>
      <p
        className="text-sm leading-relaxed"
        style={{ color: 'var(--text-secondary)' }}
      >
        {description}
      </p>
    </div>
  )
}
