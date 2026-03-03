/**
 * Basics form section of the onboarding wizard.
 * Collects user name, security level, and monthly budget.
 */

import type { BasicsFormProps } from './types.ts';

/** User preferences form: name, security level, and budget */
export function BasicsForm({
  userName,
  securityLevel,
  monthlyBudget,
  onUserNameChange,
  onSecurityLevelChange,
  onMonthlyBudgetChange,
}: BasicsFormProps) {
  return (
    <section className="mb-8 bg-[#111] border border-[#222] rounded-xl p-6">
      <h2 className="text-xl font-semibold text-white mb-4">Basics</h2>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm text-[#a0a0a0] mb-1">Your name</label>
          <input
            type="text"
            value={userName}
            onChange={(e) => onUserNameChange(e.target.value)}
            className="w-full bg-[#0a0a0a] border border-[#333] rounded-lg px-3 py-2 text-white text-sm
                       focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm text-[#a0a0a0] mb-1">Security (1-5)</label>
          <select
            value={securityLevel}
            onChange={(e) => onSecurityLevelChange(Number(e.target.value))}
            className="w-full bg-[#0a0a0a] border border-[#333] rounded-lg px-3 py-2 text-white text-sm
                       focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                Level {n}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm text-[#a0a0a0] mb-1">
            Monthly budget ($)
          </label>
          <input
            type="number"
            min={0}
            step={1}
            value={monthlyBudget}
            onChange={(e) => onMonthlyBudgetChange(Number(e.target.value))}
            className="w-full bg-[#0a0a0a] border border-[#333] rounded-lg px-3 py-2 text-white text-sm
                       focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>
    </section>
  );
}
