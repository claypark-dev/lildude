/**
 * Installed Waves page for the Waves Hub.
 * Shows all locally installed waves with management actions.
 */

import { useState, useCallback } from 'react';
import { useApi } from '../../hooks/useApi.ts';
import {
  fetchInstalledWaves,
  fetchBrowse,
  installWave,
  uninstallWave,
  type WaveCard as WaveCardData,
} from './wave-hub-api.ts';
import { WaveCard } from './WaveCard.tsx';
import { WaveDetailModal } from './WaveDetailModal.tsx';

/** Installed waves management page. */
export function InstalledWaves() {
  const installedData = useApi(useCallback(() => fetchInstalledWaves(), []));
  const browseData = useApi(
    useCallback(() => fetchBrowse({ limit: 100 }), []),
  );

  const [installSource, setInstallSource] = useState('');
  const [installing, setInstalling] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const [selectedWave, setSelectedWave] = useState<string | null>(null);

  // Build a lookup for installed wave names to merge with browse cards
  const installedNames = new Set(
    installedData.data?.waves.map((w) => w.name) ?? [],
  );

  // Get cards for installed waves from browse data (which has full WaveCard shape)
  const installedCards: WaveCardData[] = (browseData.data?.waves ?? []).filter(
    (w) => installedNames.has(w.name) || w.installed,
  );

  // Also include local-only waves not in browse results
  const browseNames = new Set((browseData.data?.waves ?? []).map((w) => w.name));
  const localOnlyWaves = (installedData.data?.waves ?? []).filter(
    (w) => !browseNames.has(w.name),
  );

  async function handleInstall(source: string) {
    setInstalling(true);
    setActionMessage(null);
    try {
      const result = await installWave(source);
      setActionMessage({ text: `Installed "${result.name}" v${result.version}`, isError: false });
      setInstallSource('');
      installedData.refetch();
      browseData.refetch();
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
      installedData.refetch();
      browseData.refetch();
    } catch (uninstallError: unknown) {
      const message = uninstallError instanceof Error ? uninstallError.message : 'Uninstall failed';
      setActionMessage({ text: message, isError: true });
    }
  }

  const isLoading = installedData.loading || browseData.loading;
  const hasError = installedData.error || browseData.error;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-white">Installed Waves</h2>
        <span className="text-xs text-[#888]">
          {installedData.data?.waves.length ?? 0} waves
        </span>
      </div>

      {/* Manual install */}
      <div className="flex gap-2">
        <input
          type="text"
          className="flex-1 bg-[#0a0a0a] border border-[#333] rounded-lg px-4 py-2 text-white text-sm placeholder-[#666] focus:outline-none focus:border-blue-500"
          placeholder="Install from source (e.g. github:user/repo)"
          value={installSource}
          onChange={(e) => setInstallSource(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && installSource) handleInstall(installSource);
          }}
        />
        <button
          type="button"
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
          onClick={() => handleInstall(installSource)}
          disabled={installing || !installSource}
        >
          {installing ? 'Installing…' : 'Install'}
        </button>
      </div>

      {/* Status messages */}
      {actionMessage && (
        <p className={`text-sm px-4 py-2 rounded-lg ${
          actionMessage.isError
            ? 'text-red-400 bg-red-500/10 border border-red-500/20'
            : 'text-green-400 bg-green-500/10 border border-green-500/20'
        }`}>
          {actionMessage.text}
        </p>
      )}

      {isLoading && <p className="text-[#a0a0a0] text-sm">Loading installed waves…</p>}
      {hasError && <p className="text-red-400 text-sm">{installedData.error ?? browseData.error}</p>}

      {/* Installed wave cards */}
      {!isLoading && installedCards.length === 0 && localOnlyWaves.length === 0 && (
        <div className="bg-[#111] rounded-xl p-8 border border-[#222] text-center">
          <p className="text-[#a0a0a0]">No waves installed yet.</p>
          <p className="text-xs text-[#666] mt-2">
            Browse the hub to discover and install waves, or enter a GitHub source above.
          </p>
        </div>
      )}

      <div className="space-y-3">
        {installedCards.map((wave) => (
          <WaveCard
            key={wave.name}
            wave={wave}
            onUninstall={handleUninstall}
            onClick={setSelectedWave}
          />
        ))}

        {/* Local-only waves that aren't in browse results */}
        {localOnlyWaves.map((wave) => (
          <div
            key={wave.name}
            className="bg-[#111] rounded-xl p-5 border border-[#222] flex items-center justify-between gap-3"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="text-white font-semibold">{wave.name}</h3>
                <span
                  className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                    wave.source === 'bundled'
                      ? 'bg-blue-500/10 text-blue-400'
                      : 'bg-green-500/10 text-green-400'
                  }`}
                >
                  {wave.source}
                </span>
                <span className="text-xs text-[#666]">v{wave.version}</span>
              </div>
            </div>
            {wave.source === 'installed' && (
              <button
                type="button"
                className="px-3 py-1.5 bg-red-600/20 hover:bg-red-600/40 text-red-400 text-xs rounded-lg transition-colors"
                onClick={() => handleUninstall(wave.name)}
              >
                Uninstall
              </button>
            )}
          </div>
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
