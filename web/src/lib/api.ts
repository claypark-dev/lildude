import type {
  HealthStatus,
  BudgetInfo,
  TasksResponse,
  UsageResponse,
  SecurityLogResponse,
  AppConfig,
  DailyBriefing,
  DashboardData,
  DashboardCronJob,
  WeatherWidgetData,
  RemindersWidgetData,
  RoutingHistoryResponse,
  QualityFeedbackResponse,
  OnboardingStatus,
  VerifyKeyResponse,
  OllamaStatus,
  OllamaModelsResponse,
  VoiceStatus,
  ProposalsResponse,
  WaveProposal,
  ProposalActionResponse,
} from './types.ts';

/** Use relative URLs when served from the same origin (avoids 127.0.0.1 vs localhost CORS mismatch). */
const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

/** localStorage key for the web panel API key. */
const API_KEY_STORAGE_KEY = 'lildude_api_key';

/**
 * Retrieve the stored API key from localStorage.
 * @returns The raw API key or null if not stored.
 */
export function getStoredApiKey(): string | null {
  return localStorage.getItem(API_KEY_STORAGE_KEY);
}

/**
 * Store an API key in localStorage for authenticated requests.
 * @param key - The raw API key.
 */
export function setStoredApiKey(key: string): void {
  localStorage.setItem(API_KEY_STORAGE_KEY, key);
}

/** Generic fetch wrapper with error handling, automatic auth, and 401 auto-retry. */
async function request<T>(path: string, options?: RequestInit, _retried = false): Promise<T> {
  const apiKey = getStoredApiKey();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string> | undefined),
  };

  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
  });

  // Auto-refresh API key on 401 and retry once
  if (response.status === 401 && !_retried) {
    const freshKey = await refreshApiKey();
    if (freshKey) {
      return request<T>(path, options, true);
    }
  }

  if (!response.ok) {
    const errorBody = await response.text().catch(() => 'Unknown error');
    throw new Error(`API error ${response.status}: ${errorBody}`);
  }

  return response.json() as Promise<T>;
}

/** Shared in-flight refresh promise to avoid multiple concurrent refresh calls. */
let _refreshPromise: Promise<string | null> | null = null;

/** Fetch a fresh API key from the onboarding status endpoint (no auth required). */
async function refreshApiKey(): Promise<string | null> {
  // Deduplicate: if a refresh is already in-flight, reuse it
  if (_refreshPromise) return _refreshPromise;

  _refreshPromise = (async () => {
    try {
      const resp = await fetch(`${BASE_URL}/api/v1/onboarding/status`);
      if (!resp.ok) return null;
      const data = await resp.json() as { apiKey?: string };
      if (data.apiKey) {
        setStoredApiKey(data.apiKey);
        return data.apiKey;
      }
      return null;
    } catch {
      return null;
    } finally {
      _refreshPromise = null;
    }
  })();

  return _refreshPromise;
}

/** Fetch system health status */
export function fetchHealth(): Promise<HealthStatus> {
  return request<HealthStatus>('/api/v1/health');
}

/** Fetch budget information */
export function fetchBudget(): Promise<BudgetInfo> {
  return request<BudgetInfo>('/api/v1/budget');
}

/** Fetch recent tasks */
export function fetchTasks(limit = 50): Promise<TasksResponse> {
  return request<TasksResponse>(`/api/v1/tasks?limit=${limit}`);
}

/** Fetch usage data */
export function fetchUsage(): Promise<UsageResponse> {
  return request<UsageResponse>('/api/v1/usage');
}

/** Fetch security log entries */
export function fetchSecurityLog(limit = 20): Promise<SecurityLogResponse> {
  return request<SecurityLogResponse>(`/api/v1/security/log?limit=${limit}`);
}

/** Update the runtime security level (hot-reload, no restart needed). */
export function updateSecurityLevel(
  level: number,
): Promise<{ ok: boolean; previousLevel: number; currentLevel: number }> {
  return request('/api/v1/security/level', {
    method: 'PUT',
    body: JSON.stringify({ level }),
  });
}

/** Fetch application config */
export function fetchConfig(): Promise<AppConfig> {
  return request<AppConfig>('/api/v1/config');
}

