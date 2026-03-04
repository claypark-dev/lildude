/**
 * Skills Hub home page.
 * Hero area, featured skills, category overview, and quick stats.
 */

import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../../hooks/useApi.ts';
import {
  fetchFeatured,
  fetchBrowse,
  fetchCategories,
  fetchHubStats,
  fetchUpdates,
  installWave,
  uninstallWave,
  updateWave,
  type WaveCard as WaveCardData,
  type WaveUpdateInfo,
} from './wave-hub-api.ts';
import { WaveCard } from './WaveCard.tsx';
import { CategoryNav } from './CategoryNav.tsx';
import { WaveDetailModal } from './WaveDetailModal.tsx';

/** Waves Hub landing page with featured, categories, and stats. */
export function WavesHubHome() {
  const navigate = useNavigate();

  const featured = useApi(useCallback(() => fetchFeatured(), []));
  const categories = useApi(useCallback(() => fetchCategories(), []));
  const allWaves = useApi(useCallback(() => fetchBrowse({ sort: 'popular', limit: 12 }), []));
  const stats = useApi(useCallback(() => fetchHubStats(), []));
  const updates = useApi(useCallback(() => fetchUpdates(), []));

  const [installing, setInstalling] = useState(false);
  const [updating, setUpdating] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const [selectedWave, setSelectedWave] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  async function handleInstall(source: string) {
    setInstalling(true);
    setActionMessage(null);
    try {
      const result = await installWave(source);
      setActionMessage({ text: `Installed "${result.name}" v${result.version}`, isError: false });
      allWaves.refetch();
      featured.refetch();
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
      allWaves.refetch();
      featured.refetch();
    } catch (uninstallError: unknown) {
      const message = uninstallError instanceof Error ? uninstallError.message : 'Uninstall failed';
      setActionMessage({ text: message, isError: true });
    }
  }

  async function handleUpdate(update: WaveUpdateInfo) {
    setUpdating(update.name);
    setActionMessage(null);
    try {
      const result = await updateWave(update.name, update.source);
      setActionMessage({ text: `Updated "${result.name}" to v${result.version}`, isError: false });
      updates.refetch();
      allWaves.refetch();
    } catch (updateError: unknown) {
      const message = updateError instanceof Error ? updateError.message : 'Update failed';
      setActionMessage({ text: message, isError: true });
    } finally {
      setUpdating(null);
    }
  }

  function handleSearch() {
    if (searchQuery.trim()) {
      navigate(`/hub/category/all?q=${encodeURIComponent(searchQuery.trim())}`);
    }
  }

  function handleCategorySelect(category: string | null) {
    if (category) {
      navigate(`/hub/category/${category}`);
    }
  }

  // Group waves by category for the overview sections
  const wavesByCategory = new Map<string, WaveCardData[]>();
  for (const wave of allWaves.data?.waves ?? []) {
    const cat = wave.category || 'uncategorized';
    const existing = wavesByCategory.get(cat) ?? [];
    existing.push(wave);
    wavesByCategory.set(cat, existing);
  }

  return (
    <div className="space-y-8">
      {/* Hero / search area */}
      <div className="bg-gradient-to-r from-blue-600/10 to-cyan-600/10 rounded-2xl p-8 border border-blue-500/10">
        <h2 className="text-2xl font-bold text-white mb-2">Skills Hub</h2>
        <p className="text-[#a0a0a0] mb-4">
          Discover, install, and manage skills to extend your assistant.
        </p>
        <div className="flex gap-2 max-w-lg">
          <input
            type="text"
            className="flex-1 bg-[#0a0a0a] border border-[#333] rounded-lg px-4 py-2.5 text-white text-sm placeholder-[#666] focus:outline-none focus:border-blue-500"
            placeholder="Search skills…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSearch();
            }}
          />
          <button
            type="button"
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
            onClick={handleSearch}
          >
            Search
          </button>
        </div>
      </div>

      {/* Quick stats */}
      {stats.data && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatCard label="Available Skills" value={stats.data.stats.registryCount} />
          <StatCard label="Installed" value={stats.data.stats.installedCount} />
          <StatCard label="Total Runs" value={stats.data.stats.totalExecutions} />
          <StatCard label="Categories" value={stats.data.stats.categoryCount} />
          <StatCard label="Featured" value={stats.data.stats.featuredCount} />
        </div>
      )}

      {/* Category navigation */}
      {categories.data && (
        <CategoryNav
          categories={categories.data.categories}
          activeCategory={null}
          onCategoryChange={handleCategorySelect}
        />
      )}

      {actionMessage && (
        <p className={`text-sm px-4 py-2 rounded-lg ${
          actionMessage.isError
            ? 'text-red-400 bg-red-500/10 border border-red-500/20'
            : 'text-green-400 bg-green-500/10 border border-green-500/20'
        }`}>
          {actionMessage.text}
        </p>
      )}

      {/* Updates available */}
      {updates.data && updates.data.updates.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-blue-400">🔄</span>
            <h3 className="text-lg font-semibold text-white">
              Updates Available
              <span className="ml-2 text-xs bg-blue-600 text-white px-2 py-0.5 rounded-full font-normal">
                {updates.data.updates.length}
              </span>
            </h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {updates.data.updates.map((update) => (
              <UpdateCard
                key={update.name}
                update={update}
                onUpdate={handleUpdate}
                updating={updating === update.name}
              />
            ))}
          </div>
        </section>
      )}

      {/* Featured section */}
      {featured.data && featured.data.featured.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-amber-400">⭐</span>
            <h3 className="text-lg font-semibold text-white">Featured</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {featured.data.featured.map((wave) => (
              <WaveCard
                key={wave.name}
                wave={wave}
                onInstall={handleInstall}
                onUninstall={handleUninstall}
                onClick={setSelectedWave}
                installing={installing}
                compact
              />
            ))}
          </div>
        </section>
      )}

      {/* Category sections */}
      {Array.from(wavesByCategory.entries())
        .filter(([cat]) => cat !== 'uncategorized')
        .map(([cat, waves]) => (
          <section key={cat}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold text-white capitalize">
                {cat}
                <span className="text-xs text-[#888] font-normal ml-2">
                  ({waves.length} skills)
                </span>
              </h3>
              <button
                type="button"
                className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                onClick={() => navigate(`/hub/category/${cat}`)}
              >
                View all →
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {waves.slice(0, 3).map((wave) => (
                <WaveCard
                  key={wave.name}
                  wave={wave}
                  onInstall={handleInstall}
                  onUninstall={handleUninstall}
                  onClick={setSelectedWave}
                  installing={installing}
                  compact
                />
              ))}
            </div>
          </section>
        ))}

      {/* Loading states */}
      {(allWaves.loading || featured.loading) && (
        <p className="text-[#a0a0a0] text-sm text-center">Loading skills…</p>
      )}

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

/** Small stat card component. */
function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-[#111] rounded-xl p-4 border border-[#222] text-center">
      <p className="text-2xl font-bold text-white">{value}</p>
      <p className="text-xs text-[#888] mt-1">{label}</p>
    </div>
  );
}

/** Update card for a wave with available update. */
function UpdateCard({
  update,
  onUpdate,
  updating,
}: {
  update: WaveUpdateInfo;
  onUpdate: (update: WaveUpdateInfo) => void;
  updating: boolean;
}) {
  return (
    <div className="bg-[#111] rounded-xl p-4 border border-blue-500/20 hover:border-blue-500/40 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-sm font-medium text-white truncate">{update.name}</h4>
          <p className="text-xs text-[#888] mt-1 line-clamp-2">{update.description}</p>
        </div>
      </div>
      <div className="flex items-center justify-between mt-3">
        <span className="text-xs text-[#666]">
          v{update.currentVersion} → v{update.latestVersion}
        </span>
        <button
          type="button"
          className="px-3 py-1 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={() => onUpdate(update)}
          disabled={updating}
        >
          {updating ? 'Updating…' : 'Update'}
        </button>
      </div>
    </div>
  );
}
