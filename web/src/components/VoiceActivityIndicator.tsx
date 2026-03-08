/**
 * Voice activity indicator.
 * Shows a pulsing icon during audio playback.
 */

interface VoiceActivityIndicatorProps {
  /** Whether audio is currently playing. */
  active: boolean;
}

/** Pulsing speaker icon shown during voice playback. */
export function VoiceActivityIndicator({ active }: VoiceActivityIndicatorProps) {
  if (!active) return null;

  return (
    <span
      className="inline-flex items-center gap-1 text-blue-400 animate-pulse"
      aria-label="Speaking"
    >
      <svg
        viewBox="0 0 24 24"
        fill="currentColor"
        className="w-4 h-4"
        aria-hidden="true"
      >
        <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0014 8.5v7a4.49 4.49 0 002.5-3.5zM14 3.23v2.06a6.51 6.51 0 010 13.42v2.06A8.51 8.51 0 0014 3.23z" />
      </svg>
    </span>
  );
}
