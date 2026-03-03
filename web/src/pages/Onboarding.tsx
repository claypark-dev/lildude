/**
 * Onboarding wizard page.
 * Composes extracted sub-components for cloud providers, local models,
 * basics, channel setup, and completion/restart flow.
 */

import { useState, useEffect } from 'react';
import {
  fetchOnboardingStatus,
  verifyProviderKey,
  completeOnboarding,
  resetOnboarding,
  fetchOllamaStatus,
  fetchOllamaModels,
  pullOllamaModel,
} from '../lib/api.ts';
import type { ModelEntry } from '../lib/model-catalog.ts';
import type { HardwareProfile, OllamaModelInfo, OllamaStatus } from '../lib/types.ts';
import type { ProviderName, ProviderState, ChannelSetupState } from '../components/onboarding/types.ts';
import { CloudProviders } from '../components/onboarding/CloudProviders.tsx';
import { LocalModels } from '../components/onboarding/LocalModels.tsx';
import { BasicsForm } from '../components/onboarding/BasicsForm.tsx';
import { ResetBanner } from '../components/onboarding/ResetBanner.tsx';
import { CompletionScreen } from '../components/onboarding/CompletionScreen.tsx';
import { ChannelSetup } from '../components/onboarding/ChannelSetup.tsx';

const defaultProviderState = (): ProviderState => ({
  enabled: false,
  apiKey: '',
  verified: null,
  verifying: false,
});

