/**
 * Wave detail modal/drawer for the Waves Hub.
 * Shows full wave info, reviews, and install/uninstall actions.
 */

import { useState, useEffect, useCallback } from 'react';
import type { WaveCard as WaveCardData, WaveReview } from './wave-hub-api.ts';
import { fetchWaveDetail, submitReview } from './wave-hub-api.ts';

/** Props for the WaveDetailModal component. */
interface WaveDetailModalProps {
  waveName: string | null;
  onClose: () => void;
  onInstall?: (source: string) => void;
  onUninstall?: (name: string) => void;
  installing?: boolean;
}

/** Star rating input for submitting reviews. */
function RatingInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          className={`text-lg transition-colors ${
            star <= value ? 'text-amber-400' : 'text-[#444] hover:text-amber-300'
          }`}
          onClick={() => onChange(star)}
        >
          ★
        </button>
      ))}
    </div>
  );
}

/** Safety tier description. */
const TIER_DESCRIPTIONS: Record<string, string> = {
  observe: 'Read-only — can observe data but not modify anything.',
  create: 'Can create new records but not modify existing ones.',
  modify: 'Can modify existing data and settings.',
  destroy: 'Can delete data — use with caution.',
  execute: 'Full system access — highest privilege level.',
};

/** Wave detail modal overlay. */
export function WaveDetailModal({
  waveName,
  onClose,
  onInstall,
  onUninstall,
  installing,
}: WaveDetailModalProps) {
  const [wave, setWave] = useState<WaveCardData | null>(null);
  const [reviews, setReviews] = useState<WaveReview[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Review form state
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);
  const [reviewMessage, setReviewMessage] = useState<string | null>(null);

  const loadDetail = useCallback(async () => {
    if (!waveName) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchWaveDetail(waveName);
      setWave(data.wave);
      setReviews(data.reviews);
    } catch (fetchError: unknown) {
      const message = fetchError instanceof Error ? fetchError.message : 'Failed to load wave detail';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [waveName]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  async function handleSubmitReview() {
    if (!waveName) return;
    setSubmittingReview(true);
    setReviewMessage(null);
    try {
      const newReview = await submitReview(waveName, reviewRating, reviewComment || undefined);
      setReviews((prev) => [newReview, ...prev]);
      setReviewComment('');
      setReviewRating(5);
      setReviewMessage('Review submitted!');
    } catch (submitError: unknown) {
      const message = submitError instanceof Error ? submitError.message : 'Failed to submit review';
      setReviewMessage(message);
    } finally {
      setSubmittingReview(false);
    }
  }

  if (!waveName) return null;

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-start justify-center pt-16 px-4"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={`Wave detail: ${waveName}`}
    >
      <div
        className="bg-[#0a0a0a] border border-[#222] rounded-2xl w-full max-w-2xl max-h-[80vh] overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={() => {}}
        role="document"
      >
        {/* Close button */}
        <div className="flex justify-end p-4 pb-0">
          <button
            type="button"
            className="text-[#888] hover:text-white text-lg transition-colors"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {loading && (
          <div className="p-8 text-center">
            <p className="text-[#a0a0a0]">Loading wave details…</p>
          </div>
        )}

        {error && (
          <div className="p-8 text-center">
            <p className="text-red-400">{error}</p>
          </div>
        )}

        {wave && (
          <div className="p-6 pt-2 space-y-6">
            {/* Header */}
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-xl font-bold text-white">{wave.displayName}</h2>
                {wave.verified && <span className="text-blue-400" title="Verified">✓</span>}
                {wave.isPartyWave && (
                  <span className="px-2 py-0.5 bg-cyan-500/10 text-cyan-400 text-xs rounded border border-cyan-500/20">
                    Party Wave
                  </span>
                )}
                {wave.featured && (
                  <span className="px-2 py-0.5 bg-amber-500/10 text-amber-400 text-xs rounded border border-amber-500/20">
                    Featured
                  </span>
                )}
              </div>
              <p className="text-[#a0a0a0] mt-1">{wave.description}</p>
              <p className="text-xs text-[#666] mt-2">
                by {wave.author} · v{wave.version}
              </p>
            </div>

            {/* Stats row */}
            <div className="flex items-center gap-6 flex-wrap">
              <div className="text-center">
                <p className="text-lg font-bold text-white">
                  {wave.averageRating > 0 ? wave.averageRating.toFixed(1) : '—'}
                </p>
                <p className="text-[10px] text-[#888]">
                  {wave.ratingCount > 0 ? `${wave.ratingCount} ratings` : 'No ratings'}
                </p>
              </div>
              <div className="text-center">
                <p className="text-lg font-bold text-white">
                  {wave.installCount.toLocaleString()}
                </p>
                <p className="text-[10px] text-[#888]">installs</p>
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-white capitalize">{wave.safetyTier}</p>
                <p className="text-[10px] text-[#888]">safety tier</p>
              </div>
            </div>

            {/* Safety tier explanation */}
            <div className="bg-[#111] rounded-lg p-3 border border-[#222]">
              <p className="text-xs text-[#a0a0a0]">
                <span className="font-medium text-white capitalize">{wave.safetyTier}</span>
                {' — '}
                {TIER_DESCRIPTIONS[wave.safetyTier] ?? 'Unknown safety tier.'}
              </p>
            </div>

            {/* Details grid */}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="bg-[#111] rounded-lg p-3 border border-[#222]">
                <p className="text-[#888] text-xs">Category</p>
                <p className="text-white capitalize">{wave.category}</p>
              </div>
              <div className="bg-[#111] rounded-lg p-3 border border-[#222]">
                <p className="text-[#888] text-xs">Execution</p>
                <p className="text-white">{wave.deterministic ? 'Deterministic' : 'AI-powered'}</p>
              </div>
              <div className="bg-[#111] rounded-lg p-3 border border-[#222]">
                <p className="text-[#888] text-xs">Source</p>
                <p className="text-white text-xs truncate">{wave.source}</p>
              </div>
              <div className="bg-[#111] rounded-lg p-3 border border-[#222]">
                <p className="text-[#888] text-xs">Type</p>
                <p className="text-white">{wave.isPartyWave ? 'Party Wave' : 'Personal Wave'}</p>
              </div>
            </div>

            {/* Tags */}
            {wave.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {wave.tags.map((tag) => (
                  <span
                    key={tag}
                    className="px-2 py-0.5 bg-[#1a1a1a] text-[#888] text-xs rounded border border-[#333]"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {/* Install / Uninstall */}
            <div className="flex gap-2">
              {!wave.installed && onInstall && (
                <button
                  type="button"
                  className="flex-1 px-4 py-3 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-lg transition-colors disabled:opacity-50"
                  onClick={() => onInstall(wave.source)}
                  disabled={installing}
                >
                  {installing ? 'Installing…' : 'Install Wave'}
                </button>
              )}
              {wave.installed && wave.source !== 'bundled' && onUninstall && (
                <button
                  type="button"
                  className="flex-1 px-4 py-3 bg-red-600/20 hover:bg-red-600/40 text-red-400 font-medium rounded-lg transition-colors"
                  onClick={() => onUninstall(wave.name)}
                >
                  Uninstall
                </button>
              )}
              {wave.installed && (
                <div className="flex items-center px-4 py-3 bg-green-500/10 text-green-400 text-sm rounded-lg border border-green-500/20">
                  ✓ Installed
                </div>
              )}
            </div>

            {/* Reviews section */}
            <div className="border-t border-[#222] pt-4">
              <h3 className="text-white font-semibold mb-3">Reviews</h3>

              {/* Review form */}
              <div className="bg-[#111] rounded-lg p-4 border border-[#222] mb-4 space-y-3">
                <div className="flex items-center gap-3">
                  <span className="text-sm text-[#a0a0a0]">Your rating:</span>
                  <RatingInput value={reviewRating} onChange={setReviewRating} />
                </div>
                <textarea
                  className="w-full bg-[#0a0a0a] border border-[#333] rounded-lg px-3 py-2 text-white text-sm placeholder-[#666] focus:outline-none focus:border-blue-500 resize-none"
                  rows={2}
                  placeholder="Write a review (optional)…"
                  value={reviewComment}
                  onChange={(e) => setReviewComment(e.target.value)}
                />
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                    onClick={handleSubmitReview}
                    disabled={submittingReview}
                  >
                    {submittingReview ? 'Submitting…' : 'Submit Review'}
                  </button>
                  {reviewMessage && (
                    <span className="text-xs text-blue-400">{reviewMessage}</span>
                  )}
                </div>
              </div>

              {/* Existing reviews */}
              {reviews.length === 0 && (
                <p className="text-sm text-[#666]">No reviews yet. Be the first!</p>
              )}
              {reviews.map((review) => (
                <div
                  key={review.id}
                  className="bg-[#111] rounded-lg p-3 border border-[#222] mb-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-amber-400 text-xs">
                      {'★'.repeat(review.rating)}
                      {'☆'.repeat(5 - review.rating)}
                    </span>
                    <span className="text-xs text-[#666]">by {review.reviewer}</span>
                  </div>
                  {review.comment && (
                    <p className="text-sm text-[#a0a0a0] mt-1">{review.comment}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
