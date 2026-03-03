/**
 * Cloud provider configuration section of the onboarding wizard.
 * Renders API key inputs and verification for each cloud AI provider.
 */

import type { CloudProvidersProps, ProviderName } from './types.ts';

const PROVIDER_LABELS: Record<ProviderName, string> = {
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI (GPT)',
  deepseek: 'DeepSeek',
  gemini: 'Google Gemini',
};

/** Cloud AI provider API key configuration section */
export function CloudProviders({
  providers,
  onUpdateProvider,
  onVerifyKey,
}: CloudProvidersProps) {
  return (
    <section className="mb-8 bg-[#111] border border-[#222] rounded-xl p-6">
      <h2 className="text-xl font-semibold text-white mb-1">Cloud Models</h2>
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
                    onUpdateProvider(name, { enabled: e.target.checked })
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
                      onUpdateProvider(name, {
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
                    onClick={() => onVerifyKey(name)}
                    disabled={provider.verifying || !provider.apiKey.trim()}
                    className="px-3 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-[#1a1a1a] disabled:text-slate-500
                               text-slate-900 text-sm font-medium rounded-lg transition-colors"
                  >
                    {provider.verifying ? '...' : 'Verify'}
                  </button>
                  {provider.verified === true && (
                    <span className="text-green-400 text-sm">{'\u2713'}</span>
                  )}
                  {provider.verified === false && (
                    <span className="text-red-400 text-xs">{provider.error ?? '\u2717'}</span>
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
  );
}
