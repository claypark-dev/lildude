/**
 * Reset/re-onboarding banner shown when a config already exists.
 * Provides a two-step confirmation before clearing the existing config.
 */

import type { ResetBannerProps } from './types.ts';

/** Banner offering to clear existing config for a fresh onboarding run */
export function ResetBanner({
  confirmingReset,
  resetting,
  resetError,
  onStartReset,
  onConfirmReset,
  onCancelReset,
}: ResetBannerProps) {
  return (
    <section className="mb-8 bg-[#111] border border-amber-500/30 rounded-xl p-6">
      <h2 className="text-base font-semibold text-amber-400 mb-1">
        Existing configuration detected
      </h2>
      <p className="text-sm text-[#a0a0a0] mb-4">
        Want to start over? This will delete your current config.json
        and let you re-enter API keys and preferences from scratch.
      </p>
      {resetError && (
        <p className="text-red-400 text-sm mb-3">{resetError}</p>
      )}
      {!confirmingReset ? (
        <button
          type="button"
          onClick={onStartReset}
          className="px-4 py-2 bg-amber-500/10 border border-amber-500/30 text-amber-400
                     text-sm font-medium rounded-lg hover:bg-amber-500/20 transition-colors"
        >
          Start Fresh
        </button>
      ) : (
        <div className="flex items-center gap-3">
          <span className="text-sm text-[#a0a0a0]">Are you sure?</span>
          <button
            type="button"
            onClick={onConfirmReset}
            disabled={resetting}
            className="px-4 py-2 bg-red-500 hover:bg-red-600 disabled:bg-[#1a1a1a]
                       text-white text-sm font-medium rounded-lg transition-colors"
          >
            {resetting ? 'Clearing...' : 'Yes, clear config'}
          </button>
          <button
            type="button"
            onClick={onCancelReset}
            disabled={resetting}
            className="px-4 py-2 bg-[#1a1a1a] text-[#a0a0a0] text-sm font-medium rounded-lg
                       hover:bg-[#222] transition-colors"
          >
            Cancel
          </button>
        </div>
      )}
    </section>
  );
}
