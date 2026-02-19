import type {
  HealthStatus,
  BudgetInfo,
  TasksResponse,
  DailyUsageResponse,
  SecurityLogResponse,
  AppConfig,
  DailyBriefing,
  RoutingHistoryResponse,
  QualityFeedbackResponse,
} from './types.ts';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

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

/** Fetch daily usage data */
export function fetchDailyUsage(): Promise<DailyUsageResponse> {
  return request<DailyUsageResponse>('/api/v1/usage/daily');
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
