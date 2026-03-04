/**
 * Canonical interface definitions for Lil Dude.
 * All shared types live here and are imported throughout the project.
 * See HLD Section 10.
 */

// === Messages ===

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string | ContentBlock[];
}

export interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | 'image';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  toolUseId?: string;
  content?: string;
  isError?: boolean;
}

// === Channels ===

export type ChannelType = 'discord' | 'telegram' | 'imessage' | 'webchat' | 'cli' | 'slack' | 'whatsapp' | 'signal';

export interface ChannelMessage {
  id: string;
  channelType: ChannelType;
  channelId: string;
  userId: string;
  text: string;
  attachments: Attachment[];
  replyToMessageId?: string;
  timestamp: Date;
  raw?: unknown;
}

export interface Attachment {
  type: 'image' | 'file' | 'audio' | 'video';
  url?: string;
  data?: Buffer;
  mimeType: string;
  filename?: string;
  size?: number;
}

export interface ChannelConfig {
  enabled: boolean;
  token?: string;
  allowFrom?: string[];
  [key: string]: unknown;
}

export interface SendOptions {
  replyToMessageId?: string;
  buttons?: Array<{ label: string; id: string }>;
  silent?: boolean;
  parseMode?: 'markdown' | 'html' | 'plain';
  /** Optional audio attachment to send alongside or instead of text. */
  audioAttachment?: AudioAttachment;
}

/** Audio data to send through a channel. */
export interface AudioAttachment {
  /** Raw audio buffer. */
  data: Buffer;
  /** Audio format (wav, mp3, pcm). */
  format: 'wav' | 'mp3' | 'pcm';
  /** Duration in seconds (optional, for display). */
  durationSec?: number;
  /** MIME type (e.g., 'audio/wav'). */
  mimeType: string;
}

export interface ChannelAdapter {
  readonly name: string;
  readonly type: ChannelType;
  connect(config: ChannelConfig): Promise<void>;
  onMessage(handler: (msg: ChannelMessage) => Promise<void>): void;
  send(channelId: string, text: string, options?: SendOptions): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
}

// === Providers ===

export interface LLMProvider {
  readonly name: string;
  chat(messages: Message[], options: ChatOptions): Promise<ChatResponse>;
  chatStream(messages: Message[], options: ChatOptions): AsyncGenerator<StreamChunk>;
  countTokens(text: string): number;
}

export interface ChatOptions {
  model: string;
  maxTokens: number;
  temperature?: number;
  tools?: ToolDefinition[];
  systemPrompt?: string;
  stopSequences?: string[];
}

export interface ChatResponse {
  content: ContentBlock[];
  model: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';
}

export interface StreamChunk {
  type: 'text_delta' | 'tool_use_start' | 'tool_input_delta' | 'message_stop';
  text?: string;
  toolName?: string;
  toolInput?: string;
}

// === Tools ===

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

// === Tasks ===

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'killed' | 'awaiting_approval';
export type TaskType = 'chat' | 'automation' | 'wave' | 'cron' | 'system';

export interface Task {
  id: string;
  status: TaskStatus;
  type: TaskType;
  description?: string;
  channelType?: string;
  channelId?: string;
  userId?: string;
  tokenBudgetUsd?: number;
  tokensSpentUsd: number;
  modelUsed?: string;
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

// === Context ===

export interface ContextPayload {
  systemPrompt: string;
  messages: Message[];
  totalTokens: number;
  knowledgeIncluded: string[];
}

export interface KeyFact {
  key: string;
  value: string;
  category: string;
  source?: string;
  confidence: number;
}

// === Waves ===

export interface Wave {
  manifest: WaveManifest;
  plan(userInput: string, context: Record<string, unknown>): Promise<WavePlan>;
  execute(plan: WavePlan): Promise<ToolResult>;
  validate?(result: ToolResult): Promise<{ valid: boolean; feedback?: string }>;
}

export interface WaveManifest {
  name: string;
  version: string;
  description: string;
  author: string;
  permissions: {
    domains: string[];
    shell: string[];
    directories: string[];
    requiresBrowser: boolean;
    requiresOAuth: string[];
  };
  triggers: string[];
  deterministic: boolean;
  tools: Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }>;
  minTier: 'basic' | 'standard' | 'power';
  entryPoint: string;
  safetyTier?: WaveSafetyTier;
  waveCategory?: WaveCategory;
}

export interface WavePlan {
  steps: WaveStep[];
  estimatedCostUsd: number;
  isDeterministic: boolean;
  extractedParams: Record<string, unknown>;
}

export interface WaveStep {
  type: 'api_call' | 'browser_action' | 'shell_command' | 'llm_call' | 'file_operation';
  description: string;
  params: Record<string, unknown>;
}

// === Wave Safety ===

export type WaveSafetyTier = 'observe' | 'create' | 'modify' | 'destroy' | 'execute';

// === Wave Categories ===

/** Distinguishes personal waves (for owner) from party waves (for external users). */
export type WaveCategory = 'personal' | 'party';

