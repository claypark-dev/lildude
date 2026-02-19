import { useCallback } from 'react';
import { useApi } from '../hooks/useApi.ts';
import { BudgetBar } from '../components/BudgetBar.tsx';
import { fetchHealth, fetchBudget, fetchTasks, fetchDailyUsage } from '../lib/api.ts';

/** Dashboard page showing system overview, budget, usage, and active tasks */
export function Dashboard() {
  const health = useApi(useCallback(() => fetchHealth(), []));
  const budget = useApi(useCallback(() => fetchBudget(), []));
  const tasks = useApi(useCallback(() => fetchTasks(10), []));
  const usage = useApi(useCallback(() => fetchDailyUsage(), []));

  const activeTasks = tasks.data?.tasks.filter(
    (t) => t.status === 'running' || t.status === 'pending'
  ) ?? [];

  const usageDays = usage.data?.usage.slice(-7) ?? [];
  const maxTokens = usageDays.reduce((max, d) => Math.max(max, d.totalTokens), 1);

  return (
    <div className="space-y-8 max-w-5xl">
      <h2 className="text-2xl font-bold text-white">Dashboard</h2>

      {/* Health & Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Status"
          value={health.data?.status ?? '--'}
          loading={health.loading}
          error={health.error}
          valueColor={health.data?.status === 'ok' ? 'text-green-400' : 'text-red-400'}
        />
        <StatCard
          label="Uptime"
          value={health.data ? formatUptime(health.data.uptime) : '--'}
          loading={health.loading}
          error={health.error}
        />
        <StatCard
          label="Memory"
          value={health.data ? `${health.data.memoryMb.toFixed(1)} MB` : '--'}
          loading={health.loading}
          error={health.error}
        />
        <StatCard
          label="Active Tasks"
          value={tasks.loading ? '--' : String(activeTasks.length)}
          loading={tasks.loading}
          error={tasks.error}
          valueColor="text-amber-400"
        />
      </div>

      {/* Budget */}
      <section className="bg-slate-800 rounded-xl p-6 border border-slate-700">
        <h3 className="text-lg font-semibold text-white mb-4">Monthly Budget</h3>
        {budget.loading && <p className="text-slate-400 text-sm">Loading...</p>}
        {budget.error && <p className="text-red-400 text-sm">{budget.error}</p>}
        {budget.data && (
          <BudgetBar
            percentUsed={budget.data.percentUsed}
            spentUsd={budget.data.spentUsd}
            monthlyBudgetUsd={budget.data.monthlyBudgetUsd}
          />
        )}
      </section>

      {/* Usage Chart */}
      <section className="bg-slate-800 rounded-xl p-6 border border-slate-700">
        <h3 className="text-lg font-semibold text-white mb-4">Token Usage (Last 7 Days)</h3>
        {usage.loading && <p className="text-slate-400 text-sm">Loading...</p>}
        {usage.error && <p className="text-red-400 text-sm">{usage.error}</p>}
        {usageDays.length > 0 && (
          <div className="flex items-end gap-2 h-40">
            {usageDays.map((day) => {
              const heightPercent = (day.totalTokens / maxTokens) * 100;
              return (
                <div
                  key={day.date}
                  className="flex-1 flex flex-col items-center gap-1"
                >
                  <span className="text-xs text-slate-400">
                    {day.totalTokens.toLocaleString()}
                  </span>
                  <div className="w-full flex-1 flex items-end">
                    <div
                      className="w-full bg-amber-500 rounded-t-md transition-all duration-300 min-h-[4px]"
                      style={{ height: `${heightPercent}%` }}
                    />
                  </div>
                  <span className="text-xs text-slate-500">
                    {formatDateShort(day.date)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
        {!usage.loading && usageDays.length === 0 && (
          <p className="text-slate-500 text-sm">No usage data available</p>
        )}
      </section>

      {/* System Health */}
      <section className="bg-slate-800 rounded-xl p-6 border border-slate-700">
        <h3 className="text-lg font-semibold text-white mb-4">System Health</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <HealthIndicator
            label="Database"
            status={health.data?.dbStatus ?? 'unknown'}
          />
          <HealthIndicator
            label="API Server"
            status={health.data?.status ?? 'unknown'}
          />
        </div>
      </section>
    </div>
  );
}

/** Small stat card component */
function StatCard({
  label,
  value,
  loading,
  error,
  valueColor = 'text-white',
}: {
  label: string;
  value: string;
  loading: boolean;
  error: string | null;
  valueColor?: string;
}) {
  return (
    <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
      <p className="text-xs text-slate-400 uppercase tracking-wide">{label}</p>
      {loading && <p className="text-lg font-semibold text-slate-500 mt-1">...</p>}
      {error && <p className="text-sm text-red-400 mt-1">Error</p>}
      {!loading && !error && (
        <p className={`text-lg font-semibold mt-1 ${valueColor}`}>{value}</p>
      )}
    </div>
  );
}

/** Green/red health indicator dot */
function HealthIndicator({ label, status }: { label: string; status: string }) {
  const isHealthy = status === 'ok' || status === 'healthy' || status === 'connected';
  return (
    <div className="flex items-center gap-3 p-3 bg-slate-700/50 rounded-lg">
      <div
        className={`w-3 h-3 rounded-full ${
          isHealthy ? 'bg-green-500' : 'bg-red-500'
        }`}
      />
      <div>
        <p className="text-sm text-white">{label}</p>
        <p className={`text-xs ${isHealthy ? 'text-green-400' : 'text-red-400'}`}>
          {status}
        </p>
      </div>
    </div>
  );
}

/** Format seconds to human-readable uptime */
function formatUptime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/** Format ISO date to short form (e.g., "Mon") */
function formatDateShort(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { weekday: 'short' });
}
