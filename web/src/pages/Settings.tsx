import { useState, useCallback } from 'react';
import { useApi } from '../hooks/useApi.ts';
import { fetchConfig, updateConfig } from '../lib/api.ts';
import { PowerUserPanel } from './PowerUserPanel.tsx';

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
  webEnabled: boolean;
  securityLevel: number;
  monthlyBudgetUsd: number;
  dailyLimitUsd: number;
}

const DEFAULT_FORM: SettingsFormState = {
  openaiApiKey: '',
  anthropicApiKey: '',
  slackEnabled: false,
  discordEnabled: false,
  webEnabled: true,
  securityLevel: 3,
  monthlyBudgetUsd: 10,
  dailyLimitUsd: 2,
};

/** Settings page with API key inputs, channel toggles, security and budget controls */
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
      webEnabled: cfg.webEnabled !== false,
      securityLevel: typeof cfg.securityLevel === 'number' ? cfg.securityLevel : 3,
      monthlyBudgetUsd: typeof cfg.monthlyBudgetUsd === 'number' ? cfg.monthlyBudgetUsd : 10,
      dailyLimitUsd: typeof cfg.dailyLimitUsd === 'number' ? cfg.dailyLimitUsd : 2,
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
          label="Web Chat"
          enabled={form.webEnabled}
          onChange={(val) => setForm((prev) => ({ ...prev, webEnabled: val }))}
        />
      </section>

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
              saveMessage.includes('success') ? 'text-green-400' : 'text-red-400'
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