// === User Profile ===

export interface UserProfileEntry {
  id: number;
  key: string;
  value: string;
  source: 'inferred' | 'explicit' | 'system';
  confidence: number;
  accessCount: number;
  createdAt: Date;
  updatedAt: Date;
}

// === User Feedback ===

export interface UserFeedback {
  id: number;
  taskId: string;
  conversationId?: string;
  rating: -1 | 1;
  comment?: string;
  model?: string;
  provider?: string;
  waveName?: string;
  createdAt: Date;
}

// === Generated Waves ===

export interface GeneratedWave {
  id: string;
  name: string;
  description: string;
  safetyTier: WaveSafetyTier;
  sourceTemplate?: string;
  sourceCode: string;
  manifest: string;
  scanResult?: string;
  scanPassed: boolean;
  userApproved: boolean;
  testPassed: boolean;
  usageCount: number;
  successCount: number;
  lastUsedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// === Failure Patterns ===

export interface FailurePattern {
  id: number;
  intent: string;
  toolName?: string;
  waveName?: string;
  errorType: string;
  errorMessage: string;
  model?: string;
  provider?: string;
  resolution?: string;
  occurrenceCount: number;
  lastOccurredAt: Date;
  createdAt: Date;
}

// === Model Routing ===

export type ModelTier = 'small' | 'medium' | 'large';

export interface ModelSelection {
  provider: string;
  model: string;
  tier: ModelTier;
  estimatedCostUsd: number;
  reasoning: string;
}

// === Security ===

export interface ParsedCommand {
  binary: string;
  args: string[];
  rawCommand: string;
  pipes: ParsedCommand[];
  hasRedirects: boolean;
  hasSudo: boolean;
}

export type SecurityDecision = 'allow' | 'deny' | 'needs_approval';

export interface SecurityCheckResult {
  decision: SecurityDecision;
  reason: string;
  riskLevel: RiskLevel;
}

export interface SanitizationResult {
  isClean: boolean;
  threats: Array<{
    type: string;
    description: string;
    severity: 'low' | 'medium' | 'high';
  }>;
  sanitizedInput: string;
}

// === Approval ===

export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired';
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface ApprovalRequest {
  id: string;
  taskId: string;
  actionType: string;
  actionDetail: string;
  description: string;
  riskLevel: RiskLevel;
  status: ApprovalStatus;
  channelType?: string;
  channelId?: string;
  requestedAt: Date;
  respondedAt?: Date;
  expiresAt: Date;
}

// === Cost ===

export interface CostEstimate {
  estimatedCostUsd: number;
  breakdown: {
    inputTokens: number;
    outputTokens: number;
    roundTrips: number;
    model: string;
  };
}

export interface TokenUsageRecord {
  id?: number;
  taskId: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  costUsd: number;
  roundTripNumber: number;
  createdAt?: Date;
}

// === Hardware ===

/**
 * Install tier determines which features are enabled.
 * - lite: Core agent, webchat, 2 channels, basic waves (4-8GB RAM)
 * - standard: Full agent, all channels, browser automation, all waves (16GB RAM)
 * - full: Everything + local models, voice, TTS (32GB+ RAM with GPU)
 */
export type InstallTier = 'lite' | 'standard' | 'full';

export interface HardwareProfile {
  os: string;
  arch: string;
  ramGb: number;
  cpuCores: number;
  diskFreeGb: number;
  hasGpu: boolean;
  features: {
    browserAutomation: boolean;
    localModels: boolean;
    voice: boolean;
  };
  /** The tier recommended based on detected hardware. */
  recommendedTier: InstallTier;
}

// === WebSocket Protocol ===

export interface WSMessage {
  type: string;
  payload: unknown;
  timestamp: string;
}

// === Contacts ===

export type TrustLevel = 'owner' | 'trusted' | 'known' | 'unknown';

export interface Contact {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  trustLevel: TrustLevel;
  isFavorite: boolean;
  notes: string | null;
  permittedWaves: string[];
  channelIds: Record<string, string>;
  rateLimitPerHour: number;
  budgetCapUsd: number;
  tags: string[];
  lastContactedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateContactInput {
  name: string;
  phone?: string;
  email?: string;
  trustLevel?: TrustLevel;
  isFavorite?: boolean;
  notes?: string;
  permittedWaves?: string[];
  channelIds?: Record<string, string>;
  rateLimitPerHour?: number;
  budgetCapUsd?: number;
  tags?: string[];
}

export interface UpdateContactInput {
  name?: string;
  phone?: string | null;
  email?: string | null;
  trustLevel?: TrustLevel;
  isFavorite?: boolean;
  notes?: string | null;
  permittedWaves?: string[];
  channelIds?: Record<string, string>;
  rateLimitPerHour?: number;
  budgetCapUsd?: number;
  tags?: string[];
}

// === Health ===

export interface HealthData {
  uptime: number;
  memoryUsageMb: number;
  dbSizeBytes: number;
  activeTasks: number;
  version: string;
}
