/** Shared type definitions for the Lil Dude web panel */

export interface HealthStatus {
  uptime: number;
  memoryUsageMb: number;
  dbSizeBytes: number;
  activeTasks: number;
  version: string;
}

export interface BudgetInfo {
  monthlyLimitUsd: number;
  monthlySpentUsd: number;
  monthlyRemainingUsd: number;
  dailySpentUsd: number;
  warningThresholdPct: number;
  isApproachingLimit: boolean;
}

export interface Task {
  id: string;
  description: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  costUsd: number;
  createdAt: string;
  updatedAt: string;
}

export interface TasksResponse {
  tasks: Task[];
}

export interface Conversation {
  id: string;
  channel: string;
  messageCount: number;
  lastMessageAt: string;
}

export interface ConversationsResponse {
  conversations: Conversation[];
}

export interface AppConfig {
  config: Record<string, unknown>;
}

export interface UsageResponse {
  dailyCostUsd: number;
  monthlyCostUsd: number;
  date: string;
  month: string;
}

export interface SecurityLogEntry {
  id: string;
  action: string;
  level: string;
  timestamp: string;
  details: string;
}

export interface SecurityLogResponse {
  entries: SecurityLogEntry[];
}

export interface ChatMessage {
  id: string;
  text: string;
  role: 'user' | 'assistant';
  timestamp: number;
}

// ── Artifact Types ─────────────────────────────────────────────────

/** Supported artifact rendering types */
export type ArtifactType = 'html' | 'svg' | 'mermaid' | 'code' | 'table';

/** A rich content block extracted from a message */
export interface ArtifactBlock {
  type: 'artifact';
  artifactType: ArtifactType;
  content: string;
  title?: string;
  language?: string;
}

/** A plain text block within a parsed message */
export interface TextBlock {
  type: 'text';
  content: string;
}

/** A parsed message split into text and artifact blocks */
export interface ParsedMessage {
  blocks: Array<ArtifactBlock | TextBlock>;
  hasArtifacts: boolean;
}

/** A single item within a briefing section. */
export interface BriefingItem {
  label: string;
  value: string;
  status?: 'good' | 'warning' | 'info' | 'neutral';
}

/** A section in the daily briefing. */
export interface BriefingSection {
  title: string;
  icon: string;
  items: BriefingItem[];
}

/** Summary counts for the briefing header. */
export interface BriefingSummary {
  activeWaves: number;
  scheduledJobs: number;
  pendingTasks: number;
  todayCostUsd: number;
  monthlyCostUsd: number;
}

/** A Shorebreak wave proposal awaiting approval. */
export interface WaveProposal {
  id: string;
  name: string;
  description: string;
  safetyTier: string;
  sourceTemplate: string;
  sourceCode: string;
  manifest: Record<string, unknown>;
  scanResult: Record<string, unknown>;
  scanPassed: boolean;
  testPassed: boolean;
  createdAt: string;
}

/** Response for listing proposals. */
export interface ProposalsResponse {
  proposals: Array<{
    id: string;
    name: string;
    description: string;
    safety_tier: string;
    scan_passed: number;
    test_passed: number;
    created_at: string;
  }>;
  count: number;
}

/** Response for approve/reject actions. */
export interface ProposalActionResponse {
  message: string;
  proposalId: string;
}

/** Complete daily briefing response. */
export interface DailyBriefing {
  generatedAt: string;
  greeting: string;
  sections: BriefingSection[];
  summary: BriefingSummary;
}

/** A single routing history entry. */
export interface RoutingHistoryEntry {
  id: number;
  taskId: string;
  model: string;
  provider: string;
  tier: string;
  taskType: string;
  qualityScore: number | null;
  feedback: string | null;
  inputLength: number;
  outputTokens: number;
  costUsd: number;
  createdAt: string;
}

/** Response shape for the routing history endpoint. */
export interface RoutingHistoryResponse {
  entries: RoutingHistoryEntry[];
}

