import { useCallback } from 'react';
import { useApi } from '../hooks/useApi.ts';
import { BudgetBar } from '../components/BudgetBar.tsx';
import { fetchHealth, fetchBudget, fetchTasks, fetchUsage } from '../lib/api.ts';

/** Dashboard page showing system overview, budget, usage, and active tasks */
export function Dashboard() {
  const health = useApi(useCallback(() => fetchHealth(), []));
  const budget = useApi(useCallback(() => fetchBudget(), []));
  const tasks = useApi(useCallback(() => fetchTasks(10), []));
  const usage = useApi(useCallback(() => fetchUsage(), []));

  const activeTasks = tasks.data?.tasks.filter(
    (t) => t.status === 'running' || t.status === 'pending'
  ) ?? [];

  const percentUsed = budget.data
    ? (budget.data.monthlySpentUsd / budget.data.monthlyLimitUsd) * 100
    : 0;

  return (
    <div className="space-y-8 max-w-5xl">
      <h2 className="text-2xl font-bold text-white">Dashboard</h2>

      {/* Health & Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Status"
          value={health.data ? 'ok' : '--'}
          loading={health.loading}
          error={health.error}
          valueColor={health.data ? 'text-green-400' : 'text-red-400'}
        />
        <StatCard
          label="Uptime"
          value={health.data ? formatUptime(health.data.uptime) : '--'}
          loading={health.loading}
          error={health.error}
        />
        <StatCard
          label="Memory"
          value={health.data ? `${health.data.memoryUsageMb.toFixed(1)} MB` : '--'}
          loading={health.loading}
          error={health.error}
        />
        <StatCard
          label="Active Tasks"
          value={tasks.loading ? '--' : String(activeTasks.length)}
          loading={tasks.loading}
          error={tasks.error}
          valueColor="text-blue-400"
        />
      </div>

      {/* Budget */}
      <section className="bg-[#111] rounded-xl p-6 border border-[#222]">
        <h3 className="text-lg font-semibold text-white mb-4">Monthly Budget</h3>
        {budget.loading && <p className="text-[#a0a0a0] text-sm">Loading...</p>}
        {budget.error && <p className="text-red-400 text-sm">{budget.error}</p>}
        {budget.data && (
          <BudgetBar
            percentUsed={percentUsed}
            spentUsd={budget.data.monthlySpentUsd}
            monthlyBudgetUsd={budget.data.monthlyLimitUsd}
          />
        )}
      </section>

      {/* Cost Overview */}
      <section className="bg-[#111] rounded-xl p-6 border border-[#222]">
        <h3 className="text-lg font-semibold text-white mb-4">Cost Overview</h3>
        {usage.loading && <p className="text-[#a0a0a0] text-sm">Loading...</p>}
        {usage.error && <p className="text-red-400 text-sm">{usage.error}</p>}
        {usage.data && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-[#1a1a1a]/50 rounded-lg p-4">
              <p className="text-xs text-[#a0a0a0] uppercase tracking-wide">Today</p>
              <p className="text-lg font-semibold text-white mt-1">
                ${usage.data.dailyCostUsd.toFixed(4)}
              </p>
              <p className="text-xs text-slate-500 mt-1">{usage.data.date}</p>
            </div>
            <div className="bg-[#1a1a1a]/50 rounded-lg p-4">
              <p className="text-xs text-[#a0a0a0] uppercase tracking-wide">This Month</p>
              <p className="text-lg font-semibold text-white mt-1">
                ${usage.data.monthlyCostUsd.toFixed(4)}
              </p>
              <p className="text-xs text-slate-500 mt-1">{usage.data.month}</p>
            </div>
          </div>
        )}
      </section>

      {/* System Health */}
      <section className="bg-[#111] rounded-xl p-6 border border-[#222]">
        <h3 className="text-lg font-semibold text-white mb-4">System Health</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <HealthIndicator
            label="Database"
            status={health.data?.dbSizeBytes != null ? 'ok' : 'unknown'}
          />
          <HealthIndicator
            label="API Server"
            status={health.data ? 'ok' : 'unknown'}
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
    <div className="bg-[#111] rounded-xl p-4 border border-[#222]">
      <p className="text-xs text-[#a0a0a0] uppercase tracking-wide">{label}</p>
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
    <div className="flex items-center gap-3 p-3 bg-[#1a1a1a]/50 rounded-lg">
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
