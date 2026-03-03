import { useCallback, useState } from 'react';
import { useApi } from '../hooks/useApi.ts';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:18421';

interface ListedWave {
  name: string;
  version: string;
  source: 'bundled' | 'installed';
  status: 'enabled' | 'disabled';
}

interface RegistryEntry {
  name: string;
  description: string;
  author: string;
  source: string;
  triggers: string[];
  version: string;
}

async function fetchWaves(): Promise<{ waves: ListedWave[] }> {
  const res = await fetch(`${BASE_URL}/api/v1/hub/waves`);
  if (!res.ok) throw new Error('Failed to fetch waves');
  return res.json();
}

async function fetchRegistryEntries(query?: string): Promise<{ waves: RegistryEntry[]; total: number }> {
  const url = query
    ? `${BASE_URL}/api/v1/hub/registry?q=${encodeURIComponent(query)}`
    : `${BASE_URL}/api/v1/hub/registry`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch registry');
  return res.json();
}

/** Badge for wave source type */
function SourceBadge({ source }: { source: string }) {
  const colors: Record<string, string> = {
    bundled: 'bg-blue-500/10 text-blue-400',
    installed: 'bg-green-500/10 text-green-400',
  };
  return (
    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${colors[source] ?? 'bg-[#333] text-[#ccc]'}`}>
      {source}
    </span>
  );
}

/** Card for an installed wave */
function WaveCard({
  wave,
  onUninstall,
}: {
  wave: ListedWave;
  onUninstall: (name: string) => void;
}) {
  return (
    <div className="bg-[#111] rounded-xl p-5 border border-[#222] flex items-center justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="text-white font-semibold">{wave.name}</h3>
          <SourceBadge source={wave.source} />
          <span className="text-xs text-[#666]">v{wave.version}</span>
        </div>
      </div>
      {wave.source === 'installed' && (
        <button
          type="button"
          className="px-3 py-1.5 bg-red-600/20 hover:bg-red-600/40 text-red-400 text-xs rounded-lg transition-colors"
          onClick={() => onUninstall(wave.name)}
        >
          Uninstall
        </button>
      )}
    </div>
  );
}

/** Card for a registry entry (available to install) */
function RegistryCard({
  entry,
  onInstall,
  installing,
}: {
  entry: RegistryEntry;
  onInstall: (source: string) => void;
  installing: boolean;
}) {
  return (
    <div className="bg-[#111] rounded-xl p-5 border border-[#222]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-white font-semibold">{entry.name}</h3>
          <p className="text-[#a0a0a0] text-sm mt-1">{entry.description}</p>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {entry.triggers.slice(0, 5).map((trigger) => (
              <span
                key={trigger}
                className="px-2 py-0.5 bg-[#1a1a1a] text-[#888] text-xs rounded"
              >
                {trigger}
              </span>
            ))}
          </div>
          <p className="text-xs text-[#666] mt-2">
            by {entry.author} &middot; v{entry.version}
          </p>
        </div>
        <button
          type="button"
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
          onClick={() => onInstall(entry.source)}
          disabled={installing}
        >
          {installing ? 'Installing...' : 'Install'}
        </button>
      </div>
    </div>
  );
}

/** Wave Hub page — browse, install, manage waves */
export function WaveHub() {
  const waves = useApi(useCallback(() => fetchWaves(), []));
  const [searchQuery, setSearchQuery] = useState('');
  const [registryData, setRegistryData] = useState<{ waves: RegistryEntry[]; total: number } | null>(null);
  const [registryLoading, setRegistryLoading] = useState(false);
  const [installSource, setInstallSource] = useState('');
  const [installing, setInstalling] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [tab, setTab] = useState<'installed' | 'browse'>('installed');

  async function handleSearch() {
    setRegistryLoading(true);
    try {
      const data = await fetchRegistryEntries(searchQuery || undefined);
      setRegistryData(data);
    } catch {
      setActionMessage('Failed to search registry');
    } finally {
      setRegistryLoading(false);
    }
  }

  async function handleInstall(source: string) {
    setInstalling(true);
    setActionMessage(null);
    try {
      const res = await fetch(`${BASE_URL}/api/v1/hub/install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source }),
      });
      const data = await res.json();
      if (res.ok) {
        setActionMessage(`Installed "${data.name}" v${data.version}`);
        waves.refetch();
      } else {
        setActionMessage(data.error ?? 'Installation failed');
      }
    } catch {
      setActionMessage('Failed to install wave');
    } finally {
      setInstalling(false);
    }
  }

  async function handleUninstall(name: string) {
    setActionMessage(null);
    try {
      const res = await fetch(`${BASE_URL}/api/v1/hub/waves/${encodeURIComponent(name)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setActionMessage(`Uninstalled "${name}"`);
        waves.refetch();
      } else {
        const data = await res.json();
        setActionMessage(data.error ?? 'Uninstall failed');
      }
    } catch {
      setActionMessage('Failed to uninstall wave');
    }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-white">Wave Hub</h2>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-2">
        <button
          type="button"
          className={`px-4 py-2 text-sm rounded-lg transition-colors ${
            tab === 'installed'
              ? 'bg-blue-500/10 text-blue-400 font-medium'
              : 'bg-[#1a1a1a] text-[#ccc] hover:text-white'
          }`}
          onClick={() => setTab('installed')}
        >
          Installed
        </button>
        <button
          type="button"
          className={`px-4 py-2 text-sm rounded-lg transition-colors ${
            tab === 'browse'
              ? 'bg-blue-500/10 text-blue-400 font-medium'
              : 'bg-[#1a1a1a] text-[#ccc] hover:text-white'
          }`}
          onClick={() => {
            setTab('browse');
            if (!registryData) handleSearch();
          }}
        >
          Browse Registry
        </button>
      </div>

      {actionMessage && (
        <p className="text-sm text-blue-400 bg-blue-500/10 px-4 py-2 rounded-lg">
          {actionMessage}
        </p>
      )}

      {/* Installed waves tab */}
      {tab === 'installed' && (
        <section className="space-y-3">
          {/* Manual install input */}
          <div className="flex gap-2">
            <input
              type="text"
              className="flex-1 bg-[#0a0a0a] border border-[#333] rounded-lg px-4 py-2 text-white text-sm placeholder-[#666] focus:outline-none focus:border-blue-500"
              placeholder="github:user/repo"
              value={installSource}
              onChange={(e) => setInstallSource(e.target.value)}
            />
            <button
              type="button"
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
              onClick={() => handleInstall(installSource)}
              disabled={installing || !installSource}
            >
              {installing ? 'Installing...' : 'Install'}
            </button>
          </div>

          {waves.loading && <p className="text-[#a0a0a0] text-sm">Loading waves...</p>}
          {waves.error && <p className="text-red-400 text-sm">{waves.error}</p>}
          {waves.data?.waves.length === 0 && (
            <div className="bg-[#111] rounded-xl p-8 border border-[#222] text-center">
              <p className="text-[#a0a0a0]">No waves installed.</p>
              <p className="text-xs text-[#666] mt-2">
                Browse the registry or install from a GitHub source.
              </p>
            </div>
          )}
          {waves.data?.waves.map((wave) => (
            <WaveCard key={wave.name} wave={wave} onUninstall={handleUninstall} />
          ))}
        </section>
      )}

      {/* Browse registry tab */}
      {tab === 'browse' && (
        <section className="space-y-3">
          <div className="flex gap-2">
            <input
              type="text"
              className="flex-1 bg-[#0a0a0a] border border-[#333] rounded-lg px-4 py-2 text-white text-sm placeholder-[#666] focus:outline-none focus:border-blue-500"
              placeholder="Search waves..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
            />
            <button
              type="button"
              className="px-4 py-2 bg-[#1a1a1a] hover:bg-[#333] text-white text-sm rounded-lg transition-colors"
              onClick={handleSearch}
            >
              Search
            </button>
          </div>

          {registryLoading && <p className="text-[#a0a0a0] text-sm">Loading registry...</p>}

          {registryData && registryData.waves.length === 0 && (
            <div className="bg-[#111] rounded-xl p-8 border border-[#222] text-center">
              <p className="text-[#a0a0a0]">No waves found.</p>
            </div>
          )}

          {registryData?.waves.map((entry) => (
            <RegistryCard
              key={entry.name}
              entry={entry}
              onInstall={handleInstall}
              installing={installing}
            />
          ))}
        </section>
      )}
    </div>
  );
}
