import type { FC } from 'react'

interface SectionHeadingProps {
  title: string
  subtitle?: string
  id?: string
}

export const SectionHeading: FC<SectionHeadingProps> = ({ title, subtitle, id }) => {
  return (
    <div className="text-center mb-12" id={id}>
      <h2
        className="text-3xl md:text-4xl font-bold mb-4"
        style={{ color: 'var(--text-primary)' }}
      >
        {title}
      </h2>
      {subtitle && (
        <p
          className="text-lg max-w-2xl mx-auto"
          style={{ color: 'var(--text-secondary)' }}
        >
          {subtitle}
        </p>
      )}
    </div>
  )
}
