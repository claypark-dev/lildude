import type { FC } from 'react'
import { Sparkles, Cpu } from 'lucide-react'
import { SectionHeading } from './SectionHeading'
import { providers } from '../data/providers'
import { useInView } from '../hooks/useInView'
import { brandIconMap } from './BrandIcons'

const lucideProviderIconMap: Record<string, FC<{ size?: number; strokeWidth?: number; color?: string }>> = {
  Sparkles,
  Cpu,
}

const ProviderIcon: FC<{ iconType: 'brand' | 'lucide'; iconName: string }> = ({ iconType, iconName }) => {
  if (iconType === 'brand') {
    const BrandIcon = brandIconMap[iconName]
    if (BrandIcon) {
      return <BrandIcon size={18} color="var(--text-secondary)" />
    }
  }
  const LucideIcon = lucideProviderIconMap[iconName]
  if (LucideIcon) {
    return <LucideIcon size={18} strokeWidth={1.5} color="var(--text-secondary)" />
  }
  return null
}

export const Providers: FC = () => {
  const { ref, isInView } = useInView(0.1)

  return (
    <section
      className="w-full py-20 px-4"
      style={{ backgroundColor: 'var(--bg-primary)' }}
    >
      <div className="max-w-4xl mx-auto">
        <SectionHeading
          title="The Quiver"
          subtitle="5 LLM providers, smart routing picks the cheapest one"
          id="providers"
        />
        <div
          ref={ref}
          className="transition-all duration-700"
          style={{
            opacity: isInView ? 1 : 0,
            transform: isInView ? 'translateY(0)' : 'translateY(24px)',
          }}
        >
          <div className="flex flex-wrap justify-center gap-4 mb-8">
            {providers.map((provider) => (
              <div
                key={provider.name}
                className="flex items-center gap-2 rounded-full px-5 py-3"
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  border: '1px solid var(--border)',
                }}
              >
                <ProviderIcon iconType={provider.iconType} iconName={provider.iconName} />
                <span
                  className="font-bold"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {provider.name}
                </span>
                <span
                  className="text-sm"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {provider.models}
                </span>
                {provider.highlight && (
                  <span
                    className="text-xs font-semibold rounded-full px-2 py-0.5 ml-1"
                    style={{
                      backgroundColor: 'var(--accent)',
                      color: '#fff',
                    }}
                  >
                    {provider.highlight}
                  </span>
                )}
              </div>
            ))}
          </div>
          <p
            className="text-center text-sm"
            style={{ color: 'var(--text-secondary)' }}
          >
            Simple messages &rarr; cheap models. Complex tasks &rarr; powerful models.
            Ollama &rarr; always free.
          </p>
        </div>
      </div>
    </section>
  )
}
