import { useState, useEffect } from 'react';
import {
  fetchOnboardingStatus,
  verifyProviderKey,
  completeOnboarding,
  fetchOllamaStatus,
  fetchOllamaModels,
  pullOllamaModel,
} from '../lib/api.ts';
import { MODEL_CATALOG, type ModelEntry } from '../lib/model-catalog.ts';
import type { HardwareProfile, OllamaModelInfo, OllamaStatus } from '../lib/types.ts';

// ── Provider State ─────────────────────────────────────────────────

interface ProviderState {
  enabled: boolean;
  apiKey: string;
  verified: boolean | null;
  verifying: boolean;
  error?: string;
}

type ProviderName = 'anthropic' | 'openai' | 'deepseek' | 'gemini';

const PROVIDER_LABELS: Record<ProviderName, string> = {
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI (GPT)',
  deepseek: 'DeepSeek',
  gemini: 'Google Gemini',
};

const defaultProviderState = (): ProviderState => ({
  enabled: false,
  apiKey: '',
  verified: null,
  verifying: false,
});

/** Three-block onboarding wizard for new users */
export function Onboarding() {
  // ── Hardware ────────────────────────────────────────────────────
  const [hardware, setHardware] = useState<HardwareProfile | null>(null);
  const [loadingHw, setLoadingHw] = useState(true);

  // ── Cloud Providers ─────────────────────────────────────────────
  const [providers, setProviders] = useState<Record<ProviderName, ProviderState>>({
    anthropic: defaultProviderState(),
    openai: defaultProviderState(),
    deepseek: defaultProviderState(),
    gemini: defaultProviderState(),
  });

  // ── Ollama ──────────────────────────────────────────────────────
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus>({ running: false });
  const [ollamaModels, setOllamaModels] = useState<OllamaModelInfo[]>([]);
  const [ollamaChecking, setOllamaChecking] = useState(false);
  const [pullingModel, setPullingModel] = useState<string | null>(null);

  // ── Basics ──────────────────────────────────────────────────────
  const [userName, setUserName] = useState('Friend');
  const [securityLevel, setSecurityLevel] = useState(3);
  const [monthlyBudget, setMonthlyBudget] = useState(20);

  // ── Completion ──────────────────────────────────────────────────
  const [completing, setCompleting] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);

  // ── Initial Load ────────────────────────────────────────────────
  useEffect(() => {
    fetchOnboardingStatus()
      .then((status) => setHardware(status.hardware))
      .catch(() => { /* ignore */ })
      .finally(() => setLoadingHw(false));

    checkOllama();
  }, []);

  // ── Ollama Helpers ──────────────────────────────────────────────

  async function checkOllama() {
    setOllamaChecking(true);
    try {
      const status = await fetchOllamaStatus();
      setOllamaStatus(status);
      if (status.running) {
        const modelsResp = await fetchOllamaModels();
        setOllamaModels(modelsResp.models);
      }
    } catch {
      setOllamaStatus({ running: false });
    } finally {
      setOllamaChecking(false);
    }
  }

  async function handlePullModel(model: ModelEntry) {
    setPullingModel(model.ollamaTag);
    try {
      await pullOllamaModel(model.ollamaTag);
      // Poll for completion (simple approach — check models list periodically)
      const pollInterval = setInterval(async () => {
        try {
          const modelsResp = await fetchOllamaModels();
          setOllamaModels(modelsResp.models);
          const found = modelsResp.models.some((m) =>
            m.name.startsWith(model.ollamaTag.split(':')[0]),
          );
          if (found) {
            clearInterval(pollInterval);
            setPullingModel(null);
          }
        } catch {
          // keep polling
        }
      }, 5000);

      // Safety timeout — stop polling after 10 minutes
      setTimeout(() => {
        clearInterval(pollInterval);
        setPullingModel(null);
      }, 600_000);
    } catch {
      setPullingModel(null);
    }
  }

  // ── Provider Helpers ────────────────────────────────────────────

  function updateProvider(name: ProviderName, update: Partial<ProviderState>) {
    setProviders((prev) => ({
      ...prev,
      [name]: { ...prev[name], ...update },
    }));
  }

  async function handleVerifyKey(name: ProviderName) {
    const provider = providers[name];
    if (!provider.apiKey.trim()) return;

    updateProvider(name, { verifying: true, verified: null, error: undefined });

    try {
      const result = await verifyProviderKey(name, provider.apiKey);
      updateProvider(name, {
        verifying: false,
        verified: result.valid,
        error: result.error,
      });
    } catch {
      updateProvider(name, {
        verifying: false,
        verified: false,
        error: 'Verification request failed',
      });
    }
  }

  // ── Complete Setup ──────────────────────────────────────────────

  async function handleComplete() {
    setCompleting(true);
    setCompleteError(null);

    // Build config from form state
    const config: Record<string, unknown> = {
      version: 1,
      user: { name: userName },
      security: { level: securityLevel },
      budget: { monthlyLimitUsd: monthlyBudget },
      providers: {} as Record<string, unknown>,
    };

    const providerConfig = config.providers as Record<string, unknown>;

    for (const [name, state] of Object.entries(providers)) {
      if (state.enabled && state.apiKey.trim() && state.verified) {
        providerConfig[name] = {
          enabled: true,
          apiKey: state.apiKey.trim(),
        };
      }
    }

    if (ollamaStatus.running) {
      providerConfig.ollama = {
        enabled: true,
        baseUrl: 'http://localhost:11434',
      };
    }

    try {
      await completeOnboarding(config);
      setCompleted(true);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setCompleteError(message);
    } finally {
      setCompleting(false);
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────

  function isModelInstalled(tag: string): boolean {
    return ollamaModels.some((m) => m.name.startsWith(tag.split(':')[0]));
  }

  function canRunModel(model: ModelEntry): boolean {
    if (!hardware) return true; // Allow if hardware unknown
    return hardware.ramGb >= model.minRamGb && hardware.diskFreeGb >= model.minDiskGb;
  }

  const hasAtLeastOneProvider =
    Object.values(providers).some((p) => p.enabled && p.verified) ||
    ollamaStatus.running;

  // ── Render ──────────────────────────────────────────────────────

  if (completed) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-8">
        <div className="max-w-md text-center">
          <div className="text-5xl mb-4">🎉</div>
          <h1 className="text-2xl font-bold text-white mb-2">Setup Complete!</h1>
          <p className="text-[#a0a0a0] mb-6">
            Restart Lil Dude to apply your settings.
          </p>
          <code className="block bg-[#111] text-green-400 px-4 py-3 rounded-lg text-sm font-mono">
            lil-dude start
          </code>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] p-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-2">Welcome to Lil Dude</h1>
        <p className="text-[#a0a0a0] mb-8">
          Let&apos;s set up your personal AI assistant. Pick at least one model provider.
        </p>

        {/* ── Block 1: Cloud Models ─────────────────────────────── */}
        <section className="mb-8 bg-[#111] border border-[#222] rounded-xl p-6">
          <h2 className="text-xl font-semibold text-white mb-1">☁️ Cloud Models</h2>
          <p className="text-sm text-[#a0a0a0] mb-4">
            Connect cloud AI providers with your API keys.
          </p>

          {(Object.entries(PROVIDER_LABELS) as [ProviderName, string][]).map(
            ([name, label]) => {
              const provider = providers[name];
              return (
                <div key={name} className="mb-4 last:mb-0">
                  <label className="flex items-center gap-2 mb-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={provider.enabled}
                      onChange={(e) =>
                        updateProvider(name, { enabled: e.target.checked })
                      }
                      className="w-4 h-4 rounded border-[#333] bg-[#1a1a1a] text-blue-500 focus:ring-blue-500"
                    />
                    <span className="text-white text-sm font-medium">{label}</span>
                  </label>

                  {provider.enabled && (
                    <div className="ml-6 flex gap-2 items-center">
                      <input
                        type="password"
                        placeholder="Paste API key"
                        value={provider.apiKey}
                        onChange={(e) =>
                          updateProvider(name, {
                            apiKey: e.target.value,
                            verified: null,
                            error: undefined,
                          })
                        }
                        className="flex-1 bg-[#0a0a0a] border border-[#333] rounded-lg px-3 py-2 text-white text-sm
                                   placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                      <button
                        type="button"
                        onClick={() => handleVerifyKey(name)}
                        disabled={provider.verifying || !provider.apiKey.trim()}
                        className="px-3 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-[#1a1a1a] disabled:text-slate-500
                                   text-slate-900 text-sm font-medium rounded-lg transition-colors"
                      >
                        {provider.verifying ? '...' : 'Verify'}
                      </button>
                      {provider.verified === true && (
                        <span className="text-green-400 text-sm">✓</span>
                      )}
                      {provider.verified === false && (
                        <span className="text-red-400 text-xs">{provider.error ?? '✗'}</span>
                      )}
                    </div>
                  )}

                  {name === 'anthropic' && provider.enabled && (
                    <p className="ml-6 mt-1 text-xs text-[#666]">
                      API key required —{' '}
                      <a
                        href="https://console.anthropic.com"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 hover:underline"
                      >
                        get one at console.anthropic.com
                      </a>
                    </p>
                  )}
                </div>
              );
            },
          )}
        </section>

        {/* ── Block 2: Local Models (Ollama) ────────────────────── */}
        <section className="mb-8 bg-[#111] border border-[#222] rounded-xl p-6">
          <h2 className="text-xl font-semibold text-white mb-1">🖥️ Local Models</h2>
          <p className="text-sm text-[#a0a0a0] mb-4">
            Run models on your machine via Ollama. Free and private.
          </p>

          <div className="flex items-center gap-3 mb-4">
            <div
              className={`w-3 h-3 rounded-full ${
                ollamaStatus.running ? 'bg-green-500' : 'bg-red-500'
              }`}
            />
            <span className="text-white text-sm">
              {ollamaStatus.running
                ? `Ollama running (v${ollamaStatus.version ?? '?'})`
                : 'Ollama not detected'}
            </span>
            <button
              type="button"
              onClick={checkOllama}
              disabled={ollamaChecking}
              className="text-blue-400 text-xs hover:underline disabled:text-slate-500"
            >
              {ollamaChecking ? 'Checking...' : 'Re-check'}
            </button>
          </div>

          {!ollamaStatus.running && (
            <div className="bg-[#0a0a0a] border border-[#222] rounded-lg p-4 text-sm text-[#a0a0a0]">
              <p className="mb-2">Install Ollama to run models locally:</p>
              <code className="block bg-[#111] text-green-400 px-3 py-2 rounded text-xs font-mono">
                curl -fsSL https://ollama.com/install.sh | sh
              </code>
              <p className="mt-2 text-xs">
                Or visit{' '}
                <a
                  href="https://ollama.com/download"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:underline"
                >
                  ollama.com/download
                </a>
              </p>
            </div>
          )}

          {ollamaStatus.running && ollamaModels.length > 0 && (
            <div className="mt-2">
              <p className="text-sm text-[#a0a0a0] mb-2">Installed models:</p>
              <ul className="space-y-1">
                {ollamaModels.map((m) => (
                  <li
                    key={m.digest}
                    className="text-sm text-green-400 flex items-center gap-2"
                  >
                    <span>✓</span>
                    <span>{m.name}</span>
                    <span className="text-[#666]">
                      ({(m.size / 1e9).toFixed(1)} GB)
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {/* ── Block 3: Download a Model ─────────────────────────── */}
        {ollamaStatus.running && (
          <section className="mb-8 bg-[#111] border border-[#222] rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-1">
              🧱 Build Your Own Agent
            </h2>
            <p className="text-sm text-[#a0a0a0] mb-4">
              Pick a model to download. Grayed-out models exceed your hardware.
            </p>

            {loadingHw ? (
              <p className="text-sm text-[#666]">Detecting hardware...</p>
            ) : (
              hardware && (
                <p className="text-xs text-[#666] mb-4">
                  System: {hardware.ramGb} GB RAM, {hardware.diskFreeGb} GB disk free,{' '}
                  {hardware.cpuCores} cores
                </p>
              )
            )}

            <div className="space-y-3">
              {MODEL_CATALOG.map((model) => {
                const installed = isModelInstalled(model.ollamaTag);
                const runnable = canRunModel(model);
                const isPulling = pullingModel === model.ollamaTag;

                return (
                  <div
                    key={model.ollamaTag}
                    className={`flex items-center justify-between p-3 rounded-lg border ${
                      runnable
                        ? 'border-[#222] bg-[#0a0a0a]'
                        : 'border-[#1a1a1a] bg-[#0a0a0a] opacity-50'
                    }`}
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-white text-sm font-medium">
                          {model.name}
                        </span>
                        <span className="text-xs text-[#666]">{model.sizeGb} GB</span>
                        {installed && (
                          <span className="text-green-400 text-xs">✓ Installed</span>
                        )}
                      </div>
                      <p className="text-xs text-[#a0a0a0] mt-0.5">
                        {model.description}
                      </p>
                      {!runnable && (
                        <p className="text-xs text-red-400 mt-0.5">
                          Requires {model.minRamGb} GB RAM, {model.minDiskGb} GB disk
                        </p>
                      )}
                    </div>

                    {!installed && runnable && (
                      <button
                        type="button"
                        onClick={() => handlePullModel(model)}
                        disabled={isPulling || pullingModel !== null}
                        className="ml-3 px-3 py-1.5 bg-blue-500 hover:bg-blue-600 disabled:bg-[#1a1a1a]
                                   disabled:text-slate-500 text-slate-900 text-xs font-medium rounded-lg
                                   transition-colors"
                      >
                        {isPulling ? 'Downloading...' : 'Download'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Basics ────────────────────────────────────────────── */}
        <section className="mb-8 bg-[#111] border border-[#222] rounded-xl p-6">
          <h2 className="text-xl font-semibold text-white mb-4">⚙️ Basics</h2>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm text-[#a0a0a0] mb-1">Your name</label>
              <input
                type="text"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                className="w-full bg-[#0a0a0a] border border-[#333] rounded-lg px-3 py-2 text-white text-sm
                           focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm text-[#a0a0a0] mb-1">Security (1-5)</label>
              <select
                value={securityLevel}
                onChange={(e) => setSecurityLevel(Number(e.target.value))}
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
                onChange={(e) => setMonthlyBudget(Number(e.target.value))}
                className="w-full bg-[#0a0a0a] border border-[#333] rounded-lg px-3 py-2 text-white text-sm
                           focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>
        </section>

        {/* ── Complete ──────────────────────────────────────────── */}
        <div className="text-center">
          {completeError && (
            <p className="text-red-400 text-sm mb-3">{completeError}</p>
          )}
          <button
            type="button"
            onClick={handleComplete}
            disabled={completing || !hasAtLeastOneProvider}
            className="px-8 py-3 bg-green-500 hover:bg-green-600 disabled:bg-[#1a1a1a] disabled:text-slate-500
                       text-slate-900 font-semibold rounded-xl text-lg transition-colors"
          >
            {completing ? 'Saving...' : 'Complete Setup'}
          </button>
          {!hasAtLeastOneProvider && (
            <p className="text-sm text-[#666] mt-2">
              Enable and verify at least one provider to continue.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