/** Update application config */
export function updateConfig(config: Record<string, unknown>): Promise<AppConfig> {
  return request<AppConfig>('/api/v1/config', {
    method: 'PUT',
    body: JSON.stringify(config),
  });
}

/** Fetch consolidated dashboard data (single API call for all widgets) */
export function fetchDashboard(): Promise<DashboardData> {
  return request<DashboardData>('/api/v1/dashboard');
}

/** Fetch cron jobs list */
export function fetchCronJobs(): Promise<{ jobs: DashboardCronJob[]; count: number }> {
  return request('/api/v1/cron');
}

/** Fetch weather widget data for a specific location */
export function fetchWeatherWidget(location: string): Promise<WeatherWidgetData> {
  return request<WeatherWidgetData>(`/api/v1/widgets/weather?location=${encodeURIComponent(location)}`);
}

/** Fetch reminders widget data */
export function fetchRemindersWidget(): Promise<RemindersWidgetData> {
  return request<RemindersWidgetData>('/api/v1/widgets/reminders');
}

/** Fetch the daily briefing */
export function fetchBriefing(): Promise<DailyBriefing> {
  return request<DailyBriefing>('/api/v1/briefing');
}

/** Fetch recent routing history entries */
export function fetchRoutingHistory(limit = 50): Promise<RoutingHistoryResponse> {
  return request<RoutingHistoryResponse>(`/api/v1/routing-history?limit=${limit}`);
}

/** Submit quality feedback for a routing decision */
export function submitQualityFeedback(
  taskId: string,
  score: number,
  feedback?: string,
): Promise<QualityFeedbackResponse> {
  return request<QualityFeedbackResponse>('/api/v1/routing-history/feedback', {
    method: 'POST',
    body: JSON.stringify({ taskId, score, feedback }),
  });
}

// ── Onboarding APIs ────────────────────────────────────────────────

/** Fetch onboarding status and hardware info.
 *  When the system is already onboarded but the browser has no stored key,
 *  the server returns a fresh web-panel API key which we auto-store.
 *
 *  @param forceNewKey - If true, skip sending the existing auth header so the
 *                       server always issues a fresh web-panel API key. Useful
 *                       when the stored key may be stale (e.g. after server restart).
 */
export async function fetchOnboardingStatus(forceNewKey = false): Promise<OnboardingStatus> {
  let status: OnboardingStatus;
  if (forceNewKey) {
    // Call without auth header so the server rotates the web-panel key
    const response = await fetch(`${BASE_URL}/api/v1/onboarding/status`);
    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'Unknown error');
      throw new Error(`API error ${response.status}: ${errorBody}`);
    }
    status = (await response.json()) as OnboardingStatus;
  } else {
    status = await request<OnboardingStatus>('/api/v1/onboarding/status');
  }
  if (status.apiKey) {
    setStoredApiKey(status.apiKey);
  }
  return status;
}

/** Verify a provider API key */
export function verifyProviderKey(
  provider: string,
  apiKey: string,
): Promise<VerifyKeyResponse> {
  return request<VerifyKeyResponse>('/api/v1/onboarding/verify-key', {
    method: 'POST',
    body: JSON.stringify({ provider, apiKey }),
  });
}

/** Complete onboarding by saving the config */
export async function completeOnboarding(
  config: Record<string, unknown>,
): Promise<{ ok: boolean; restartRequired: boolean; message: string; apiKey?: string }> {
  const result = await request<{ ok: boolean; restartRequired: boolean; message: string; apiKey?: string }>(
    '/api/v1/onboarding/complete',
    {
      method: 'POST',
      body: JSON.stringify({ config }),
    },
  );

  // Store the API key for future authenticated requests
  if (result.apiKey) {
    setStoredApiKey(result.apiKey);
  }

  return result;
}

