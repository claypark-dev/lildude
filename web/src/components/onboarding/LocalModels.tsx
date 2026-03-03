/**
 * Local models (Ollama) section of the onboarding wizard.
 * Handles Ollama installation, detection, and model pulling.
 */

import { MODEL_CATALOG, type ModelEntry } from '../../lib/model-catalog.ts';
import type { LocalModelsProps } from './types.ts';
import type { HardwareProfile } from '../../lib/types.ts';

/** Get the Ollama download URL appropriate for the user's OS */
function getOllamaDownloadUrl(hardware: HardwareProfile | null): { url: string; label: string } {
  const os = hardware?.os ?? 'unknown';
  if (os === 'darwin') return { url: 'https://ollama.com/download/Ollama-darwin.zip', label: 'Download Ollama for macOS' };
  if (os === 'win32') return { url: 'https://ollama.com/download/OllamaSetup.exe', label: 'Download Ollama for Windows' };
  return { url: 'https://ollama.com/download/ollama-linux-amd64.tgz', label: 'Download Ollama for Linux' };
}

/** Pick the best model for this user's hardware */
function getRecommendedModel(hardware: HardwareProfile | null): ModelEntry | null {
  if (!hardware) return MODEL_CATALOG[0];
  const ramGb = hardware.ramGb;
  const candidates = MODEL_CATALOG.filter(
    (m) => ramGb >= m.minRamGb && hardware.diskFreeGb >= m.minDiskGb,
  );
  if (candidates.length === 0) return null;
  if (ramGb < 16) return candidates[0];
  return candidates.find((m) => m.ollamaTag === 'qwen2.5') ?? candidates[candidates.length - 1];
}

