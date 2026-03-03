import { useEffect, useState } from 'react';

/** Party wave setting from API. */
interface PartyWaveSetting {
  waveName: string;
  enabled: boolean;
  perContactConfig: Record<string, unknown>;
  updatedAt: string;
}

/** Party wave stats from API. */
interface PartyWaveStats {
  taskDelegations: { pending: number; total: number };
  documentRequests: { pending: number; total: number };
  faqEntries: { total: number; enabled: number };
  recentActivity: { rsvps: number; tasks: number; documentRequests: number };
}

/** Descriptions for known party waves. */
const WAVE_DESCRIPTIONS: Record<string, { description: string; tier: string }> = {
  'auto-responder': { description: 'Automatic status and away messages', tier: 'observe' },
  'availability-check': { description: 'Let contacts check your availability', tier: 'observe' },
  'contact-share': { description: 'Share contact info with external users', tier: 'observe' },
  'message-relay': { description: 'Relay messages from contacts to you', tier: 'create' },
  'meeting-request': { description: 'External users propose meeting times', tier: 'create' },
  'task-delegation': { description: 'Contacts submit tasks for your review', tier: 'create' },
  'faq-responder': { description: 'Answer common questions from your FAQ', tier: 'observe' },
  'event-rsvp': { description: 'Contacts RSVP to your shared events', tier: 'create' },
  'document-request': { description: 'Contacts request documents from you', tier: 'create' },
};

/** Badge color based on safety tier. */
function tierBadge(tier: string) {
  const colors: Record<string, string> = {
    observe: 'bg-green-500/20 text-green-400',
    create: 'bg-blue-500/20 text-blue-400',
    modify: 'bg-yellow-500/20 text-yellow-400',
    destroy: 'bg-red-500/20 text-red-400',
  };
  return colors[tier] || 'bg-gray-500/20 text-gray-400';
}

/** Party Waves management page. */
export function PartyWaves() {
  const [waves, setWaves] = useState<PartyWaveSetting[]>([]);
  const [stats, setStats] = useState<PartyWaveStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      const apiKey = localStorage.getItem('lildude_api_key') || '';
      const headers: Record<string, string> = apiKey
        ? { Authorization: `Bearer ${apiKey}` }
        : {};

      const [wavesRes, statsRes] = await Promise.all([
        fetch('/api/v1/party-waves', { headers }),
        fetch('/api/v1/party-waves/stats', { headers }),
      ]);

      if (wavesRes.ok) {
        const data = (await wavesRes.json()) as { partyWaves: PartyWaveSetting[] };
        setWaves(data.partyWaves);
      }
      if (statsRes.ok) {
        const data = (await statsRes.json()) as { stats: PartyWaveStats };
        setStats(data.stats);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load party waves');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleToggle = async (waveName: string, currentEnabled: boolean) => {
    try {
      const apiKey = localStorage.getItem('lildude_api_key') || '';
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      };

      const response = await fetch(`/api/v1/party-waves/${waveName}/toggle`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ enabled: !currentEnabled }),
      });

      if (response.ok) {
        setWaves((prev) =>
          prev.map((w) =>
            w.waveName === waveName ? { ...w, enabled: !currentEnabled } : w,
          ),
        );
      }
    } catch {
      // Toggle failed silently
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-[#a0a0a0]">Loading party waves...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-red-400">Error: {error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Party Waves</h1>
        <p className="text-[#a0a0a0] mt-1">
          Manage what your contacts can do when they interact with your Lil Dude.
        </p>
      </div>

      {/* Stats Overview */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            label="Pending Tasks"
            value={stats.taskDelegations.pending}
            total={stats.taskDelegations.total}
          />
          <StatCard
            label="Doc Requests"
            value={stats.documentRequests.pending}
            total={stats.documentRequests.total}
          />
          <StatCard
            label="FAQ Entries"
            value={stats.faqEntries.enabled}
            total={stats.faqEntries.total}
          />
          <StatCard
            label="Recent RSVPs"
            value={stats.recentActivity.rsvps}
          />
        </div>
      )}

      {/* Wave Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {waves.map((wave) => {
          const info = WAVE_DESCRIPTIONS[wave.waveName];
          return (
            <div
              key={wave.waveName}
              className="bg-[#111] border border-[#222] rounded-xl p-5 space-y-3"
            >
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <h3 className="text-white font-semibold text-sm">
                    {wave.waveName}
                  </h3>
                  {info && (
                    <p className="text-[#a0a0a0] text-xs">
                      {info.description}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => handleToggle(wave.waveName, wave.enabled)}
                  className={`
                    relative inline-flex h-6 w-11 items-center rounded-full transition-colors
                    ${wave.enabled ? 'bg-blue-500' : 'bg-[#333]'}
                  `}
                  aria-label={`Toggle ${wave.waveName}`}
                >
                  <span
                    className={`
                      inline-block h-4 w-4 transform rounded-full bg-white transition-transform
                      ${wave.enabled ? 'translate-x-6' : 'translate-x-1'}
                    `}
                  />
                </button>
              </div>

              <div className="flex items-center gap-2">
                {info && (
                  <span
                    className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${tierBadge(info.tier)}`}
                  >
                    {info.tier}
                  </span>
                )}
                <span
                  className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                    wave.enabled
                      ? 'bg-green-500/20 text-green-400'
                      : 'bg-[#333] text-[#666]'
                  }`}
                >
                  {wave.enabled ? 'active' : 'disabled'}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {waves.length === 0 && (
        <div className="text-center py-12 text-[#666]">
          <p>No party waves configured yet.</p>
          <p className="text-xs mt-1">Party waves will appear here after migration.</p>
        </div>
      )}
    </div>
  );
}

/** Stat card component. */
function StatCard({
  label,
  value,
  total,
}: {
  label: string;
  value: number;
  total?: number;
}) {
  return (
    <div className="bg-[#111] border border-[#222] rounded-xl p-4">
      <p className="text-[#a0a0a0] text-xs">{label}</p>
      <p className="text-white text-xl font-bold mt-1">
        {value}
        {total !== undefined && (
          <span className="text-[#666] text-sm font-normal"> / {total}</span>
        )}
      </p>
    </div>
  );
}
