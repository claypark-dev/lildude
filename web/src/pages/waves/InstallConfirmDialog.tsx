/**
 * Trust-aware install confirmation dialog.
 * Shows different warning levels based on the wave's community trust tier.
 */

import { useState } from 'react';
import { TrustBadge, type TrustTier } from './TrustBadge.tsx';

/** Props for the InstallConfirmDialog component. */
interface InstallConfirmDialogProps {
  waveName: string;
  displayName: string;
  trustTier: TrustTier;
  trustScore?: number;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Install confirmation dialog with trust-tier-appropriate warnings. */
export function InstallConfirmDialog({
  waveName,
  displayName,
  trustTier,
  trustScore,
  onConfirm,
  onCancel,
}: InstallConfirmDialogProps) {
  const [confirmText, setConfirmText] = useState('');

  // Trusted waves don't need a dialog — install proceeds directly
  if (trustTier === 'trusted') {
    onConfirm();
    return null;
  }

  const needsTypedConfirmation = trustTier === 'unreviewed';
  const canConfirm = needsTypedConfirmation
    ? confirmText === waveName
    : true;

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center px-4"
      onClick={onCancel}
      onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}
      role="dialog"
      aria-modal="true"
      aria-label={`Install confirmation for ${displayName}`}
    >
      <div
        className="bg-[#0a0a0a] border border-[#222] rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={() => {}}
        role="document"
      >
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className={`text-2xl ${trustTier === 'unreviewed' ? 'text-red-400' : 'text-amber-400'}`}>
            {trustTier === 'unreviewed' ? '!' : '?'}
          </div>
          <div>
            <h3 className="text-white font-semibold">Install {displayName}?</h3>
            <div className="mt-1">
              <TrustBadge tier={trustTier} score={trustScore} showScore />
            </div>
          </div>
        </div>

        {/* Warning message by tier */}
        {trustTier === 'community' && (
          <p className="text-sm text-[#a0a0a0]">
            This wave is community-maintained. It has passed security scanning
            but has not been officially verified. Proceed with installation?
          </p>
        )}

        {trustTier === 'new' && (
          <div className="space-y-2">
            <p className="text-sm text-amber-300">
              This wave is new and has limited community review. Review the
              scan results before installing.
            </p>
            <p className="text-xs text-[#888]">
              New waves may have undiscovered issues. Consider waiting for more
              community feedback before installing.
            </p>
          </div>
        )}

        {trustTier === 'unreviewed' && (
          <div className="space-y-3">
            <p className="text-sm text-red-300 font-medium">
              This wave has not been reviewed by the community. Install at your
              own risk.
            </p>
            <p className="text-xs text-[#888]">
              Unreviewed waves may contain untested or potentially harmful code.
              Only install if you trust the author and have reviewed the source.
            </p>
            <div>
              <label className="text-xs text-[#a0a0a0] block mb-1" htmlFor="confirm-input">
                Type <span className="text-white font-mono">{waveName}</span> to confirm:
              </label>
              <input
                id="confirm-input"
                type="text"
                className="w-full bg-[#111] border border-[#333] rounded-lg px-3 py-2 text-white text-sm font-mono placeholder-[#666] focus:outline-none focus:border-red-500"
                placeholder={waveName}
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
              />
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-2">
          <button
            type="button"
            className="flex-1 px-4 py-2.5 bg-[#222] hover:bg-[#333] text-white text-sm font-medium rounded-lg transition-colors"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className={`flex-1 px-4 py-2.5 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-30 ${
              trustTier === 'unreviewed'
                ? 'bg-red-600 hover:bg-red-500'
                : 'bg-blue-600 hover:bg-blue-500'
            }`}
            onClick={onConfirm}
            disabled={!canConfirm}
          >
            Install
          </button>
        </div>
      </div>
    </div>
  );
}
