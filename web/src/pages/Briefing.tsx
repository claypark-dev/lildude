import { useCallback } from 'react';
import { useApi } from '../hooks/useApi.ts';
import { fetchBriefing } from '../lib/api.ts';
import type { BriefingSection, BriefingItem, BriefingSummary } from '../lib/types.ts';

/** Daily Briefing page showing a structured summary of all system activity */
export function Briefing() {
  const briefing = useApi(useCallback(() => fetchBriefing(), []));

  return (
    <div className="space-y-8 max-w-5xl">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-white">Daily Briefing</h2>
        <button
          type="button"
          onClick={briefing.refetch}
          className="text-sm px-3 py-1.5 bg-amber-500/10 text-amber-400 rounded-lg hover:bg-amber-500/20 transition-colors"
        >
          Refresh
        </button>
      </div>

      {briefing.loading && (
        <p className="text-slate-400 text-sm">Generating briefing...</p>
      )}
      {briefing.error && (
        <p className="text-red-400 text-sm">{briefing.error}</p>
      )}

      {briefing.data && (
        <>
          {/* Greeting */}
          <div className="bg-gradient-to-r from-amber-500/10 to-slate-800 rounded-xl p-6 border border-amber-500/20">
            <p className="text-lg text-amber-300">{briefing.data.greeting}</p>
            <p className="text-xs text-slate-400 mt-2">
              Generated {formatTimestamp(briefing.data.generatedAt)}
            </p>
          </div>

          {/* Summary Cards */}
          <SummaryCards summary={briefing.data.summary} />

          {/* Sections */}
          {briefing.data.sections.map((section) => (
            <SectionCard key={section.title} section={section} />
          ))}
        </>
      )}
    </div>
  );
}

/** Summary stat cards row */
function SummaryCards({ summary }: { summary: BriefingSummary }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      <SummaryCard label="Skills" value={String(summary.activeSkills)} color="text-amber-400" />
      <SummaryCard label="Scheduled" value={String(summary.scheduledJobs)} color="text-blue-400" />
      <SummaryCard label="Pending" value={String(summary.pendingTasks)} color="text-purple-400" />
      <SummaryCard
        label="Today"
        value={`$${summary.todayCostUsd.toFixed(4)}`}
        color={summary.todayCostUsd > 1 ? 'text-red-400' : 'text-green-400'}
      />
      <SummaryCard
        label="Month"
        value={`$${summary.monthlyCostUsd.toFixed(4)}`}
        color={summary.monthlyCostUsd > 10 ? 'text-red-400' : 'text-green-400'}
      />
    </div>
  );
}

/** Individual summary stat card */
function SummaryCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-slate-800 rounded-xl p-4 border border-slate-700 text-center">
      <p className="text-xs text-slate-400 uppercase tracking-wide">{label}</p>
      <p className={`text-lg font-semibold mt-1 ${color}`}>{value}</p>
    </div>
  );
}

/** Briefing section card with items */
function SectionCard({ section }: { section: BriefingSection }) {
  return (
    <section className="bg-slate-800 rounded-xl p-6 border border-slate-700">
      <h3 className="text-lg font-semibold text-white mb-4">
        <span className="mr-2">{section.icon}</span>
        {section.title}
      </h3>
      <div className="space-y-2">
        {section.items.map((item, idx) => (
          <ItemRow key={`${item.label}-${idx}`} item={item} />
        ))}
      </div>
    </section>
  );
}

/** Single briefing item row with status indicator */
function ItemRow({ item }: { item: BriefingItem }) {
  const statusColors: Record<string, string> = {
    good: 'bg-green-500',
    warning: 'bg-amber-500',
    info: 'bg-blue-500',
    neutral: 'bg-slate-500',
  };

  const dotColor = statusColors[item.status ?? 'neutral'];

  return (
    <div className="flex items-start gap-3 p-3 bg-slate-700/50 rounded-lg">
      <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${dotColor}`} />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-white font-medium truncate">{item.label}</p>
        <p className="text-xs text-slate-400 mt-0.5">{item.value}</p>
      </div>
    </div>
  );
}

/** Format ISO timestamp to a readable string */
function formatTimestamp(isoStr: string): string {
  const date = new Date(isoStr);
  return date.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