/** Multi-step onboarding wizard for new users */
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
  const [waitingForInstall, setWaitingForInstall] = useState(false);
  const [selectedOllamaModel, setSelectedOllamaModel] = useState<string | null>(null);

  // ── Basics ──────────────────────────────────────────────────────
  const [userName, setUserName] = useState('Friend');
  const [securityLevel, setSecurityLevel] = useState(3);
  const [monthlyBudget, setMonthlyBudget] = useState(20);

  // ── Channels ────────────────────────────────────────────────────
  const [channels, setChannels] = useState<ChannelSetupState>({
    telegram: { enabled: false, token: '' },
    discord: { enabled: false, token: '' },
    imessage: { enabled: false },
  });

  // ── Completion ──────────────────────────────────────────────────
  const [completing, setCompleting] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);

  // ── Reset ───────────────────────────────────────────────────────
  const [alreadyOnboarded, setAlreadyOnboarded] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  const [loadError, setLoadError] = useState<string | null>(null);

  // ── Initial Load ───────────────────────────────────────────────
  useEffect(() => {
    fetchOnboardingStatus()
      .then((status) => {
        setHardware(status.hardware);
        setAlreadyOnboarded(status.onboarded);
      })
      .catch(() => {
        setLoadError('Failed to load system info. Is the server running?');
      })
      .finally(() => setLoadingHw(false));

    checkOllama();
  }, []);

  // ── Auto-poll for Ollama after download ────────────────────────
  useEffect(() => {
    if (!waitingForInstall || ollamaStatus.running) return;

    const interval = setInterval(async () => {
      try {
        const status = await fetchOllamaStatus();
        if (status.running) {
          setOllamaStatus(status);
          setWaitingForInstall(false);
          const modelsResp = await fetchOllamaModels();
          setOllamaModels(modelsResp.models);
        }
      } catch {
        // keep polling
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [waitingForInstall, ollamaStatus.running]);

  // ── Ollama Handlers ────────────────────────────────────────────

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

      setTimeout(() => {
        clearInterval(pollInterval);
        setPullingModel(null);
      }, 600_000);
    } catch {
      setPullingModel(null);
    }
  }

  // ── Provider Handlers ──────────────────────────────────────────

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

  // ── Channel Handler ────────────────────────────────────────────

  function updateChannel<K extends keyof ChannelSetupState>(
    channel: K,
    update: Partial<ChannelSetupState[K]>,
  ): void {
    setChannels((prev) => ({
      ...prev,
      [channel]: { ...prev[channel], ...update },
    }));
  }

  // ── Complete Setup ─────────────────────────────────────────────

  async function handleComplete() {
    setCompleting(true);
    setCompleteError(null);

    const config: Record<string, unknown> = {
      version: 1,
      user: { name: userName },
      security: { level: securityLevel },
      budget: { monthlyLimitUsd: monthlyBudget },
      providers: {} as Record<string, unknown>,
      channels: {} as Record<string, unknown>,
    };

    // Providers
    const providerConfig = config.providers as Record<string, unknown>;
    for (const [name, state] of Object.entries(providers)) {
      if (state.enabled && state.apiKey.trim() && state.verified) {
        providerConfig[name] = { enabled: true, apiKey: state.apiKey.trim() };
      }
    }
    if (ollamaStatus.running) {
      // Use user-selected model, first installed model, or fall back to schema default
      const modelName = selectedOllamaModel
        ?? (ollamaModels.length > 0 ? ollamaModels[0].name.split(':')[0] : undefined);

      providerConfig.ollama = {
        enabled: true,
        baseUrl: 'http://localhost:11434',
        ...(modelName ? { model: modelName } : {}),
      };
    }

    // Channels
    const channelConfig = config.channels as Record<string, unknown>;
    channelConfig.webchat = { enabled: true };
    if (channels.telegram.enabled && channels.telegram.token.trim()) {
      channelConfig.telegram = { enabled: true, token: channels.telegram.token.trim() };
    }
    if (channels.discord.enabled && channels.discord.token.trim()) {
      channelConfig.discord = { enabled: true, token: channels.discord.token.trim() };
    }
    if (channels.imessage.enabled) {
      channelConfig.imessage = { enabled: true };
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

  // ── Reset Handler ──────────────────────────────────────────────

  async function handleReset() {
    setResetting(true);
    setResetError(null);

    try {
      await resetOnboarding();
      setAlreadyOnboarded(false);
      setConfirmingReset(false);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setResetError(message);
    } finally {
      setResetting(false);
    }
  }

  // ── Derived State ──────────────────────────────────────────────

  const hasAtLeastOneProvider =
    Object.values(providers).some((p) => p.enabled && p.verified) ||
    ollamaStatus.running;

  // ── Render ─────────────────────────────────────────────────────

  if (loadingHw) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-8">
        <div className="flex items-center gap-3 text-[#a0a0a0]">
          <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
          <span>Loading system info...</span>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center p-8">
        <div className="text-center space-y-3">
          <p className="text-red-400">{loadError}</p>
          <button
            type="button"
            className="text-blue-400 text-sm hover:underline"
            onClick={() => window.location.reload()}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (completed) {
    return <CompletionScreen />;
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] p-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-2">
          {alreadyOnboarded ? 'Setup Wizard' : 'Welcome to Lil Dude'}
        </h1>
        <p className="text-[#a0a0a0] mb-8">
          {alreadyOnboarded
            ? 'You already have a configuration. You can reconfigure below, or start fresh.'
            : "Let's set up your personal AI assistant. Pick at least one model provider."}
        </p>

        {alreadyOnboarded && (
          <ResetBanner
            confirmingReset={confirmingReset}
            resetting={resetting}
            resetError={resetError}
            onStartReset={() => setConfirmingReset(true)}
            onConfirmReset={handleReset}
            onCancelReset={() => setConfirmingReset(false)}
          />
        )}

        <CloudProviders
          providers={providers}
          onUpdateProvider={updateProvider}
          onVerifyKey={handleVerifyKey}
        />

        <LocalModels
          hardware={hardware}
          ollamaStatus={ollamaStatus}
          ollamaModels={ollamaModels}
          ollamaChecking={ollamaChecking}
          pullingModel={pullingModel}
          waitingForInstall={waitingForInstall}
          selectedModel={selectedOllamaModel}
          onCheckOllama={checkOllama}
          onPullModel={handlePullModel}
          onSetWaitingForInstall={setWaitingForInstall}
          onSelectModel={setSelectedOllamaModel}
        />

        <BasicsForm
          userName={userName}
          securityLevel={securityLevel}
          monthlyBudget={monthlyBudget}
          onUserNameChange={setUserName}
          onSecurityLevelChange={setSecurityLevel}
          onMonthlyBudgetChange={setMonthlyBudget}
        />

        <ChannelSetup
          hardware={hardware}
          channels={channels}
          onChannelChange={updateChannel}
        />

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
