import { useState, useCallback } from 'react';
import { useApi } from '../hooks/useApi.ts';
import { fetchRoutingHistory, submitQualityFeedback, updateConfig, fetchConfig } from '../lib/api.ts';
import type { RoutingHistoryEntry } from '../lib/types.ts';

/** Power user panel sections: routing history, model override, JSON config editor. */
export function PowerUserPanel() {
  return (
    <div className="space-y-8">
      <h3 className="text-xl font-bold text-blue-400">Power User Mode</h3>
      <RoutingHistoryViewer />
      <ModelOverride />
      <JsonConfigEditor />
    </div>
  );
}

/** Table showing recent model routing decisions with quality score feedback. */
function RoutingHistoryViewer() {
  const history = useApi(useCallback(() => fetchRoutingHistory(30), []));

  return (
    <section className="bg-[#111] rounded-xl p-6 border border-[#222] space-y-4">
      <h4 className="text-lg font-semibold text-white">Routing History</h4>

      {history.loading && <p className="text-[#a0a0a0]">Loading history...</p>}
      {history.error && <p className="text-red-400">{history.error}</p>}

      {history.data && history.data.entries.length === 0 && (
        <p className="text-slate-500 text-sm">No routing history yet.</p>
      )}

      {history.data && history.data.entries.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-[#a0a0a0] uppercase border-b border-[#333]">
              <tr>
                <th className="py-2 pr-3">Model</th>
                <th className="py-2 pr-3">Tier</th>
                <th className="py-2 pr-3">Type</th>
                <th className="py-2 pr-3">Cost</th>
                <th className="py-2 pr-3">Quality</th>
                <th className="py-2">Feedback</th>
              </tr>
            </thead>
            <tbody>
              {history.data.entries.map((entry) => (
                <RoutingHistoryRow
                  key={entry.id}
                  entry={entry}
                  onFeedback={history.refetch}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {history.data && (
        <button
          type="button"
          className="text-sm text-blue-400 hover:text-blue-300"
          onClick={history.refetch}
        >
          Refresh
        </button>
      )}
    </section>
  );
}

/** Single row in routing history table with thumbs up/down feedback buttons. */
function RoutingHistoryRow({
  entry,
  onFeedback,
}: {
  entry: RoutingHistoryEntry;
  onFeedback: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);

  async function handleFeedback(score: number) {
    setSubmitting(true);
    try {
      await submitQualityFeedback(entry.taskId, score);
      onFeedback();
    } catch {
      // Silently fail for feedback
    } finally {
      setSubmitting(false);
    }
  }

  const qualityDisplay = entry.qualityScore !== null
    ? `${(entry.qualityScore * 100).toFixed(0)}%`
    : '--';

  return (
    <tr className="border-b border-[#222]/50 text-[#ccc]">
      <td className="py-2 pr-3 font-mono text-xs">{entry.model}</td>
      <td className="py-2 pr-3">
        <span className={`px-2 py-0.5 rounded text-xs font-medium ${tierColor(entry.tier)}`}>
          {entry.tier}
        </span>
      </td>
      <td className="py-2 pr-3">{entry.taskType}</td>
      <td className="py-2 pr-3">${entry.costUsd.toFixed(4)}</td>
      <td className="py-2 pr-3">{qualityDisplay}</td>
      <td className="py-2">
        {entry.qualityScore === null ? (
          <div className="flex gap-1">
            <button
              type="button"
              disabled={submitting}
              className="text-green-400 hover:text-green-300 disabled:text-slate-600"
              onClick={() => handleFeedback(1.0)}
              aria-label="Thumbs up"
            >
              +
            </button>
            <button
              type="button"
              disabled={submitting}
              className="text-red-400 hover:text-red-300 disabled:text-slate-600"
              onClick={() => handleFeedback(0.0)}
              aria-label="Thumbs down"
            >
              -
            </button>
          </div>
        ) : (
          <span className="text-slate-500 text-xs">{entry.feedback ?? 'rated'}</span>
        )}
      </td>
    </tr>
  );
}

/** Dropdown to manually select a model for the next request. */
function ModelOverride() {
  const [selectedModel, setSelectedModel] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const models = [
    '', // auto
    'claude-haiku-4-5-20251001',
    'claude-sonnet-4-5-20250929',
    'claude-opus-4-6',
    'gpt-4o-mini',
    'gpt-4o',
    'gpt-4.1',
    'deepseek-chat',
  ];

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    try {
      await updateConfig({ modelOverride: selectedModel || null });
      setMessage(selectedModel ? `Override set: ${selectedModel}` : 'Override cleared (auto)');
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Failed to save';
      setMessage(errMsg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="bg-[#111] rounded-xl p-6 border border-[#222] space-y-4">
      <h4 className="text-lg font-semibold text-white">Model Override</h4>
      <p className="text-sm text-[#a0a0a0]">Force a specific model for the next request.</p>

      <div className="flex gap-3 items-center">
        <select
          className="bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-white text-sm
                     focus:outline-none focus:ring-2 focus:ring-blue-500/50"
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value)}
        >
          {models.map((modelName) => (
            <option key={modelName} value={modelName}>
              {modelName || '(Auto - use router)'}
            </option>
          ))}
        </select>

        <button
          type="button"
          className="px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-[#1a1a1a]
                     text-slate-900 font-semibold rounded-lg text-sm transition-colors"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Saving...' : 'Apply'}
        </button>
      </div>

      {message && <p className="text-sm text-blue-400">{message}</p>}
    </section>
  );
}

/** Textarea for editing raw JSON config. */
function JsonConfigEditor() {
  const config = useApi(useCallback(() => fetchConfig(), []));
  const [jsonText, setJsonText] = useState('');
  const [initialized, setInitialized] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (config.data && !initialized) {
    setJsonText(JSON.stringify(config.data.config, null, 2));
    setInitialized(true);
  }

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    try {
      const parsed: unknown = JSON.parse(jsonText);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        setMessage('Config must be a JSON object');
        return;
      }
      await updateConfig(parsed as Record<string, unknown>);
      setMessage('Config saved successfully');
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Invalid JSON';
      setMessage(errMsg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="bg-[#111] rounded-xl p-6 border border-[#222] space-y-4">
      <h4 className="text-lg font-semibold text-white">JSON Config Editor</h4>
      <p className="text-sm text-[#a0a0a0]">Edit the raw configuration JSON directly.</p>

      {config.loading && <p className="text-[#a0a0a0]">Loading config...</p>}

      <textarea
        className="w-full h-64 bg-black border border-[#333] rounded-lg px-3 py-2
                   text-white text-sm font-mono focus:outline-none focus:ring-2
                   focus:ring-blue-500/50 resize-y"
        value={jsonText}
        onChange={(e) => setJsonText(e.target.value)}
        spellCheck={false}
      />

      <div className="flex items-center gap-4">
        <button
          type="button"
          className="px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-[#1a1a1a]
                     text-slate-900 font-semibold rounded-lg text-sm transition-colors"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Saving...' : 'Save Config'}
        </button>

        {message && (
          <p className={`text-sm ${message.includes('success') ? 'text-green-400' : 'text-red-400'}`}>
            {message}
          </p>
        )}
      </div>
    </section>
  );
}

/** Get Tailwind color classes for a tier badge. */
function tierColor(tier: string): string {
  switch (tier) {
    case 'small': return 'bg-green-900/50 text-green-400';
    case 'medium': return 'bg-blue-900/50 text-blue-400';
    case 'large': return 'bg-purple-900/50 text-purple-400';
    default: return 'bg-[#1a1a1a] text-[#a0a0a0]';
  }
}
