/**
 * Author profile page.
 * Shows community author info and their published waves.
 */

import { useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useApi } from '../../hooks/useApi.ts';
import {
  fetchAuthorProfile,
  fetchBrowse,
  installWave,
  uninstallWave,
  type WaveCard as WaveCardData,
  type CommunityAuthor,
} from './wave-hub-api.ts';
import { WaveCard } from './WaveCard.tsx';
import { WaveDetailModal } from './WaveDetailModal.tsx';

/** Author profile page showing all waves by a community author. */
export function AuthorProfile() {
  const { username } = useParams<{ username: string }>();
  const navigate = useNavigate();

  const authorData = useApi(
    useCallback(() => {
      if (!username) return Promise.resolve({ author: null as CommunityAuthor | null });
      return fetchAuthorProfile(username) as Promise<{ author: CommunityAuthor | null }>;
    }, [username]),
  );

  const authorWaves = useApi(
    useCallback(() => {
      if (!username) return Promise.resolve({ waves: [] as WaveCardData[], total: 0 });
      return fetchBrowse({ q: username, limit: 50 });
    }, [username]),
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
      authorWaves.refetch();
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
      authorWaves.refetch();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Uninstall failed';
      setActionMessage({ text: message, isError: true });
    }
  }

  if (!username) {
    return <p className="text-[#888]">No author specified.</p>;
  }

  const author = authorData.data?.author;

  return (
    <div className="space-y-6">
      {/* Back link */}
      <button
        type="button"
        className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
        onClick={() => navigate('/hub')}
      >
        ← Back to Hub
      </button>

      {authorData.loading && (
        <p className="text-[#a0a0a0]">Loading author profile…</p>
      )}

      {authorData.error && (
        <p className="text-red-400">{authorData.error}</p>
      )}

      {/* Author header */}
      {author && (
        <div className="bg-[#111] rounded-2xl p-6 border border-[#222]">
          <div className="flex items-center gap-4">
            {author.avatarUrl && (
              <img
                src={author.avatarUrl}
                alt={author.displayName ?? author.githubUsername}
                className="w-16 h-16 rounded-full"
              />
            )}
            <div>
              <h2 className="text-xl font-bold text-white">
                {author.displayName ?? author.githubUsername}
              </h2>
              <p className="text-sm text-[#888]">@{author.githubUsername}</p>
              <p className="text-xs text-[#666] mt-1">
                Joined {new Date(author.joinedAt).toLocaleDateString()}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4 mt-6 text-center">
            <div className="bg-[#0a0a0a] rounded-xl p-4 border border-[#222]">
              <p className="text-2xl font-bold text-white">{author.publishedCount}</p>
              <p className="text-xs text-[#888] mt-1">Published</p>
            </div>
            <div className="bg-[#0a0a0a] rounded-xl p-4 border border-[#222]">
              <p className="text-2xl font-bold text-white">{author.totalInstalls.toLocaleString()}</p>
              <p className="text-xs text-[#888] mt-1">Total Installs</p>
            </div>
            <div className="bg-[#0a0a0a] rounded-xl p-4 border border-[#222]">
              <p className="text-2xl font-bold text-white">
                {author.averageRating > 0 ? author.averageRating.toFixed(1) : '—'}
              </p>
              <p className="text-xs text-[#888] mt-1">Avg Rating</p>
            </div>
          </div>
        </div>
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

      {/* Author's waves */}
      {author && (
        <section>
          <h3 className="text-lg font-semibold text-white mb-3">
            Published Skills
            <span className="text-xs text-[#888] font-normal ml-2">
              ({authorWaves.data?.total ?? 0})
            </span>
          </h3>

          {authorWaves.loading && (
            <p className="text-[#a0a0a0] text-sm">Loading waves…</p>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {(authorWaves.data?.waves ?? []).map((wave) => (
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

          {authorWaves.data?.waves.length === 0 && !authorWaves.loading && (
            <p className="text-[#888] text-sm">No published skills yet.</p>
          )}
        </section>
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
