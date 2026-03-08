import { useCallback, useState, useEffect } from 'react';
import { useApi } from '../hooks/useApi.ts';
import { BudgetBar } from '../components/BudgetBar.tsx';
import { fetchDashboard, fetchBudget, fetchWeatherWidget, fetchRemindersWidget } from '../lib/api.ts';
import type { DashboardData, DashboardCronJob, HeartbeatStatus } from '../lib/types.ts';
import {
  DASHBOARD_TEMPLATES,
  getTemplate,
  getSavedTemplateId,
  saveTemplateId,
  type TemplateWidget,
} from '../lib/dashboard-templates.ts';
import { cronToHuman } from '../lib/cron-human.ts';

// ── Widget Card Wrapper ──────────────────────────────────────────

function WidgetCard({
  title,
  icon,
  children,
  className = '',
  span = 1,
}: {
  title: string;
  icon: string;
  children: React.ReactNode;
  className?: string;
  span?: number;
}) {
  const colSpan = span === 2 ? 'sm:col-span-2' : '';
  return (
    <div className={`bg-[#111] rounded-xl border border-[#222] overflow-hidden ${colSpan} ${className}`}>
      <div className="flex items-center gap-2 px-4 sm:px-5 py-2.5 sm:py-3 border-b border-[#222]">
        <span className="text-base">{icon}</span>
        <h3 className="text-sm font-semibold text-[#ccc] uppercase tracking-wide">{title}</h3>
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </div>
  );
}

// ── System Health Widget ─────────────────────────────────────────

function SystemHealthWidget({ data }: { data: DashboardData | null }) {
  if (!data) return <WidgetSkeleton />;
  const { health } = data;
  const isHealthy = health.status === 'ok';
  return (
    <div className="flex items-center gap-4">
      <div
        className={`w-12 h-12 rounded-full flex items-center justify-center text-2xl ${
          isHealthy ? 'bg-green-500/10' : 'bg-red-500/10'
        }`}
      >
        {isHealthy ? '\u2713' : '\u2717'}
      </div>
      <div className="flex-1">
        <p className={`text-lg font-bold ${isHealthy ? 'text-green-400' : 'text-red-400'}`}>
          {isHealthy ? 'Healthy' : 'Unhealthy'}
        </p>
        <p className="text-xs text-[#666]">
          {data.health.memoryMb} MB RAM &middot; {formatUptime(data.health.uptime)}
        </p>
      </div>
    </div>
  );
}

// ── Budget Widget ────────────────────────────────────────────────

function BudgetWidget() {
  const budget = useApi(useCallback(() => fetchBudget(), []));

  if (!budget.data) return <WidgetSkeleton />;

  const percentUsed = (budget.data.monthlySpentUsd / budget.data.monthlyLimitUsd) * 100;

  return (
    <div className="space-y-3">
      <BudgetBar
        percentUsed={percentUsed}
        spentUsd={budget.data.monthlySpentUsd}
        monthlyBudgetUsd={budget.data.monthlyLimitUsd}
      />
      <div className="flex justify-between text-xs text-[#666]">
        <span>Remaining: ${budget.data.monthlyRemainingUsd.toFixed(2)}</span>
        <span>Limit: ${budget.data.monthlyLimitUsd.toFixed(2)}</span>
      </div>
    </div>
  );
}

// ── Active Tasks Widget ──────────────────────────────────────────

