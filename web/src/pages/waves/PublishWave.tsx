/**
 * Publish wave wizard page.
 * Step-by-step flow: select wave → validate → review → publish.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { validateWaveForPublish, fetchPublishHistory, type PublishHistoryEntry } from './wave-hub-api.ts';

/** Wizard step type. */
type WizardStep = 'select' | 'validating' | 'review' | 'publishing' | 'done';

/** Validation result from the API. */
interface ValidationResult {
  valid: boolean;
  manifest: { name: string; version: string; description: string };
  scanResult: { passed: boolean; summary: Record<string, number> };
  packageHash: string;
  totalSizeBytes: number;
  fileCount: number;
}

/** Publish wave wizard component. */
export function PublishWave() {
  const navigate = useNavigate();
  const [step, setStep] = useState<WizardStep>('select');
  const [wavePath, setWavePath] = useState('');
  const [skipSandbox, setSkipSandbox] = useState(false);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [publishHistory, setPublishHistory] = useState<PublishHistoryEntry[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);

  async function loadHistory() {
    if (historyLoaded) return;
    try {
      const data = await fetchPublishHistory(10);
      setPublishHistory(data.submissions);
      setHistoryLoaded(true);
    } catch {
      // Non-critical
    }
  }

  // Load history on mount
  if (!historyLoaded) {
    loadHistory();
  }

  async function handleValidate() {
    if (!wavePath.trim()) return;
    setStep('validating');
    setError(null);
    try {
      const result = await validateWaveForPublish(wavePath.trim(), skipSandbox);
      setValidationResult(result);
      setStep('review');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Validation failed';
      setError(message);
      setStep('select');
    }
  }

  function handleBack() {
    setStep('select');
    setValidationResult(null);
    setError(null);
  }

  return (
    <div className="space-y-6">
      {/* Back link */}
      <button
        type="button"
        className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
        onClick={() => navigate('/hub/community')}
      >
        ← Back to Community
      </button>

      <h2 className="text-xl font-bold text-white">Publish a Wave</h2>
      <p className="text-sm text-[#a0a0a0]">
        Share your wave with the community by publishing to the registry.
      </p>

      {/* Step indicator */}
      <div className="flex items-center gap-2 text-xs">
        {(['select', 'validating', 'review', 'done'] as const).map((s, i) => {
          const labels = ['Select', 'Validate', 'Review', 'Done'];
          const isActive = s === step || (s === 'validating' && step === 'publishing');
          const isPast =
            (s === 'select' && step !== 'select') ||
            (s === 'validating' && (step === 'review' || step === 'publishing' || step === 'done')) ||
            (s === 'review' && (step === 'publishing' || step === 'done'));
          return (
            <div key={s} className="flex items-center gap-2">
              {i > 0 && <span className="text-[#444]">→</span>}
              <span className={`px-2 py-1 rounded ${
                isActive ? 'bg-blue-600 text-white' :
                isPast ? 'bg-green-500/20 text-green-400' :
                'bg-[#222] text-[#888]'
              }`}>
                {labels[i]}
              </span>
            </div>
          );
        })}
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {/* Step: Select wave path */}
      {step === 'select' && (
        <div className="bg-[#111] rounded-xl p-6 border border-[#222] space-y-4">
          <div>
            <label htmlFor="wave-path" className="text-sm text-[#a0a0a0] block mb-2">
              Wave directory path
            </label>
            <input
              id="wave-path"
              type="text"
              className="w-full bg-[#0a0a0a] border border-[#333] rounded-lg px-4 py-2.5 text-white text-sm font-mono placeholder-[#666] focus:outline-none focus:border-blue-500"
              placeholder="/path/to/your/wave"
              value={wavePath}
              onChange={(e) => setWavePath(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleValidate(); }}
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              id="skip-sandbox"
              type="checkbox"
              className="rounded border-[#444]"
              checked={skipSandbox}
              onChange={(e) => setSkipSandbox(e.target.checked)}
            />
            <label htmlFor="skip-sandbox" className="text-xs text-[#888]">
              Skip sandbox execution (scan still required)
            </label>
          </div>
          <button
            type="button"
            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
            onClick={handleValidate}
            disabled={!wavePath.trim()}
          >
            Validate
          </button>
        </div>
      )}

      {/* Step: Validating */}
      {step === 'validating' && (
        <div className="bg-[#111] rounded-xl p-8 border border-[#222] text-center">
          <p className="text-[#a0a0a0]">Validating wave…</p>
          <p className="text-xs text-[#666] mt-2">Running security scan and manifest validation.</p>
        </div>
      )}

      {/* Step: Review validation results */}
      {step === 'review' && validationResult && (
        <div className="bg-[#111] rounded-xl p-6 border border-[#222] space-y-5">
          <h3 className="text-white font-semibold">Validation Results</h3>

          {/* Manifest info */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="bg-[#0a0a0a] rounded-lg p-3 border border-[#222]">
              <p className="text-[#888] text-xs">Name</p>
              <p className="text-white font-mono">{validationResult.manifest.name}</p>
            </div>
            <div className="bg-[#0a0a0a] rounded-lg p-3 border border-[#222]">
              <p className="text-[#888] text-xs">Version</p>
              <p className="text-white">{validationResult.manifest.version}</p>
            </div>
          </div>
          <p className="text-sm text-[#a0a0a0]">{validationResult.manifest.description}</p>

          {/* Check results */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <span className={validationResult.scanResult.passed ? 'text-green-400' : 'text-red-400'}>
                {validationResult.scanResult.passed ? '✓' : '✗'}
              </span>
              <span className="text-[#a0a0a0]">Security scan</span>
              {!validationResult.scanResult.passed && (
                <span className="text-xs text-red-400 ml-auto">
                  {Object.entries(validationResult.scanResult.summary)
                    .map(([k, v]) => `${v} ${k}`)
                    .join(', ')}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-green-400">✓</span>
              <span className="text-[#a0a0a0]">
                {validationResult.fileCount} files · {Math.round(validationResult.totalSizeBytes / 1024)}KB
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-[#888]">#</span>
              <span className="text-[#666] font-mono text-xs">
                {validationResult.packageHash.slice(0, 16)}…
              </span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              className="px-4 py-2.5 bg-[#222] hover:bg-[#333] text-white text-sm rounded-lg transition-colors"
              onClick={handleBack}
            >
              Back
            </button>
            <button
              type="button"
              className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
              disabled={!validationResult.scanResult.passed}
              onClick={() => {
                // Publish flow requires CLI with GitHub token — redirect to CLI instructions
                setStep('done');
              }}
            >
              {validationResult.scanResult.passed ? 'Continue to Publish' : 'Scan Failed'}
            </button>
          </div>
        </div>
      )}

      {/* Step: Done / CLI instructions */}
      {step === 'done' && validationResult && (
        <div className="bg-[#111] rounded-xl p-6 border border-[#222] space-y-4">
          <div className="flex items-center gap-2">
            <span className="text-green-400 text-lg">✓</span>
            <h3 className="text-white font-semibold">Validation Passed</h3>
          </div>
          <p className="text-sm text-[#a0a0a0]">
            Your wave is ready to publish. Run the following command to open a PR:
          </p>
          <div className="bg-[#0a0a0a] rounded-lg p-4 border border-[#333] font-mono text-sm text-white">
            lil-dude wave publish {wavePath}
          </div>
          <p className="text-xs text-[#666]">
            Make sure you have a GitHub token set via <span className="font-mono">GITHUB_TOKEN</span> environment variable
            or the <span className="font-mono">--github-token</span> flag.
          </p>
          <button
            type="button"
            className="px-4 py-2 bg-[#222] hover:bg-[#333] text-white text-sm rounded-lg transition-colors"
            onClick={handleBack}
          >
            Validate another
          </button>
        </div>
      )}

      {/* Publishing step */}
      {step === 'publishing' && (
        <div className="bg-[#111] rounded-xl p-8 border border-[#222] text-center">
          <p className="text-[#a0a0a0]">Publishing…</p>
        </div>
      )}

      {/* Recent publish history */}
      {publishHistory.length > 0 && (
        <section>
          <h3 className="text-lg font-semibold text-white mb-3">Recent Submissions</h3>
          <div className="space-y-2">
            {publishHistory.map((entry) => (
              <div
                key={entry.id}
                className="bg-[#111] rounded-lg p-3 border border-[#222] flex items-center justify-between"
              >
                <div>
                  <p className="text-sm text-white font-medium">{entry.waveName}</p>
                  <p className="text-xs text-[#888]">
                    v{entry.version} · {new Date(entry.publishedAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-medium border ${
                    entry.status === 'merged' ? 'bg-green-500/10 text-green-400 border-green-500/20' :
                    entry.status === 'pending' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
                    'bg-[#222] text-[#888] border-[#333]'
                  }`}>
                    {entry.status}
                  </span>
                  {entry.prUrl && (
                    <a
                      href={entry.prUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-400 hover:text-blue-300"
                    >
                      PR #{entry.prNumber}
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