/** Reset onboarding by deleting the existing config */
export function resetOnboarding(): Promise<{ ok: boolean; message: string }> {
  return request('/api/v1/onboarding/reset', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

/** Trigger a graceful server restart after onboarding completion */
export function triggerRestart(): Promise<{ ok: boolean; message: string }> {
  return request('/api/v1/onboarding/restart', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

// ── Ollama APIs ────────────────────────────────────────────────────

/** Fetch Ollama connection status */
export function fetchOllamaStatus(): Promise<OllamaStatus> {
  return request<OllamaStatus>('/api/v1/ollama/status');
}

/** Fetch installed Ollama models */
export function fetchOllamaModels(): Promise<OllamaModelsResponse> {
  return request<OllamaModelsResponse>('/api/v1/ollama/models');
}

/** Start pulling a model from Ollama registry */
export function pullOllamaModel(
  model: string,
): Promise<{ status: string; model: string }> {
  return request('/api/v1/ollama/pull', {
    method: 'POST',
    body: JSON.stringify({ model }),
  });
}

// ── Shorebreak APIs ───────────────────────────────────────────────

/** Fetch pending Shorebreak wave proposals */
export function fetchProposals(): Promise<ProposalsResponse> {
  return request<ProposalsResponse>('/api/v1/shorebreak/proposals');
}

/** Fetch a single Shorebreak proposal with full detail */
export function fetchProposalDetail(id: string): Promise<WaveProposal> {
  return request<WaveProposal>(`/api/v1/shorebreak/proposals/${encodeURIComponent(id)}`);
}

/** Approve a Shorebreak wave proposal */
export function approveProposal(id: string): Promise<ProposalActionResponse> {
  return request<ProposalActionResponse>(
    `/api/v1/shorebreak/proposals/${encodeURIComponent(id)}/approve`,
    { method: 'POST' },
  );
}

/** Reject a Shorebreak wave proposal */
export function rejectProposal(id: string): Promise<ProposalActionResponse> {
  return request<ProposalActionResponse>(
    `/api/v1/shorebreak/proposals/${encodeURIComponent(id)}/reject`,
    { method: 'POST' },
  );
}

// ── Voice APIs ─────────────────────────────────────────────────────

/** Fetch voice synthesis status */
export function fetchVoiceStatus(): Promise<VoiceStatus> {
  return request<VoiceStatus>('/api/v1/voice/status');
}

/** Synthesize speech from text — returns audio blob */
export async function synthesizeSpeech(text: string): Promise<Blob> {
  const apiKey = getStoredApiKey();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const response = await fetch(`${BASE_URL}/api/v1/voice/synthesize`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => 'Unknown error');
    throw new Error(`Synthesis error ${response.status}: ${errorBody}`);
  }

  return response.blob();
}

// ── Voice Config APIs ──────────────────────────────────────────────

/** Voice configuration response from the server. */
export interface VoiceConfig {
  enabled: boolean;
  synthesis: {
    enabled: boolean;
    backend: 'say' | 'kokoro' | 'elevenlabs';
    voiceId: string;
    sayVoice: string | null;
    sayRate: number;
    kokoroSpeaker: string;
    kokoroModelId: string;
    hasElevenLabsApiKey: boolean;
    autoSpeak: boolean;
  };
  transcription: {
    backend: 'groq' | 'local';
    language: string;
    hasGroqApiKey: boolean;
  };
  availableVoices: Array<{ id: string; name: string; language: string; gender?: string }>;
}

/** Fetch the full voice configuration with available voices. */
export function fetchVoiceConfig(): Promise<VoiceConfig> {
  return request<VoiceConfig>('/api/v1/voice/config');
}

/** Update voice configuration (hot-reload, persisted to disk). */
export function updateVoiceConfig(
  updates: Record<string, unknown>,
): Promise<{ ok: boolean; voice: { enabled: boolean; synthesis: { enabled: boolean; backend: string } } }> {
  return request('/api/v1/voice/config', {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
}

/** Optional voice overrides sent with preview to use unsaved form selections. */
export interface VoicePreviewOverrides {
  backend?: 'say' | 'kokoro' | 'elevenlabs';
  sayVoice?: string;
  sayRate?: number;
  kokoroSpeaker?: string;
  voiceId?: string;
}

/** Preview text-to-speech with the given voice overrides — returns audio blob. */
export async function previewVoice(text: string, overrides?: VoicePreviewOverrides): Promise<Blob> {
  const apiKey = getStoredApiKey();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const response = await fetch(`${BASE_URL}/api/v1/voice/preview`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ text, ...overrides }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => 'Unknown error');
    throw new Error(`Preview error ${response.status}: ${errorBody}`);
  }

  return response.blob();
}
