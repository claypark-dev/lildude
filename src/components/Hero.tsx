import type { FC } from 'react'
import { WaveDivider } from './WaveDivider'

const ASCII_ART = `  _     _ _   ____            _
 | |   (_) | |  _ \\ _   _  __| | ___
 | |   | | | | | | | | | |/ _\` |/ _ \\
 | |___| | | | |_| | |_| | (_| |  __/
 |_____|_|_| |____/ \\__,_|\\__,_|\\___|`

export const Hero: FC = () => {
  return (
    <section
      className="relative min-h-screen flex flex-col items-center justify-center px-4 pt-20 pb-0"
      style={{ backgroundColor: 'var(--bg-primary)' }}
    >
      <div className="text-center max-w-4xl mx-auto">
        {/* ASCII art */}
        <pre
          className="text-xs sm:text-sm md:text-base font-mono mb-8 inline-block text-left"
          style={{
            color: '#60a5fa',
            textShadow: '0 0 20px rgba(59, 130, 246, 0.5), 0 0 40px rgba(59, 130, 246, 0.2)',
          }}
          aria-hidden="true"
        >
          {ASCII_ART}
        </pre>

        {/* Main heading */}
        <h1
          className="text-5xl md:text-7xl font-bold mb-6"
          style={{ color: 'var(--text-primary)' }}
        >
          Your lil AI dude.
        </h1>

        {/* Subheading */}
        <p
          className="text-lg md:text-xl mb-10 max-w-2xl mx-auto"
          style={{ color: 'var(--text-secondary)' }}
        >
          Self-hosted. Multi-channel. Privacy-first. Absurdly affordable.
        </p>

        {/* CTA buttons */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <a
            href="#quickstart"
            className="text-base font-semibold no-underline px-8 py-3 rounded-full transition-all duration-200 hover:opacity-90 hover:scale-105"
            style={{
              backgroundColor: '#3b82f6',
              color: '#fff',
            }}
          >
            Paddle Out &rarr;
          </a>
          <a
            href="https://github.com/claypark-dev/lildude"
            target="_blank"
            rel="noopener noreferrer"
            className="text-base font-semibold no-underline px-8 py-3 rounded-full transition-all duration-200 hover:opacity-80"
            style={{
              backgroundColor: 'transparent',
              color: 'var(--text-primary)',
              border: '1px solid var(--border)',
            }}
          >
            GitHub
          </a>
        </div>
      </div>

      {/* Wave at bottom */}
      <div className="absolute bottom-0 left-0 right-0">
        <WaveDivider />
      </div>
    </section>
  )
}
