import { useState, useCallback } from 'react';
import { useApi } from '../hooks/useApi.ts';
import { fetchConfig, updateConfig, updateSecurityLevel } from '../lib/api.ts';
import { PowerUserPanel } from './PowerUserPanel.tsx';
import { LocalModelsSettings } from '../components/LocalModelsSettings.tsx';
import { VoiceSettings } from '../components/VoiceSettings.tsx';

const SECURITY_LEVELS: Record<number, string> = {
  1: 'Minimal -- Basic input validation only',
  2: 'Low -- Input validation + command filtering',
  3: 'Standard -- Full sandbox + content wrapping',
  4: 'High -- Strict sandbox + confirmation prompts',
  5: 'Maximum -- All protections + audit logging',
};

interface SettingsFormState {
  openaiApiKey: string;
  anthropicApiKey: string;
  slackEnabled: boolean;
  discordEnabled: boolean;
  telegramEnabled: boolean;
  webEnabled: boolean;
  securityLevel: number;
  monthlyBudgetUsd: number;
  dailyLimitUsd: number;
  agentName: string;
  agentPersona: string;
  heartbeatEnabled: boolean;
  heartbeatIntervalMinutes: number;
  heartbeatMaxDailyBudgetUsd: number;
}

const DEFAULT_FORM: SettingsFormState = {
  openaiApiKey: '',
  anthropicApiKey: '',
  slackEnabled: false,
  discordEnabled: false,
  telegramEnabled: false,
  webEnabled: true,
  securityLevel: 3,
  monthlyBudgetUsd: 10,
  dailyLimitUsd: 2,
  agentName: 'Lil Dude',
  agentPersona: 'a chill, capable AI executive assistant',
  heartbeatEnabled: true,
  heartbeatIntervalMinutes: 30,
  heartbeatMaxDailyBudgetUsd: 0.5,
};

