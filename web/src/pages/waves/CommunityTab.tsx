/**
 * Community tab for Shorebreak.
 * Shows community authors, trust overview, and publish entry point.
 */

import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../../hooks/useApi.ts';
import {
  fetchBrowse,
  fetchPublishHistory,
} from './wave-hub-api.ts';
import { WaveCard } from './WaveCard.tsx';
import { WaveDetailModal } from './WaveDetailModal.tsx';
import { TrustBadge } from './TrustBadge.tsx';
import { installWave, uninstallWave } from './wave-hub-api.ts';

/** Community tab showing top community waves and publish entry point. */
export function CommunityTab() {
  const navigate = useNavigate();

  const trustedWaves = useApi(
    useCallback(() => fetchBrowse({ tags: 'trusted', sort: 'popular', limit: 6 }), []),
  );
  const newWaves = useApi(
    useCallback(() => fetchBrowse({ sort: 'recent', limit: 6 }), []),
  );
  const publishHistory = useApi(
    useCallback(() => fetchPublishHistory(5), []),
  );

  const [installing, setInstalling] = useState(false);
  const [selectedWave, setSelectedWave] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<{ text: string; isError: boolean } | null>(null);

  async function handleInstall(source: string) {
    setInstalling(true);
    setActionMessage(null);
    try {
      const result = await installWave(source);
      setActionMessage({ text: `Installed "${result.name}" v${result.version}`, isError: false });
      trustedWaves.refetch();
      newWaves.refetch();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Installation failed';
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
      trustedWaves.refetch();
      newWaves.refetch();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Uninstall failed';
      setActionMessage({ text: message, isError: true });
    }
  }

  return (
    <div className="space-y-8">
      {/* Publish CTA */}
      <div className="bg-gradient-to-r from-purple-600/10 to-pink-600/10 rounded-2xl p-6 border border-purple-500/10">
        <h2 className="text-lg font-bold text-white mb-1">Share Your Skills</h2>
        <p className="text-sm text-[#a0a0a0] mb-4">
          Publish your waves to the community registry and help others.
        </p>
        <button
          type="button"
          className="px-5 py-2.5 bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium rounded-lg transition-colors"
          onClick={() => navigate('/hub/publish')}
        >
          Publish a Wave
        </button>
      </div>

      {actionMessage && (
        <p className={`text-sm px-4 py-2 rounded-lg ${
          actionMessage.isError
            ? 'text-red-400 bg-red-500/10 border border-red-500/20'
            : 'text-green-400 bg-green-500/10 border border-green-500/20'
        }`}>
          {actionMessage.text}
        </p>
      )}

      {/* Trust tiers explanation */}
      <div className="bg-[#111] rounded-xl p-5 border border-[#222]">
        <h3 className="text-sm font-semibold text-white mb-3">Community Trust Tiers</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {(['trusted', 'community', 'new', 'unreviewed'] as const).map((tier) => (
            <div key={tier} className="text-center">
              <TrustBadge tier={tier} />
              <p className="text-[10px] text-[#666] mt-1">
                {tier === 'trusted' ? 'Score 80+' :
                 tier === 'community' ? 'Score 50-79' :
                 tier === 'new' ? 'Score 20-49' :
                 'Score 0-19'}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Trusted waves */}
      {trustedWaves.data && trustedWaves.data.waves.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <TrustBadge tier="trusted" />
            <h3 className="text-lg font-semibold text-white">Trusted Waves</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {trustedWaves.data.waves.map((wave) => (
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

      {/* New waves */}
      {newWaves.data && newWaves.data.waves.length > 0 && (
        <section>
          <h3 className="text-lg font-semibold text-white mb-3">Recently Added</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {newWaves.data.waves.map((wave) => (
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

      {/* Recent publish history */}
      {publishHistory.data && publishHistory.data.submissions.length > 0 && (
        <section>
          <h3 className="text-lg font-semibold text-white mb-3">Recent Submissions</h3>
          <div className="space-y-2">
            {publishHistory.data.submissions.map((entry) => (
              <div
                key={entry.id}
                className="bg-[#111] rounded-lg p-3 border border-[#222] flex items-center justify-between"
              >
                <div>
                  <p className="text-sm text-white font-medium">{entry.waveName}</p>
                  <p className="text-xs text-[#888]">
                    v{entry.version} · {new Date(entry.publishedAt).toLocaleDateString()}
                  </p>
                </div>
                <span className={`px-2 py-0.5 rounded text-[10px] font-medium border ${
                  entry.status === 'merged' ? 'bg-green-500/10 text-green-400 border-green-500/20' :
                  entry.status === 'pending' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
                  'bg-[#222] text-[#888] border-[#333]'
                }`}>
                  {entry.status}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {(trustedWaves.loading || newWaves.loading) && (
        <p className="text-[#a0a0a0] text-sm text-center">Loading community waves…</p>
      )}

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
