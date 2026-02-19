import { type FC, useState } from 'react'
import { SectionHeading } from './SectionHeading'
import { CodeBlock } from './CodeBlock'
import { quickstartTabs } from '../data/quickstart'

export const QuickStart: FC = () => {
  const [activeTabId, setActiveTabId] = useState(quickstartTabs[0].id)
  const activeTab = quickstartTabs.find((tab) => tab.id === activeTabId) ?? quickstartTabs[0]

  return (
    <section
      className="w-full py-20 px-4"
      style={{ backgroundColor: 'var(--bg-primary)' }}
    >
      <div className="max-w-3xl mx-auto">
        <SectionHeading
          title="Wax Up"
          subtitle="Paddle out in 60 seconds"
          id="quickstart"
        />

        <div
          className="flex gap-0 mb-6"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          {quickstartTabs.map((tab) => {
            const isActive = tab.id === activeTabId
            return (
              <button
                key={tab.id}
                type="button"
                className="px-4 py-3 text-sm font-medium transition-colors duration-200 relative"
                style={{
                  color: isActive ? 'var(--accent)' : 'var(--text-muted)',
                  borderBottom: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                  marginBottom: '-1px',
                }}
                onClick={() => setActiveTabId(tab.id)}
                onMouseEnter={(event) => {
                  if (!isActive) {
                    (event.currentTarget as HTMLButtonElement).style.color = 'var(--text-secondary)'
                  }
                }}
                onMouseLeave={(event) => {
                  if (!isActive) {
                    (event.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)'
                  }
                }}
              >
                {tab.label}
              </button>
            )
          })}
        </div>

        <CodeBlock code={activeTab.code} />
      </div>
    </section>
  )
}
