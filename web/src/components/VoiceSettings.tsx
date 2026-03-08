/**
 * Voice settings panel.
 * Full voice configuration with backend selection, voice picker,
 * rate slider, and audio preview.
 */

import { useState, useEffect, useCallback } from 'react';
import { fetchVoiceConfig, updateVoiceConfig, previewVoice, type VoiceConfig, type VoicePreviewOverrides } from '../lib/api.ts';

/** Kokoro built-in voices for display when API unavailable. */
const KOKORO_VOICES = [
  { id: 'af_heart', name: 'Heart (Female)' },
  { id: 'af_bella', name: 'Bella (Female)' },
  { id: 'af_nicole', name: 'Nicole (Female)' },
  { id: 'af_sarah', name: 'Sarah (Female)' },
  { id: 'af_sky', name: 'Sky (Female)' },
  { id: 'am_adam', name: 'Adam (Male)' },
  { id: 'am_michael', name: 'Michael (Male)' },
  { id: 'bf_emma', name: 'Emma (British Female)' },
  { id: 'bm_george', name: 'George (British Male)' },
];

export function VoiceSettings() {
  const [config, setConfig] = useState<VoiceConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const [previewText, setPreviewText] = useState('Hello! This is a voice preview.');

  // Local form state
  const [enabled, setEnabled] = useState(false);
  const [synthEnabled, setSynthEnabled] = useState(false);
  const [backend, setBackend] = useState<'say' | 'kokoro' | 'elevenlabs'>('say');
  const [sayVoice, setSayVoice] = useState('');
  const [sayRate, setSayRate] = useState(1.0);
  const [kokoroSpeaker, setKokoroSpeaker] = useState('af_heart');
  const [elevenLabsApiKey, setElevenLabsApiKey] = useState('');
  const [voiceId, setVoiceId] = useState('');
  const [autoSpeak, setAutoSpeak] = useState(false);

  const loadConfig = useCallback(async () => {
    try {
      const data = await fetchVoiceConfig();
      setConfig(data);
      setEnabled(data.enabled);
      setSynthEnabled(data.synthesis.enabled);
      setBackend(data.synthesis.backend);
      setSayVoice(data.synthesis.sayVoice ?? '');
      setSayRate(data.synthesis.sayRate);
      setKokoroSpeaker(data.synthesis.kokoroSpeaker);
      setVoiceId(data.synthesis.voiceId);
      setAutoSpeak(data.synthesis.autoSpeak);
    } catch {
      setMessage({ text: 'Failed to load voice configuration', isError: true });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    try {
      await updateVoiceConfig({
        enabled,
        synthesis: {
          enabled: synthEnabled,
          backend,
          sayVoice: sayVoice || undefined,
          sayRate,
          kokoroSpeaker,
          voiceId,
          elevenLabsApiKey: elevenLabsApiKey || undefined,
          autoSpeak,
        },
      });
      setMessage({ text: 'Voice settings saved (applied immediately)', isError: false });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      setMessage({ text: msg, isError: true });
    } finally {
      setSaving(false);
    }
  }

  async function handlePreview() {
    if (!previewText.trim()) return;
    setPreviewing(true);
    setMessage(null);
    try {
      // Send the current (unsaved) form selections so the preview
      // reflects exactly what the user has picked in the dropdowns.
      const overrides: VoicePreviewOverrides = {
        backend,
        sayVoice: sayVoice || undefined,
        sayRate,
        kokoroSpeaker,
        voiceId: voiceId || undefined,
      };
      const blob = await previewVoice(previewText.trim(), overrides);
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      await audio.play();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Preview failed';
      setMessage({ text: msg, isError: true });
    } finally {
      setPreviewing(false);
    }
  }

  if (loading) {
    return <p className="text-[#a0a0a0] text-sm">Loading voice settings...</p>;
  }

  // Voice list for the selected backend
  const voiceOptions = backend === 'kokoro'
    ? KOKORO_VOICES
    : (config?.availableVoices ?? []).map(v => ({ id: v.id, name: v.name }));

  return (
    <section className="bg-[#111] rounded-xl p-6 border border-[#222] space-y-5">
      <h3 className="text-lg font-semibold text-white">Voice</h3>

      {message && (
        <p className={`text-sm px-3 py-2 rounded-lg ${
          message.isError
            ? 'text-red-400 bg-red-500/10 border border-red-500/20'
            : 'text-green-400 bg-green-500/10 border border-green-500/20'
        }`}>
          {message.text}
        </p>
      )}

      {/* Master toggle */}
      <ToggleRow label="Enable Voice Features" checked={enabled} onChange={setEnabled} />

      {enabled && (
        <>
          <ToggleRow label="Enable Text-to-Speech" checked={synthEnabled} onChange={setSynthEnabled} />

          {synthEnabled && (
            <>
              {/* Backend selector */}
              <div>
                <label className="block text-sm text-[#ccc] mb-1">TTS Backend</label>
                <select
                  className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-white text-sm
                             focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  value={backend}
                  onChange={(e) => setBackend(e.target.value as 'say' | 'kokoro' | 'elevenlabs')}
                >
                  <option value="say">OS Native (say/espeak)</option>
                  <option value="kokoro">Kokoro Neural (Local)</option>
                  <option value="elevenlabs">ElevenLabs (Cloud)</option>
                </select>
              </div>

              {/* Backend-specific settings */}
              {backend === 'say' && (
                <>
                  <div>
                    <label className="block text-sm text-[#ccc] mb-1">Voice</label>
                    {voiceOptions.length > 0 ? (
                      <select
                        className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-white text-sm
                                   focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                        value={sayVoice}
                        onChange={(e) => setSayVoice(e.target.value)}
                      >
                        <option value="">Default</option>
                        {voiceOptions.map((v) => (
                          <option key={v.id} value={v.id}>{v.name}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-white text-sm
                                   placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                        placeholder="e.g., Samantha, Daniel"
                        value={sayVoice}
                        onChange={(e) => setSayVoice(e.target.value)}
                      />
                    )}
                  </div>
                  <div>
                    <label className="block text-sm text-[#ccc] mb-1">
                      Speaking Rate: {sayRate.toFixed(1)}x
                    </label>
                    <input
                      type="range"
                      min={0.5}
                      max={2.5}
                      step={0.1}
                      value={sayRate}
                      onChange={(e) => setSayRate(Number(e.target.value))}
                      className="w-full accent-blue-500"
                    />
                    <div className="flex justify-between text-xs text-[#666]">
                      <span>Slow</span>
                      <span>Normal</span>
                      <span>Fast</span>
                    </div>
                  </div>
                </>
              )}

              {backend === 'kokoro' && (
                <div>
                  <label className="block text-sm text-[#ccc] mb-1">Speaker</label>
                  <select
                    className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-white text-sm
                               focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                    value={kokoroSpeaker}
                    onChange={(e) => setKokoroSpeaker(e.target.value)}
                  >
                    {KOKORO_VOICES.map((v) => (
                      <option key={v.id} value={v.id}>{v.name}</option>
                    ))}
                  </select>
                  <p className="text-xs text-[#666] mt-1">
                    Local neural TTS — high quality, runs on your machine (~82 MB model).
                  </p>
                </div>
              )}

              {backend === 'elevenlabs' && (
                <>
                  <div>
                    <label className="block text-sm text-[#ccc] mb-1">ElevenLabs API Key</label>
                    <input
                      type="password"
                      className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-white text-sm
                                 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                      placeholder={config?.synthesis.hasElevenLabsApiKey ? 'Key configured (hidden)' : 'Enter API key...'}
                      value={elevenLabsApiKey}
                      onChange={(e) => setElevenLabsApiKey(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-[#ccc] mb-1">Voice ID</label>
                    <input
                      type="text"
                      className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-white text-sm
                                 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                      placeholder="Default: Adam"
                      value={voiceId}
                      onChange={(e) => setVoiceId(e.target.value)}
                    />
                  </div>
                </>
              )}

              {/* Auto-speak toggle */}
              <ToggleRow
                label="Auto-Speak Responses"
                checked={autoSpeak}
                onChange={setAutoSpeak}
              />
              <p className="text-xs text-[#666] -mt-3">
                Automatically read assistant replies aloud in the web chat.
              </p>

              {/* Preview */}
              <div className="bg-[#0a0a0a] rounded-lg p-4 border border-[#222] space-y-3">
                <label className="block text-sm text-[#ccc]">Preview</label>
                <input
                  type="text"
                  className="w-full bg-[#111] border border-[#333] rounded-lg px-3 py-2 text-white text-sm
                             placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  value={previewText}
                  onChange={(e) => setPreviewText(e.target.value)}
                  placeholder="Enter preview text..."
                />
                <button
                  type="button"
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-[#222] disabled:text-[#666]
                             text-white text-sm font-medium rounded-lg transition-colors"
                  onClick={handlePreview}
                  disabled={previewing || !previewText.trim()}
                >
                  {previewing ? 'Playing...' : 'Play Preview'}
                </button>
              </div>
            </>
          )}

          {/* Save */}
          <button
            type="button"
            className="px-5 py-2.5 bg-blue-500 hover:bg-blue-600 disabled:bg-[#1a1a1a]
                       text-slate-900 text-sm font-semibold rounded-lg transition-colors"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save Voice Settings'}
          </button>
          <p className="text-xs text-[#666]">
            Changes take effect immediately — no restart required.
          </p>
        </>
      )}
    </section>
  );
}

/** Simple toggle row helper. */
function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (val: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-[#ccc]">{label}</span>
      <button
        type="button"
        className={`relative w-11 h-6 rounded-full transition-colors ${
          checked ? 'bg-blue-500' : 'bg-[#333]'
        }`}
        onClick={() => onChange(!checked)}
        role="switch"
        aria-checked={checked}
        aria-label={`Toggle ${label}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </div>
  );
}
