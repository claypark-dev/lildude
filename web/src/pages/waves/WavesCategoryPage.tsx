/**
 * Category browse page for the Skills Hub.
 * Shows filterable/sortable grid of skills within a specific category.
 */

import { useState, useCallback, useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import {
  fetchBrowse,
  installWave,
  uninstallWave,
  type WaveCard as WaveCardData,
} from './wave-hub-api.ts';
import { WaveCard } from './WaveCard.tsx';
import { WaveDetailModal } from './WaveDetailModal.tsx';

/** Sort option labels. */
const SORT_OPTIONS = [
  { value: 'popular', label: 'Most Popular' },
  { value: 'rated', label: 'Top Rated' },
  { value: 'name', label: 'A–Z' },
  { value: 'recent', label: 'Recent' },
] as const;

/** Category browse page. */
export function WavesCategoryPage() {
  const { category } = useParams<{ category: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const currentSort = searchParams.get('sort') ?? 'popular';
  const currentQuery = searchParams.get('q') ?? '';
  const showPartyOnly = searchParams.get('party') === 'true';

  const [waves, setWaves] = useState<WaveCardData[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState(currentQuery);
  const [installing, setInstalling] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const [selectedWave, setSelectedWave] = useState<string | null>(null);

  const loadWaves = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchBrowse({
        category: category === 'all' ? undefined : category,
        q: currentQuery || undefined,
        sort: currentSort,
        party: showPartyOnly ? 'true' : undefined,
        limit: 50,
      });
      setWaves(data.waves);
      setTotal(data.total);
    } catch (fetchError: unknown) {
      const message = fetchError instanceof Error ? fetchError.message : 'Failed to load waves';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [category, currentQuery, currentSort, showPartyOnly]);

  useEffect(() => {
    loadWaves();
  }, [loadWaves]);

  function handleSearch() {
    const params = new URLSearchParams(searchParams);
    if (searchInput) {
      params.set('q', searchInput);
    } else {
      params.delete('q');
    }
    setSearchParams(params);
  }

  function handleSortChange(sort: string) {
    const params = new URLSearchParams(searchParams);
    params.set('sort', sort);
    setSearchParams(params);
  }

  function handleToggleParty() {
    const params = new URLSearchParams(searchParams);
    if (showPartyOnly) {
      params.delete('party');
    } else {
      params.set('party', 'true');
    }
    setSearchParams(params);
  }

  async function handleInstall(source: string) {
    setInstalling(true);
    setActionMessage(null);
    try {
      const result = await installWave(source);
      setActionMessage({ text: `Installed "${result.name}" v${result.version}`, isError: false });
      loadWaves();
    } catch (installError: unknown) {
      const message = installError instanceof Error ? installError.message : 'Installation failed';
      setActionMessage({ text: message, isError: true });
    } finally {
      setInstalling(false);
    }
  }

  async function handleUninstall(name: string) {
    setActionMessage(null);
    try {
      await uninstallWave(name);
      setActionMessage({ text: `Uninstalled "${name}"`, isError: false });
      loadWaves();
    } catch (uninstallError: unknown) {
      const message = uninstallError instanceof Error ? uninstallError.message : 'Uninstall failed';
      setActionMessage({ text: message, isError: true });
    }
  }

  const displayCategory = category
    ? category.charAt(0).toUpperCase() + category.slice(1)
    : 'All Waves';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-white">{displayCategory}</h2>
          <p className="text-xs text-[#888]">{total} skills</p>
        </div>
      </div>

      {/* Search + sort bar */}
      <div className="flex gap-2 flex-wrap">
        <div className="flex gap-2 flex-1 min-w-[200px]">
          <input
            type="text"
            className="flex-1 bg-[#0a0a0a] border border-[#333] rounded-lg px-4 py-2 text-white text-sm placeholder-[#666] focus:outline-none focus:border-blue-500"
            placeholder="Search in category…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSearch();
            }}
          />
          <button
            type="button"
            className="px-4 py-2 bg-[#1a1a1a] hover:bg-[#333] text-white text-sm rounded-lg transition-colors"
            onClick={handleSearch}
          >
            Search
          </button>
        </div>

        {/* Sort dropdown */}
        <select
          className="bg-[#0a0a0a] border border-[#333] rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
          value={currentSort}
          onChange={(e) => handleSortChange(e.target.value)}
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        {/* Party wave toggle */}
        <button
          type="button"
          className={`px-3 py-2 text-sm rounded-lg transition-colors ${
            showPartyOnly
              ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'
              : 'bg-[#1a1a1a] text-[#ccc] hover:text-white border border-transparent'
          }`}
          onClick={handleToggleParty}
        >
          🌊 Party Only
        </button>
      </div>

      {/* Status */}
      {actionMessage && (
        <p className={`text-sm px-4 py-2 rounded-lg ${
          actionMessage.isError
            ? 'text-red-400 bg-red-500/10 border border-red-500/20'
            : 'text-green-400 bg-green-500/10 border border-green-500/20'
        }`}>
          {actionMessage.text}
        </p>
      )}

      {loading && <p className="text-[#a0a0a0] text-sm">Loading skills…</p>}
      {error && <p className="text-red-400 text-sm">{error}</p>}

      {/* Wave grid */}
      {!loading && waves.length === 0 && (
        <div className="bg-[#111] rounded-xl p-8 border border-[#222] text-center">
          <p className="text-[#a0a0a0]">No skills found in this category.</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {waves.map((wave) => (
          <WaveCard
            key={wave.name}
            wave={wave}
            onInstall={handleInstall}
            onUninstall={handleUninstall}
            onClick={setSelectedWave}
            installing={installing}
          />
        ))}
      </div>

      {/* Detail modal */}
      <WaveDetailModal
        waveName={selectedWave}
        onClose={() => setSelectedWave(null)}
        onInstall={handleInstall}
        onUninstall={handleUninstall}
        installing={installing}
      />
    </div>
  );
}
