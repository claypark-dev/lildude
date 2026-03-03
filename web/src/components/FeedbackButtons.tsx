import { useState } from 'react';

interface FeedbackButtonsProps {
  /** Task ID to associate feedback with. */
  taskId?: string;
  /** Callback when feedback is submitted. */
  onFeedback?: (rating: -1 | 1) => void;
}

/**
 * Thumbs up/down feedback buttons for assistant messages.
 * Calls the /api/v1/feedback endpoint when clicked.
 */
export function FeedbackButtons({ taskId, onFeedback }: FeedbackButtonsProps) {
  const [submitted, setSubmitted] = useState<-1 | 1 | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleFeedback(rating: -1 | 1) {
    if (submitted !== null || loading) return;

    setLoading(true);
    try {
      if (taskId) {
        const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:18421';
        await fetch(`${BASE_URL}/api/v1/feedback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId, rating }),
        });
      }
      setSubmitted(rating);
      onFeedback?.(rating);
    } catch {
      // Silent failure — feedback is non-critical
    } finally {
      setLoading(false);
    }
  }

  if (submitted !== null) {
    return (
      <span className="text-xs text-[#666]">
        {submitted === 1 ? '\u{1F44D}' : '\u{1F44E}'}
      </span>
    );
  }

  return (
    <span className="inline-flex gap-1">
      <button
        type="button"
        className="text-xs text-[#666] hover:text-green-400 transition-colors disabled:opacity-50"
        onClick={() => handleFeedback(1)}
        disabled={loading}
        aria-label="Thumbs up"
        title="Good response"
      >
        {'\u{1F44D}'}
      </button>
      <button
        type="button"
        className="text-xs text-[#666] hover:text-red-400 transition-colors disabled:opacity-50"
        onClick={() => handleFeedback(-1)}
        disabled={loading}
        aria-label="Thumbs down"
        title="Bad response"
      >
        {'\u{1F44E}'}
      </button>
    </span>
  );
}
