/**
 * Reusable WaveCard component for the Waves Hub.
 * Displays wave name, description, author, ratings, install count, and badges.
 */

import type { WaveCard as WaveCardData } from './wave-hub-api.ts';

/** Star rating display (1-5 scale). */
function StarRating({ rating, count }: { rating: number; count: number }) {
  const fullStars = Math.floor(rating);
  const hasHalf = rating - fullStars >= 0.3;

  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <span className="text-amber-400">
        {'★'.repeat(fullStars)}
        {hasHalf ? '½' : ''}
        {'☆'.repeat(5 - fullStars - (hasHalf ? 1 : 0))}
      </span>
      <span className="text-[#888]">({count})</span>
    </span>
  );
}

/** Safety tier badge color mapping. */
const TIER_COLORS: Record<string, string> = {
  observe: 'bg-green-500/10 text-green-400 border-green-500/20',
  create: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  modify: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  destroy: 'bg-red-500/10 text-red-400 border-red-500/20',
  execute: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
};

/** Props for the WaveCard component. */
interface WaveCardProps {
  wave: WaveCardData;
  onInstall?: (source: string) => void;
  onUninstall?: (name: string) => void;
  onClick?: (name: string) => void;
  installing?: boolean;
  compact?: boolean;
}

/** Display-ready wave card for the Waves Hub. */
export function WaveCard({
  wave,
  onInstall,
  onUninstall,
  onClick,
  installing,
  compact = false,
}: WaveCardProps) {
  const tierColor = TIER_COLORS[wave.safetyTier] ?? 'bg-[#333] text-[#ccc] border-[#444]';

  return (
    <div
      className={`bg-[#111] rounded-xl border border-[#222] hover:border-[#333] transition-colors ${
        onClick ? 'cursor-pointer' : ''
      } ${compact ? 'p-3' : 'p-5'}`}
      onClick={() => onClick?.(wave.name)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onClick?.(wave.name);
      }}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      {/* Header row: name + badges */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className={`text-white font-semibold ${compact ? 'text-sm' : ''}`}>
              {wave.displayName}
            </h3>
            {wave.verified && (
              <span className="text-blue-400 text-xs" title="Verified">✓</span>
            )}
            {wave.isPartyWave && (
              <span className="px-1.5 py-0.5 bg-cyan-500/10 text-cyan-400 text-[10px] rounded border border-cyan-500/20">
                Party
              </span>
            )}
            {wave.featured && (
              <span className="px-1.5 py-0.5 bg-amber-500/10 text-amber-400 text-[10px] rounded border border-amber-500/20">
                Featured
              </span>
            )}
          </div>

          {!compact && wave.description && (
            <p className="text-[#a0a0a0] text-sm mt-1 line-clamp-2">
              {wave.description}
            </p>
          )}

          {/* Metadata row */}
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            <span className="text-xs text-[#666]">
              by {wave.author}
            </span>
            {wave.averageRating > 0 && (
              <StarRating rating={wave.averageRating} count={wave.ratingCount} />
            )}
            {wave.installCount > 0 && (
              <span className="text-xs text-[#888]">
                ↓{wave.installCount.toLocaleString()}
              </span>
            )}
          </div>

          {/* Badges row */}
          {!compact && (
            <div className="flex items-center gap-1.5 mt-2 flex-wrap">
              <span className={`px-2 py-0.5 rounded text-[10px] font-medium border ${tierColor}`}>
                {wave.safetyTier}
              </span>
              {wave.deterministic && (
                <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-[#1a1a1a] text-[#888] border border-[#333]">
                  deterministic
                </span>
              )}
              {wave.category !== 'uncategorized' && (
                <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-[#1a1a1a] text-[#888] border border-[#333]">
                  {wave.category}
                </span>
              )}
              <span className="text-[10px] text-[#555]">v{wave.version}</span>
            </div>
          )}

          {/* Tags */}
          {!compact && wave.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {wave.tags.slice(0, 5).map((tag) => (
                <span
                  key={tag}
                  className="px-1.5 py-0.5 bg-[#1a1a1a] text-[#777] text-[10px] rounded"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex flex-col items-end gap-2 flex-shrink-0">
          {wave.installed && wave.source !== 'bundled' && onUninstall && (
            <button
              type="button"
              className="px-3 py-1.5 bg-red-600/20 hover:bg-red-600/40 text-red-400 text-xs rounded-lg transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                onUninstall(wave.name);
              }}
            >
              Uninstall
            </button>
          )}
          {!wave.installed && onInstall && (
            <button
              type="button"
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
              onClick={(e) => {
                e.stopPropagation();
                onInstall(wave.source);
              }}
              disabled={installing}
            >
              {installing ? 'Installing…' : 'Install'}
            </button>
          )}
          {wave.installed && (
            <span className="px-2 py-0.5 bg-green-500/10 text-green-400 text-[10px] rounded border border-green-500/20">
              Installed
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
