import type {
  HealthStatus,
  BudgetInfo,
  TasksResponse,
  UsageResponse,
  SecurityLogResponse,
  AppConfig,
  DailyBriefing,
  RoutingHistoryResponse,
  QualityFeedbackResponse,
  OnboardingStatus,
  VerifyKeyResponse,
  OllamaStatus,
  OllamaModelsResponse,
  VoiceStatus,
} from './types.ts';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:18421';

/** Generic fetch wrapper with error handling */
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
    },
    ...options,
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => 'Unknown error');
    throw new Error(`API error ${response.status}: ${errorBody}`);
  }

  return response.json() as Promise<T>;
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

/** Fetch onboarding status and hardware info */
export function fetchOnboardingStatus(): Promise<OnboardingStatus> {
  return request<OnboardingStatus>('/api/v1/onboarding/status');
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
export function completeOnboarding(
  config: Record<string, unknown>,
): Promise<{ ok: boolean; restartRequired: boolean; message: string }> {
  return request('/api/v1/onboarding/complete', {
    method: 'POST',
    body: JSON.stringify({ config }),
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

// ── Voice APIs ─────────────────────────────────────────────────────

/** Fetch voice synthesis status */
export function fetchVoiceStatus(): Promise<VoiceStatus> {
  return request<VoiceStatus>('/api/v1/voice/status');
}

/** Synthesize speech from text — returns audio blob */
export async function synthesizeSpeech(text: string): Promise<Blob> {
  const response = await fetch(`${BASE_URL}/api/v1/voice/synthesize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => 'Unknown error');
    throw new Error(`Synthesis error ${response.status}: ${errorBody}`);
  }

  return response.blob();
}