/** Local model installation and management via Ollama */
export function LocalModels({
  hardware,
  ollamaStatus,
  ollamaModels,
  ollamaChecking,
  pullingModel,
  waitingForInstall,
  selectedModel,
  onCheckOllama,
  onPullModel,
  onSetWaitingForInstall,
  onSelectModel,
}: LocalModelsProps) {
  const download = getOllamaDownloadUrl(hardware);

  function isModelInstalled(tag: string): boolean {
    return ollamaModels.some((m) => m.name.startsWith(tag.split(':')[0]));
  }

  function canRunModel(model: ModelEntry): boolean {
    if (!hardware) return true;
    return hardware.ramGb >= model.minRamGb && hardware.diskFreeGb >= model.minDiskGb;
  }

  return (
    <section className="mb-8 bg-[#111] border border-[#222] rounded-xl p-6">
      <h2 className="text-xl font-semibold text-white mb-1">Local Models</h2>
      <p className="text-sm text-[#a0a0a0] mb-4">
        Run AI on your machine — free, private, no API key needed.
      </p>

      {/* Step 1: Install Ollama */}
      {!ollamaStatus.running && (
        <div className="mb-4">
          <div className="flex items-center gap-3 mb-4">
            <div className="flex items-center justify-center w-7 h-7 rounded-full bg-blue-500/20 text-blue-400 text-sm font-bold">
              1
            </div>
            <span className="text-white text-sm font-medium">Install Ollama</span>
          </div>

          <div className="ml-10">
            {!waitingForInstall ? (
              <>
                <a
                  href={download.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => onSetWaitingForInstall(true)}
                  className="inline-flex items-center gap-2 px-5 py-3 bg-blue-500 hover:bg-blue-600
                             text-slate-900 font-semibold rounded-xl transition-colors text-sm"
                >
                  {download.label}
                  <span className="text-lg">{'\u2193'}</span>
                </a>
                <p className="text-xs text-[#666] mt-2">
                  One-click installer. Open the downloaded file and follow the prompts.
                </p>
              </>
            ) : (
              <div className="bg-[#0a0a0a] border border-blue-500/20 rounded-lg p-4">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                  <span className="text-blue-400 text-sm font-medium">
                    Waiting for Ollama to start...
                  </span>
                </div>
                <p className="text-xs text-[#a0a0a0]">
                  Install and open the downloaded file. This page will detect it automatically.
                </p>
                <button
                  type="button"
                  onClick={() => onSetWaitingForInstall(false)}
                  className="mt-2 text-xs text-[#666] hover:text-[#a0a0a0] transition-colors"
                >
                  Cancel waiting
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Ollama detected */}
      {ollamaStatus.running && (
        <>
          <div className="flex items-center gap-3 mb-4 bg-green-500/5 border border-green-500/20 rounded-lg px-4 py-3">
            <div className="w-3 h-3 rounded-full bg-green-500" />
            <span className="text-green-400 text-sm font-medium">
              Ollama is running (v{ollamaStatus.version ?? '?'})
            </span>
          </div>

          {/* Installed models + picker */}
          {ollamaModels.length > 0 && (
            <div className="mb-4">
              <p className="text-xs text-[#666] mb-2 uppercase tracking-wider">Installed</p>
              {ollamaModels.map((m) => (
                <div
                  key={m.digest}
                  className="flex items-center gap-2 py-1.5 text-sm text-green-400"
                >
                  <span>{'\u2713'}</span>
                  <span>{m.name}</span>
                  <span className="text-[#666]">({(m.size / 1e9).toFixed(1)} GB)</span>
                </div>
              ))}

              {/* Model picker — shown when multiple models are installed */}
              {ollamaModels.length > 1 && (
                <div className="mt-3 pt-3 border-t border-[#222]">
                  <label className="block text-xs text-[#a0a0a0] mb-1">Default model</label>
                  <select
                    value={selectedModel ?? ollamaModels[0].name.split(':')[0]}
                    onChange={(e) => onSelectModel(e.target.value)}
                    className="w-full bg-[#0a0a0a] border border-[#333] rounded-lg px-3 py-2 text-white text-sm
                               focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    {ollamaModels.map((m) => (
                      <option key={m.digest} value={m.name.split(':')[0]}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          {/* Model catalog */}
          <ModelCatalog
            hardware={hardware}
            pullingModel={pullingModel}
            isModelInstalled={isModelInstalled}
            canRunModel={canRunModel}
            onPullModel={onPullModel}
          />
        </>
      )}

      {/* Not running and not waiting */}
      {!ollamaStatus.running && !waitingForInstall && (
        <div className="mt-4 pt-4 border-t border-[#222]">
          <button
            type="button"
            onClick={onCheckOllama}
            disabled={ollamaChecking}
            className="text-blue-400 text-xs hover:underline disabled:text-slate-500"
          >
            {ollamaChecking ? 'Checking...' : 'Already have Ollama? Click to detect'}
          </button>
        </div>
      )}
    </section>
  );
}

// ── Model Catalog Sub-component ───────────────────────────────────────

interface ModelCatalogProps {
  hardware: HardwareProfile | null;
  pullingModel: string | null;
  isModelInstalled: (tag: string) => boolean;
  canRunModel: (model: ModelEntry) => boolean;
  onPullModel: (model: ModelEntry) => void;
}

/** Renders the available models list with install buttons */
function ModelCatalog({
  hardware,
  pullingModel,
  isModelInstalled,
  canRunModel,
  onPullModel,
}: ModelCatalogProps) {
  const recommended = getRecommendedModel(hardware);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-[#666] uppercase tracking-wider">Available models</p>
        {hardware && (
          <p className="text-xs text-[#666]">
            Your system: {hardware.ramGb} GB RAM, {hardware.diskFreeGb} GB free disk
          </p>
        )}
      </div>

      <div className="space-y-2">
        {MODEL_CATALOG.map((model) => {
          const installed = isModelInstalled(model.ollamaTag);
          const runnable = canRunModel(model);
          const isPulling = pullingModel === model.ollamaTag;
          const isRecommended = recommended?.ollamaTag === model.ollamaTag;

          return (
            <div
              key={model.ollamaTag}
              className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
                installed
                  ? 'border-green-500/20 bg-green-500/5'
                  : isRecommended && runnable
                    ? 'border-blue-500/30 bg-blue-500/5'
                    : runnable
                      ? 'border-[#222] bg-[#0a0a0a]'
                      : 'border-[#1a1a1a] bg-[#0a0a0a] opacity-40'
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-white text-sm font-medium">{model.name}</span>
                  <span className="text-xs text-[#666]">{model.sizeGb} GB</span>
                  {installed && (
                    <span className="text-green-400 text-xs font-medium">{'\u2713'} Installed</span>
                  )}
                  {isRecommended && runnable && !installed && (
                    <span className="px-1.5 py-0.5 bg-blue-500/20 text-blue-400 text-xs rounded font-medium">
                      Recommended
                    </span>
                  )}
                  {!runnable && (
                    <span className="px-1.5 py-0.5 bg-red-500/10 text-red-400 text-xs rounded">
                      Needs {model.minRamGb}GB RAM
                    </span>
                  )}
                </div>
                <p className="text-xs text-[#a0a0a0] mt-0.5">{model.description}</p>
              </div>

              {!installed && runnable && (
                <button
                  type="button"
                  onClick={() => onPullModel(model)}
                  disabled={isPulling || pullingModel !== null}
                  className={`ml-3 px-4 py-2 text-xs font-medium rounded-lg transition-colors flex-shrink-0 ${
                    isRecommended
                      ? 'bg-blue-500 hover:bg-blue-600 disabled:bg-[#1a1a1a] disabled:text-slate-500 text-slate-900'
                      : 'bg-[#1a1a1a] hover:bg-[#222] disabled:text-slate-600 text-[#ccc] border border-[#333]'
                  }`}
                >
                  {isPulling ? (
                    <span className="flex items-center gap-1.5">
                      <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                      Downloading...
                    </span>
                  ) : (
                    'Install'
                  )}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
