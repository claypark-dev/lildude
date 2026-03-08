/**
 * Community trust badge component for wave cards.
 * Displays a color-coded badge with the trust tier and optional tooltip.
 */

/** Trust tier type matching backend community-trust.ts */
export type TrustTier = 'trusted' | 'community' | 'new' | 'unreviewed';

/** Props for the TrustBadge component. */
interface TrustBadgeProps {
  tier: TrustTier;
  score?: number;
  showScore?: boolean;
}

/** Visual config for each trust tier. */
const TIER_CONFIG: Record<TrustTier, {
  label: string;
  bg: string;
  text: string;
  border: string;
  tooltip: string;
}> = {
  trusted: {
    label: 'Trusted',
    bg: 'bg-green-500/10',
    text: 'text-green-400',
    border: 'border-green-500/20',
    tooltip: 'This wave has been thoroughly reviewed and is widely used.',
  },
  community: {
    label: 'Community',
    bg: 'bg-blue-500/10',
    text: 'text-blue-400',
    border: 'border-blue-500/20',
    tooltip: 'This wave is community-maintained and has passed security scanning.',
  },
  new: {
    label: 'New',
    bg: 'bg-amber-500/10',
    text: 'text-amber-400',
    border: 'border-amber-500/20',
    tooltip: 'This wave is new and has limited community review.',
  },
  unreviewed: {
    label: 'Unreviewed',
    bg: 'bg-red-500/10',
    text: 'text-red-400',
    border: 'border-red-500/20',
    tooltip: 'This wave has not been reviewed by the community.',
  },
};

/** Trust badge showing the community trust tier of a wave. */
export function TrustBadge({ tier, score, showScore }: TrustBadgeProps) {
  const config = TIER_CONFIG[tier];

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded border ${config.bg} ${config.text} ${config.border}`}
      title={config.tooltip}
    >
      {config.label}
      {showScore && score !== undefined && (
        <span className="opacity-70">({score})</span>
      )}
    </span>
  );
}
