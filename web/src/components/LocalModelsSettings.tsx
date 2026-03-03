/**
 * Local Models (Ollama) settings section.
 * Shows Ollama status, installed models, model selection, and
 * the ability to install/remove models outside of onboarding.
 */

import { useState, useEffect } from 'react';
import {
  fetchOllamaStatus,
  fetchOllamaModels,
  pullOllamaModel,
} from '../lib/api.ts';
import { MODEL_CATALOG, type ModelEntry } from '../lib/model-catalog.ts';
import type { OllamaModelInfo, OllamaStatus } from '../lib/types.ts';

/** Local Models management section for the Settings page */
export function LocalModelsSettings() {
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus>({ running: false });
  const [ollamaModels, setOllamaModels] = useState<OllamaModelInfo[]>([]);
  const [checking, setChecking] = useState(true);
  const [pullingModel, setPullingModel] = useState<string | null>(null);
  const [pullError, setPullError] = useState<string | null>(null);

  useEffect(() => {
    checkOllama();
  }, []);

  /** Check Ollama status and load installed models */
  async function checkOllama() {
    setChecking(true);
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
      setChecking(false);
    }
  }

  /** Pull a model from the Ollama registry */
  async function handlePullModel(model: ModelEntry) {
    setPullingModel(model.ollamaTag);
    setPullError(null);
    try {
      await pullOllamaModel(model.ollamaTag);
      // Poll for completion
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
          // keep polling — transient errors are expected during a pull
        }
      }, 5000);

      setTimeout(() => {
        clearInterval(pollInterval);
        setPullingModel(null);
      }, 600_000);
    } catch {
      setPullingModel(null);
      setPullError(`Failed to pull ${model.ollamaTag}. Check that Ollama is running.`);
    }
  }

  /** Check if a model tag is installed */
  function isModelInstalled(tag: string): boolean {
    return ollamaModels.some((m) => m.name.startsWith(tag.split(':')[0]));
  }

  if (checking) {
    return (
      <section className="bg-[#111] rounded-xl p-6 border border-[#222] space-y-4">
        <h3 className="text-lg font-semibold text-white">Local Models</h3>
        <div className="flex items-center gap-2 text-[#a0a0a0] text-sm">
          <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
          <span>Checking Ollama...</span>
        </div>
      </section>
    );
  }

  return (
    <section className="bg-[#111] rounded-xl p-6 border border-[#222] space-y-4">
      <h3 className="text-lg font-semibold text-white">Local Models</h3>

      {/* Ollama status */}
      {!ollamaStatus.running ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-red-500" />
            <span className="text-red-400 text-sm">Ollama is not running</span>
          </div>
          <p className="text-xs text-[#666]">
            Start Ollama to use local models. Download from{' '}
            <a
              href="https://ollama.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:underline"
            >
              ollama.com
            </a>
          </p>
          <button
            type="button"
            onClick={checkOllama}
            className="text-blue-400 text-xs hover:underline"
          >
            Retry detection
          </button>
        </div>
      ) : (
        <>
          {/* Running status */}
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-green-500" />
            <span className="text-green-400 text-sm">
              Ollama running (v{ollamaStatus.version ?? '?'})
            </span>
          </div>

          {/* Installed models list */}
          {ollamaModels.length > 0 ? (
            <div>
              <p className="text-xs text-[#666] mb-2 uppercase tracking-wider">
                Installed models
              </p>
              {ollamaModels.map((m) => (
                <div
                  key={m.digest}
                  className="flex items-center justify-between py-2 text-sm border-b border-[#1a1a1a] last:border-0"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-green-400">{'\u2713'}</span>
                    <span className="text-white">{m.name}</span>
                    <span className="text-[#666]">
                      ({(m.size / 1e9).toFixed(1)} GB)
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[#a0a0a0]">
              No models installed. Install one below to enable local inference.
            </p>
          )}

          {pullError && (
            <p className="text-red-400 text-sm">{pullError}</p>
          )}

          {/* Available models to install */}
          <div>
            <p className="text-xs text-[#666] mb-2 uppercase tracking-wider">
              Available to install
            </p>
            <div className="space-y-2">
              {MODEL_CATALOG.filter((m) => !isModelInstalled(m.ollamaTag)).map(
                (model) => {
                  const isPulling = pullingModel === model.ollamaTag;
                  return (
                    <div
                      key={model.ollamaTag}
                      className="flex items-center justify-between p-3 rounded-lg border border-[#222] bg-[#0a0a0a]"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-white text-sm font-medium">
                            {model.name}
                          </span>
                          <span className="text-xs text-[#666]">
                            {model.sizeGb} GB
                          </span>
                        </div>
                        <p className="text-xs text-[#a0a0a0] mt-0.5">
                          {model.description}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handlePullModel(model)}
                        disabled={isPulling || pullingModel !== null}
                        className="ml-3 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors
                                   bg-[#1a1a1a] hover:bg-[#222] disabled:text-slate-600 text-[#ccc] border border-[#333]"
                      >
                        {isPulling ? (
                          <span className="flex items-center gap-1.5">
                            <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                            Pulling...
                          </span>
                        ) : (
                          'Install'
                        )}
                      </button>
                    </div>
                  );
                },
              )}
              {MODEL_CATALOG.every((m) => isModelInstalled(m.ollamaTag)) && (
                <p className="text-xs text-[#666]">All catalog models are installed.</p>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