/** Settings page with API key inputs, channel toggles, security, budget, and voice controls */
export function Settings() {
  const config = useApi(useCallback(() => fetchConfig(), []));
  const [form, setForm] = useState<SettingsFormState>(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  // Populate form once config loads
  if (config.data && !initialized) {
    const cfg = config.data.config;
    setForm({
      openaiApiKey: typeof cfg.openaiApiKey === 'string' ? cfg.openaiApiKey : '',
      anthropicApiKey: typeof cfg.anthropicApiKey === 'string' ? cfg.anthropicApiKey : '',
      slackEnabled: cfg.slackEnabled === true,
      discordEnabled: cfg.discordEnabled === true,
      telegramEnabled: cfg.telegramEnabled === true,
      webEnabled: cfg.webEnabled !== false,
      securityLevel: typeof cfg.securityLevel === 'number' ? cfg.securityLevel : 3,
      monthlyBudgetUsd: typeof cfg.monthlyBudgetUsd === 'number' ? cfg.monthlyBudgetUsd : 10,
      dailyLimitUsd: typeof cfg.dailyLimitUsd === 'number' ? cfg.dailyLimitUsd : 2,
      agentName: typeof cfg.agentName === 'string' ? cfg.agentName : 'Lil Dude',
      agentPersona: typeof cfg.agentPersona === 'string' ? cfg.agentPersona : 'a chill, capable AI executive assistant',
      heartbeatEnabled: cfg.heartbeatEnabled !== false,
      heartbeatIntervalMinutes: typeof cfg.heartbeatIntervalMinutes === 'number' ? cfg.heartbeatIntervalMinutes : 30,
      heartbeatMaxDailyBudgetUsd: typeof cfg.heartbeatMaxDailyBudgetUsd === 'number' ? cfg.heartbeatMaxDailyBudgetUsd : 0.5,
    });
    setInitialized(true);
  }

  async function handleSave() {
    setSaving(true);
    setSaveMessage(null);
    try {
      await updateConfig(form as unknown as Record<string, unknown>);
      setSaveMessage('Settings saved successfully');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to save';
      setSaveMessage(message);
    } finally {
      setSaving(false);
    }
  }

  function maskKey(key: string): string {
    if (key.length <= 4) return key;
    return '\u2022'.repeat(key.length - 4) + key.slice(-4);
  }
  return (
    <div className="space-y-8 max-w-2xl">
      <h2 className="text-2xl font-bold text-white">Settings</h2>

      {config.loading && <p className="text-[#a0a0a0]">Loading configuration...</p>}
      {config.error && <p className="text-red-400">{config.error}</p>}

      {/* Agent Identity */}
      <section className="bg-[#111] rounded-xl p-6 border border-[#222] space-y-4">
        <h3 className="text-lg font-semibold text-white">Agent Identity</h3>
        <p className="text-xs text-[#666]">Give your assistant a name and personality.</p>

        <div>
          <label className="block text-sm text-[#ccc] mb-1">Agent Name</label>
          <input
            type="text"
            className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-white text-sm
                       placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
            placeholder="Lil Dude"
            value={form.agentName}
            onChange={(e) => setForm((prev) => ({ ...prev, agentName: e.target.value }))}
          />
        </div>

        <div>
          <label className="block text-sm text-[#ccc] mb-1">Persona</label>
          <input
            type="text"
            className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-white text-sm
                       placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
            placeholder="a chill, capable AI executive assistant"
            value={form.agentPersona}
            onChange={(e) => setForm((prev) => ({ ...prev, agentPersona: e.target.value }))}
          />
          <p className="text-xs text-[#666] mt-1">Injected into the system prompt as: &quot;You are [Name], [Persona] for [User].&quot;</p>
        </div>
      </section>

      {/* API Keys */}
      <section className="bg-[#111] rounded-xl p-6 border border-[#222] space-y-4">
        <h3 className="text-lg font-semibold text-white">API Keys</h3>

        <ApiKeyInput
          label="OpenAI API Key"
          value={form.openaiApiKey}
          maskedValue={maskKey(form.openaiApiKey)}
          onChange={(val) => setForm((prev) => ({ ...prev, openaiApiKey: val }))}
        />

        <ApiKeyInput
          label="Anthropic API Key"
          value={form.anthropicApiKey}
          maskedValue={maskKey(form.anthropicApiKey)}
          onChange={(val) => setForm((prev) => ({ ...prev, anthropicApiKey: val }))}
        />
      </section>

      {/* Channels */}
      <section className="bg-[#111] rounded-xl p-6 border border-[#222] space-y-4">
        <h3 className="text-lg font-semibold text-white">Channels</h3>

        <ToggleSwitch
          label="Slack"
          enabled={form.slackEnabled}
          onChange={(val) => setForm((prev) => ({ ...prev, slackEnabled: val }))}
        />
        <ToggleSwitch
          label="Discord"
          enabled={form.discordEnabled}
          onChange={(val) => setForm((prev) => ({ ...prev, discordEnabled: val }))}
        />
        <ToggleSwitch
          label="Telegram"
          enabled={form.telegramEnabled}
          onChange={(val) => setForm((prev) => ({ ...prev, telegramEnabled: val }))}
        />
        <ToggleSwitch
          label="Web Chat"
          enabled={form.webEnabled}
          onChange={(val) => setForm((prev) => ({ ...prev, webEnabled: val }))}
        />
        <p className="text-xs text-[#666]">
          Configure additional channels (Matrix, Teams, LINE, Google Chat, Signal, iMessage, WhatsApp) via{' '}
          <code className="text-blue-400">lildude onboard</code> or the config file.
        </p>
      </section>

      {/* Heartbeat */}
      <section className="bg-[#111] rounded-xl p-6 border border-[#222] space-y-4">
        <h3 className="text-lg font-semibold text-white">Heartbeat (Proactive Agent)</h3>
        <p className="text-xs text-[#666]">
          Periodically checks for actionable items based on your standing instructions in <code className="text-blue-400">~/.lil-dude/heartbeat.md</code>.
        </p>

        <ToggleSwitch
          label="Enabled"
          enabled={form.heartbeatEnabled}
          onChange={(val) => setForm((prev) => ({ ...prev, heartbeatEnabled: val }))}
        />

        <NumberInput
          label="Interval (minutes)"
          value={form.heartbeatIntervalMinutes}
          onChange={(val) => setForm((prev) => ({ ...prev, heartbeatIntervalMinutes: val }))}
          min={5}
          step={5}
        />

        <NumberInput
          label="Max Daily Budget (USD)"
          value={form.heartbeatMaxDailyBudgetUsd}
          onChange={(val) => setForm((prev) => ({ ...prev, heartbeatMaxDailyBudgetUsd: val }))}
          min={0}
          step={0.1}
        />
      </section>

      {/* Local Models */}
      <LocalModelsSettings />

      {/* Security */}
      <section className="bg-[#111] rounded-xl p-6 border border-[#222] space-y-4">
        <h3 className="text-lg font-semibold text-white">Security Level</h3>

        <div className="space-y-2">
          <input
            type="range"
            min={1}
            max={5}
            step={1}
            value={form.securityLevel}
            onChange={(e) =>
              setForm((prev) => ({
                ...prev,
                securityLevel: Number(e.target.value),
              }))
            }
            className="w-full accent-blue-500"
          />
          <div className="flex justify-between text-xs text-slate-500">
            <span>1</span>
            <span>2</span>
            <span>3</span>
            <span>4</span>
            <span>5</span>
          </div>
          <p className="text-sm text-blue-400">
            Level {form.securityLevel}: {SECURITY_LEVELS[form.securityLevel]}
          </p>
          <button
            type="button"
            className="px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-[#1a1a1a]
                       text-slate-900 text-sm font-medium rounded-lg transition-colors"
            disabled={saving}
            onClick={async () => {
              try {
                await updateSecurityLevel(form.securityLevel);
                setSaveMessage('Security level updated (applied immediately)');
              } catch (err: unknown) {
                const message = err instanceof Error ? err.message : 'Failed to update security level';
                setSaveMessage(message);
              }
            }}
          >
            Apply Security Level
          </button>
          <p className="text-xs text-[#666]">
            Changes take effect immediately — no restart required.
          </p>
        </div>
      </section>

      {/* Budget Controls */}
      <section className="bg-[#111] rounded-xl p-6 border border-[#222] space-y-4">
        <h3 className="text-lg font-semibold text-white">Budget Controls</h3>

        <NumberInput
          label="Monthly Budget (USD)"
          value={form.monthlyBudgetUsd}
          onChange={(val) => setForm((prev) => ({ ...prev, monthlyBudgetUsd: val }))}
          min={0}
          step={1}
        />

        <NumberInput
          label="Daily Limit (USD)"
          value={form.dailyLimitUsd}
          onChange={(val) => setForm((prev) => ({ ...prev, dailyLimitUsd: val }))}
          min={0}
          step={0.5}
        />
      </section>

      {/* Voice */}
      <VoiceSettings />

      {/* Save */}
      <div className="flex items-center gap-4">
        <button
          type="button"
          className="px-6 py-3 bg-blue-500 hover:bg-blue-600 disabled:bg-[#1a1a1a]
                     text-slate-900 font-semibold rounded-xl transition-colors"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
        {saveMessage && (
          <p
            className={`text-sm ${
              saveMessage.includes('success') || saveMessage.includes('updated')
                ? 'text-green-400'
                : 'text-red-400'
            }`}
          >
            {saveMessage}
          </p>
        )}
      </div>

      {/* Power User Mode */}
      {config.data?.config?.powerUserMode === true && <PowerUserPanel />}
    </div>
  );
}

/** Masked API key input with reveal toggle */
function ApiKeyInput({
  label,
  value,
  maskedValue,
  onChange,
}: {
  label: string;
  value: string;
  maskedValue: string;
  onChange: (value: string) => void;
}) {
  const [revealed, setRevealed] = useState(false);

  return (
    <div>
      <label className="block text-sm text-[#ccc] mb-1">{label}</label>
      <div className="flex gap-2">
        <input
          type={revealed ? 'text' : 'password'}
          className="flex-1 bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-white text-sm
                     placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
          placeholder="sk-..."
          value={revealed ? value : maskedValue}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setRevealed(true)}
          onBlur={() => setRevealed(false)}
        />
      </div>
    </div>
  );
}

/** Toggle switch component */
function ToggleSwitch({
  label,
  enabled,
  onChange,
}: {
  label: string;
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-[#ccc]">{label}</span>
      <button
        type="button"
        className={`relative w-11 h-6 rounded-full transition-colors ${
          enabled ? 'bg-blue-500' : 'bg-[#333]'
        }`}
        onClick={() => onChange(!enabled)}
        role="switch"
        aria-checked={enabled}
        aria-label={`Toggle ${label}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
            enabled ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
}

/** Number input with label */
function NumberInput({
  label,
  value,
  onChange,
  min,
  step,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  step: number;
}) {
  return (
    <div>
      <label className="block text-sm text-[#ccc] mb-1">{label}</label>
      <input
        type="number"
        className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-white text-sm
                   focus:outline-none focus:ring-2 focus:ring-blue-500/50"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        min={min}
        step={step}
      />
    </div>
  );
}
