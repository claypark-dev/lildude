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

export type ChannelType = 'discord' | 'telegram' | 'imessage' | 'webchat' | 'cli';

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
export type TaskType = 'chat' | 'automation' | 'skill' | 'cron' | 'system';

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

// === Skills ===

export interface Skill {
  manifest: SkillManifest;
  plan(userInput: string, context: Record<string, unknown>): Promise<SkillPlan>;
  execute(plan: SkillPlan): Promise<ToolResult>;
  validate?(result: ToolResult): Promise<{ valid: boolean; feedback?: string }>;
}

export interface SkillManifest {
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
}

export interface SkillPlan {
  steps: SkillStep[];
  estimatedCostUsd: number;
  isDeterministic: boolean;
  extractedParams: Record<string, unknown>;
}

export interface SkillStep {
  type: 'api_call' | 'browser_action' | 'shell_command' | 'llm_call' | 'file_operation';
  description: string;
  params: Record<string, unknown>;
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
}

// === WebSocket Protocol ===

export interface WSMessage {
  type: string;
  payload: unknown;
  timestamp: string;
}

// === Health ===

export interface HealthData {
  uptime: number;
  memoryUsageMb: number;
  dbSizeBytes: number;
  activeTasks: number;
  version: string;
}