function ActiveTasksWidget({ data }: { data: DashboardData | null }) {
  if (!data) return <WidgetSkeleton />;

  const { tasks } = data;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-2xl font-bold text-white">{tasks.active}</p>
          <p className="text-xs text-[#666]">active now</p>
        </div>
        <div className="text-right">
          <p className="text-lg font-semibold text-[#a0a0a0]">{tasks.recent24h}</p>
          <p className="text-xs text-[#666]">last 24h</p>
        </div>
      </div>
      {tasks.items.length > 0 && (
        <div className="space-y-1.5 pt-2 border-t border-[#222]">
          {tasks.items.slice(0, 3).map((task) => (
            <div key={task.id} className="flex items-center gap-2 text-xs">
              <StatusDot status={task.status} />
              <span className="text-[#ccc] truncate flex-1">{task.description}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Cost Today Widget ────────────────────────────────────────────

function CostWidget({ data }: { data: DashboardData | null }) {
  if (!data) return <WidgetSkeleton />;

  return (
    <div className="space-y-2">
      <div>
        <p className="text-xs text-[#a0a0a0] uppercase tracking-wide">Today</p>
        <p className="text-2xl font-bold text-white mt-1">
          ${data.budget.dailyCostUsd.toFixed(4)}
        </p>
      </div>
      <div className="pt-2 border-t border-[#222]">
        <p className="text-xs text-[#a0a0a0] uppercase tracking-wide">This Month</p>
        <p className="text-lg font-semibold text-[#a0a0a0] mt-1">
          ${data.budget.monthlyCostUsd.toFixed(4)}
        </p>
      </div>
    </div>
  );
}

// ── Cron Jobs Widget ─────────────────────────────────────────────

function CronJobsWidget({ data }: { data: DashboardData | null }) {
  if (!data) return <WidgetSkeleton />;

  const { cron } = data;

  if (cron.count === 0) {
    return (
      <p className="text-sm text-[#666] text-center py-4">
        No scheduled jobs
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {cron.jobs.slice(0, 6).map((job) => (
        <CronJobRow key={job.id} job={job} />
      ))}
      {cron.count > 6 && (
        <p className="text-xs text-[#666] text-center pt-1">
          +{cron.count - 6} more
        </p>
      )}
    </div>
  );
}

function CronJobRow({ job }: { job: DashboardCronJob }) {
  const nextRun = job.nextRunAt ? new Date(job.nextRunAt) : null;
  const countdown = nextRun ? formatCountdown(nextRun) : '--';
  const statusColor = job.lastRunStatus === 'success'
    ? 'text-green-400'
    : job.lastRunStatus === 'failed'
      ? 'text-red-400'
      : 'text-[#666]';

  return (
    <div className="flex items-center gap-3 bg-[#1a1a1a]/50 rounded-lg p-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-[#ccc] truncate">{job.taskDescription}</p>
        <p className="text-xs text-[#666]">{cronToHuman(job.schedule)}</p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-xs text-blue-400">{countdown}</p>
        <p className={`text-xs ${statusColor}`}>
          {job.lastRunStatus ?? 'pending'}
        </p>
      </div>
    </div>
  );
}

// ── Weather Widget ──────────────────────────────────────────────

function WeatherWidget() {
  const [location, setLocation] = useState('Seattle');
  const [submitted, setSubmitted] = useState('Seattle');
  const weather = useApi(useCallback(() => fetchWeatherWidget(submitted), [submitted]));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (location.trim()) setSubmitted(location.trim());
  };

  return (
    <div className="space-y-3">
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="City name..."
          className="flex-1 bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-1.5 text-xs text-white placeholder-[#666] focus:outline-none focus:border-blue-500 transition-colors"
        />
        <button
          type="submit"
          className="text-xs text-blue-400 hover:text-blue-300 px-2 py-1.5 transition-colors"
        >
          Go
        </button>
      </form>

      {weather.error && (
        <p className="text-xs text-red-400">{weather.error}</p>
      )}

      {weather.data && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-2xl font-bold text-white">
                {weather.data.weather.temperature.toFixed(0)}°F
              </p>
              <p className="text-xs text-[#666]">
                Feels like {weather.data.weather.feelsLike.toFixed(0)}°F
              </p>
            </div>
            <div className="text-3xl">
              {weatherIcon(weather.data.weather.weatherCode, weather.data.weather.isDay)}
            </div>
          </div>
          <div className="flex gap-4 text-xs text-[#a0a0a0] pt-2 border-t border-[#222]">
            <span>{weather.data.weather.humidity}% humidity</span>
            <span>{weather.data.weather.windSpeed.toFixed(0)} mph wind</span>
          </div>
          <p className="text-xs text-[#555]">
            {weather.data.location.name}, {weather.data.location.region ?? weather.data.location.country}
          </p>
        </div>
      )}

      {!weather.data && !weather.error && <WidgetSkeleton />}
    </div>
  );
}

/** Map WMO weather codes to emoji icons */
function weatherIcon(code: number, isDay: boolean): string {
  if (code === 0) return isDay ? '\u2600\uFE0F' : '\uD83C\uDF19';           // clear
  if (code <= 3) return isDay ? '\u26C5' : '\uD83C\uDF19';                   // partly cloudy
  if (code <= 49) return '\u2601\uFE0F';                                      // fog/cloudy
  if (code <= 59) return '\uD83C\uDF26\uFE0F';                               // drizzle
  if (code <= 69) return '\uD83C\uDF27\uFE0F';                               // rain
  if (code <= 79) return '\uD83C\uDF28\uFE0F';                               // snow
  if (code <= 84) return '\uD83C\uDF27\uFE0F';                               // rain showers
  if (code <= 86) return '\uD83C\uDF28\uFE0F';                               // snow showers
  if (code >= 95) return '\u26C8\uFE0F';                                      // thunderstorm
  return '\u2601\uFE0F';
}

// ── Reminders Widget ────────────────────────────────────────────

function RemindersWidget() {
  const reminders = useApi(useCallback(() => fetchRemindersWidget(), []));

  if (reminders.error) {
    return <p className="text-xs text-red-400">{reminders.error}</p>;
  }

  if (!reminders.data) return <WidgetSkeleton />;

  if (reminders.data.count === 0) {
    return (
      <p className="text-sm text-[#666] text-center py-4">
        No upcoming reminders
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {reminders.data.reminders.slice(0, 5).map((r) => (
        <div key={r.id} className="flex items-center gap-3 bg-[#1a1a1a]/50 rounded-lg p-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm text-[#ccc] truncate">{r.text}</p>
            <p className="text-xs text-[#666]">{cronToHuman(r.schedule)}</p>
          </div>
          <div className="text-right shrink-0">
            {r.nextRunAt && (
              <p className="text-xs text-blue-400">
                {formatCountdown(new Date(r.nextRunAt))}
              </p>
            )}
            {r.expiresAt && (
              <p className="text-xs text-[#555]">
                expires {formatCountdown(new Date(r.expiresAt))}
              </p>
            )}
          </div>
        </div>
      ))}
      {reminders.data.count > 5 && (
        <p className="text-xs text-[#666] text-center pt-1">
          +{reminders.data.count - 5} more
        </p>
      )}
    </div>
  );
}

// ── Heartbeat Widget ──────────────────────────────────────────────

function HeartbeatWidget({ data }: { data: DashboardData | null }) {
  if (!data) return <WidgetSkeleton />;

  const hb = data.heartbeat;
  if (!hb) {
    return (
      <p className="text-sm text-[#666] text-center py-4">
        Heartbeat data unavailable
      </p>
    );
  }

  const lastRun = hb.lastBeatAt ? new Date(hb.lastBeatAt) : null;
  const lastRunStr = lastRun
    ? lastRun.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : 'Never';

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div
          className={`w-10 h-10 rounded-full flex items-center justify-center text-xl ${
            hb.enabled ? 'bg-green-500/10' : 'bg-[#222]'
          }`}
        >
          {hb.enabled ? '\uD83D\uDC93' : '\uD83D\uDC94'}
        </div>
        <div className="flex-1">
          <p className={`text-sm font-semibold ${hb.enabled ? 'text-green-400' : 'text-[#666]'}`}>
            {hb.enabled ? 'Active' : 'Inactive'}
          </p>
          <p className="text-xs text-[#666]">
            Last beat: {lastRunStr}
          </p>
        </div>
      </div>
      <div className="flex justify-between text-xs text-[#a0a0a0] pt-2 border-t border-[#222]">
        <span>{hb.actionsToday} action{hb.actionsToday !== 1 ? 's' : ''} today</span>
        <span>${hb.costToday.toFixed(4)} spent</span>
      </div>
    </div>
  );
}

// ── Clock Widget ─────────────────────────────────────────────────

function ClockWidget() {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const timeStr = now.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const dateStr = now.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="text-center">
      <p className="text-3xl font-mono font-bold text-white tracking-wider">
        {timeStr}
      </p>
      <p className="text-sm text-[#666] mt-2">{dateStr}</p>
    </div>
  );
}

// ── Quick Chat Widget ────────────────────────────────────────────

function QuickChatWidget() {
  const [input, setInput] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    window.location.href = `/chat?message=${encodeURIComponent(input.trim())}`;
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Ask Lil Dude anything..."
        className="flex-1 bg-[#1a1a1a] border border-[#333] rounded-lg px-4 py-2.5 text-sm text-white placeholder-[#666] focus:outline-none focus:border-blue-500 transition-colors"
      />
      <button
        type="submit"
        className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors shrink-0"
      >
        Send
      </button>
    </form>
  );
}

// ── Helpers ──────────────────────────────────────────────────────

function WidgetSkeleton() {
  return (
    <div className="animate-pulse space-y-3">
      <div className="h-4 bg-[#222] rounded w-3/4" />
      <div className="h-4 bg-[#222] rounded w-1/2" />
      <div className="h-4 bg-[#222] rounded w-2/3" />
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const color = status === 'running'
    ? 'bg-blue-400'
    : status === 'completed'
      ? 'bg-green-400'
      : status === 'failed'
        ? 'bg-red-400'
        : 'bg-yellow-400';
  return <div className={`w-2 h-2 rounded-full ${color} shrink-0`} />;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatCountdown(target: Date): string {
  const diff = target.getTime() - Date.now();
  if (diff < 0) return 'overdue';
  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(minutes / 60);
  if (hours > 24) return `${Math.floor(hours / 24)}d`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m`;
  return '<1m';
}

// ── Widget Registry ──────────────────────────────────────────────

/** Renders the appropriate widget component for a given widget type. */
function WidgetRenderer({
  type,
  data,
}: {
  type: string;
  data: DashboardData | null;
}) {
  switch (type) {
    case 'health':
      return <SystemHealthWidget data={data} />;
    case 'budget':
      return <BudgetWidget />;
    case 'cost':
      return <CostWidget data={data} />;
    case 'tasks':
      return <ActiveTasksWidget data={data} />;
    case 'clock':
      return <ClockWidget />;
    case 'quickchat':
      return <QuickChatWidget />;
    case 'weather':
      return <WeatherWidget />;
    case 'reminders':
      return <RemindersWidget />;
    case 'cron':
      return <CronJobsWidget data={data} />;
    case 'heartbeat':
      return <HeartbeatWidget data={data} />;
    default:
      return <p className="text-xs text-[#666]">Unknown widget: {type}</p>;
  }
}

// ── Template Selector ───────────────────────────────────────────

function TemplateSelector({
  activeId,
  onSelect,
}: {
  activeId: string;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!open) return;
    const handleClick = () => setOpen(false);
    // Delay to avoid closing on the toggle click itself
    const timer = setTimeout(() => document.addEventListener('click', handleClick), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', handleClick);
    };
  }, [open]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-xs text-[#666] hover:text-blue-400 transition-colors px-3 py-2 rounded-lg hover:bg-[#1a1a1a]"
      >
        <span>{getTemplate(activeId).icon}</span>
        <span className="hidden sm:inline">{getTemplate(activeId).name}</span>
        <span className="text-[10px]">{open ? '\u25B2' : '\u25BC'}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-[#1a1a1a] border border-[#333] rounded-xl shadow-xl overflow-hidden min-w-[220px] max-w-[90vw]">
          {DASHBOARD_TEMPLATES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                onSelect(t.id);
                setOpen(false);
              }}
              className={`w-full text-left px-4 py-3 flex items-center gap-3 transition-colors ${
                t.id === activeId
                  ? 'bg-blue-500/10 text-blue-400'
                  : 'text-[#ccc] hover:bg-[#222]'
              }`}
            >
              <span className="text-base">{t.icon}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{t.name}</p>
                <p className="text-xs text-[#666] truncate">{t.description}</p>
              </div>
              {t.id === activeId && (
                <span className="text-blue-400 text-sm">{'\u2713'}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Surfwatch Page ─────────────────────────────────────────

/** Surfwatch — template-driven widget grid layout */
export function Surfwatch() {
  const dashboard = useApi(useCallback(() => fetchDashboard(), []));
  const data = dashboard.data;

  const [templateId, setTemplateId] = useState(getSavedTemplateId);
  const template = getTemplate(templateId);

  const handleTemplateChange = (id: string) => {
    setTemplateId(id);
    saveTemplateId(id);
  };

  return (
    <div className="max-w-6xl space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xl sm:text-2xl font-bold text-white">Surfwatch</h2>
        <div className="flex items-center gap-1 sm:gap-2">
          <TemplateSelector activeId={templateId} onSelect={handleTemplateChange} />
          <button
            type="button"
            onClick={dashboard.refetch}
            className="text-xs text-[#666] hover:text-blue-400 transition-colors px-3 py-2 rounded-lg hover:bg-[#1a1a1a]"
          >
            Refresh
          </button>
        </div>
      </div>

      {dashboard.error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4">
          <p className="text-sm text-red-400">{dashboard.error}</p>
        </div>
      )}

      {/* Widget Grid — driven by the active template */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        {template.widgets.map((w: TemplateWidget) => (
          <WidgetCard key={w.type} title={w.title} icon={w.icon} span={w.span}>
            <WidgetRenderer type={w.type} data={data} />
          </WidgetCard>
        ))}
      </div>
    </div>
  );
}