/** Response shape for the quality feedback endpoint. */
export interface QualityFeedbackResponse {
  updated: boolean;
}

/** WebSocket message types sent by the client */
export type WsOutgoingMessage =
  | { type: 'subscribe'; channels: string[] }
  | { type: 'chat'; text: string };

/** WebSocket message types received from the server */
export type WsIncomingMessage =
  | { type: 'message'; text: string; role: 'assistant' }
  | { type: 'stream_chunk'; text: string }
  | { type: 'stream_end' }
  | { type: 'history'; messages: Array<{ id: string; text: string; role: string; timestamp: number }> }
  | { type: 'task_update'; task: Task }
  | { type: 'ollama_pull_progress'; model: string; status: string; completed: number; total: number };

// ── Onboarding Types ───────────────────────────────────────────────

/** Hardware feature flags */
export interface HardwareFeatures {
  browserAutomation: boolean;
  localModels: boolean;
  voice: boolean;
}

/** Hardware profile returned by onboarding status */
export interface HardwareProfile {
  os: string;
  arch: string;
  ramGb: number;
  cpuCores: number;
  diskFreeGb: number;
  hasGpu: boolean;
  features: HardwareFeatures;
}

/** Onboarding status response */
export interface OnboardingStatus {
  onboarded: boolean;
  hardware: HardwareProfile;
  /** Fresh web-panel API key (returned when already onboarded but no auth header sent). */
  apiKey?: string;
}

/** Provider key verification response */
export interface VerifyKeyResponse {
  provider: string;
  valid: boolean;
  error?: string;
}

// ── Ollama Types ───────────────────────────────────────────────────

/** Ollama connection status */
export interface OllamaStatus {
  running: boolean;
  version?: string;
}

/** Individual Ollama model info */
export interface OllamaModelInfo {
  name: string;
  size: number;
  digest: string;
  modifiedAt: string;
}

/** Response from the Ollama models endpoint */
export interface OllamaModelsResponse {
  models: OllamaModelInfo[];
}

// ── Voice Types ────────────────────────────────────────────────────

/** Voice synthesis status */
export interface VoiceStatus {
  enabled: boolean;
  backend: string;
  hasApiKey: boolean;
}

// ── Dashboard Types ─────────────────────────────────────────────

/** Cron job info returned by the dashboard API. */
export interface DashboardCronJob {
  id: string;
  schedule: string;
  taskDescription: string;
  waveId: string | null;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  nextRunAt: string | null;
  enabled: boolean;
  expiresAt: string | null;
}

/** Consolidated dashboard data returned by GET /api/v1/dashboard. */
export interface DashboardData {
  health: {
    status: string;
    uptime: number;
    memoryMb: number;
    timestamp: string;
  };
  budget: {
    monthlyCostUsd: number;
    dailyCostUsd: number;
  };
  tasks: {
    active: number;
    recent24h: number;
    items: Array<{
      id: string;
      description: string;
      status: string;
      createdAt: string;
    }>;
  };
  cron: {
    jobs: DashboardCronJob[];
    count: number;
  };
}

/** Weather widget response from GET /api/v1/widgets/weather. */
export interface WeatherWidgetData {
  location: {
    name: string;
    country: string;
    region: string | null;
    latitude: number;
    longitude: number;
  };
  weather: {
    temperature: number;
    feelsLike: number;
    humidity: number;
    windSpeed: number;
    windDirection: number;
    weatherCode: number;
    isDay: boolean;
    precipitation: number;
  };
  fetchedAt: string;
}

/** Reminder item in the reminders widget response. */
export interface ReminderItem {
  id: string;
  text: string;
  schedule: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  expiresAt: string | null;
}

/** Reminders widget response from GET /api/v1/widgets/reminders. */
export interface RemindersWidgetData {
  reminders: ReminderItem[];
  count: number;
}
