import type { FC } from 'react'
import { SectionHeading } from './SectionHeading'
import { useInView } from '../hooks/useInView'

const DIAGRAM = `  Discord ─┐
 Telegram ─┤
 iMessage ─┤                              ┌─ Anthropic (Claude)
    Slack ─┤     ┌──────────────────┐      ├─ OpenAI (GPT-4o)
 WhatsApp ─┼────▸│   Agent Loop      │─────▸├─ Google (Gemini)
   Signal ─┤     │                  │      ├─ DeepSeek
  WebChat ─┤     │  Sanitize        │      ├─ Ollama (local)
      CLI ─┘     │  ▸ Security Gate │      └─ Groq (voice)
                 │  ▸ Cost Gate     │
                 │  ▸ Route Model   │     ┌─ Shell (sandboxed)
                 │  ▸ Build Context │────▸├─ Browser
                 │  ▸ LLM Call      │     ├─ File I/O
                 │  ▸ Tool Loop     │     ├─ HTTP fetch
                 │  ▸ Track Cost    │     └─ Crypto, calendar...
                 └──────────────────┘
                         │
                    SQLite (local)`

export const Architecture: FC = () => {
  const { ref, isInView } = useInView(0.1)

  return (
    <section
      className="w-full py-20 px-4"
      style={{ backgroundColor: 'var(--bg-primary)' }}
    >
      <div className="max-w-5xl mx-auto">
        <SectionHeading
          title="Under the Hood"
          subtitle="Every message, same pipeline"
        />
        <div
          ref={ref}
          className="transition-all duration-700"
          style={{
            opacity: isInView ? 1 : 0,
            transform: isInView ? 'translateY(0)' : 'translateY(24px)',
          }}
        >
          <div
            className="rounded-xl p-6 overflow-x-auto"
            style={{
              backgroundColor: 'var(--bg-code)',
              border: '1px solid var(--border)',
            }}
          >
            <pre
              className="font-mono text-sm leading-relaxed whitespace-pre"
              style={{ color: 'var(--text-primary)' }}
            >
              {DIAGRAM}
            </pre>
          </div>
          <p
            className="text-center mt-8 text-sm"
            style={{ color: 'var(--text-secondary)' }}
          >
            Sanitize &rarr; Gate &rarr; Route &rarr; Call &rarr; Execute &rarr; Track.
            Every token is logged, every command parsed.
          </p>
        </div>
      </div>
    </section>
  )
}
