interface BudgetBarProps {
  percentUsed: number;
  spentUsd: number;
  monthlyBudgetUsd: number;
}

/**
 * Visual budget progress bar.
 * Green when <80%, yellow 80-95%, red >95%.
 */
export function BudgetBar({ percentUsed, spentUsd, monthlyBudgetUsd }: BudgetBarProps) {
  const clampedPercent = Math.min(percentUsed, 100);

  let barColor = 'bg-green-500';
  let textColor = 'text-green-400';
  if (percentUsed >= 95) {
    barColor = 'bg-red-500';
    textColor = 'text-red-400';
  } else if (percentUsed >= 80) {
    barColor = 'bg-yellow-500';
    textColor = 'text-yellow-400';
  }

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center text-sm">
        <span className="text-slate-300">Budget</span>
        <span className={textColor}>
          ${spentUsd.toFixed(2)} / ${monthlyBudgetUsd.toFixed(2)}
        </span>
      </div>
      <div className="w-full bg-slate-700 rounded-full h-3 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${barColor}`}
          style={{ width: `${clampedPercent}%` }}
        />
      </div>
      <p className={`text-xs ${textColor}`}>
        {percentUsed.toFixed(1)}% used
      </p>
    </div>
  );
}
