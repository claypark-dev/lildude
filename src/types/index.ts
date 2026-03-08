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

export type ChannelType = 'discord' | 'telegram' | 'imessage' | 'webchat' | 'cli' | 'slack' | 'whatsapp' | 'signal' | 'matrix' | 'teams' | 'line' | 'googlechat';

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

/**
 * Result returned from a wave's execute() method or a tool call.
 * Represents the outcome of a single action: whether it succeeded,
 * what to show the user, and optional structured metadata.
 */
export interface ToolResult {
  /** Whether the action completed successfully. */
  success: boolean;
  /** Human-readable output shown to the user. Keep concise and informative. */
  output: string;
  /** Error message for logging (not shown to user directly). */
  error?: string;
  /** Structured data for downstream use (e.g., message IDs, API response metadata). */
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

/**
 * A loaded wave instance with its manifest and lifecycle methods.
 * Waves are Lil Dude's plugin system — each encapsulates a specific capability
 * (web search, calendar, stock monitor, etc.).
 *
 * The executor calls the lifecycle methods in order:
 * 1. `plan()` — Extract parameters from natural language via regex (preferred) or LLM
 * 2. `execute()` — Perform the action using the extracted parameters
 * 3. `validate()` — (optional) Sanity-check the output before it reaches the user
 *
 * @see docs/building-skills.md for the developer guide
 */
export interface Wave {
  /** The wave's manifest declaring its capabilities, triggers, and permissions. */
  manifest: WaveManifest;

  /**
   * Extract parameters from the user's natural language input.
   * Use regex-based extraction in this method for zero-LLM-call performance.
   * If extractedParams contains useful values, the executor skips the LLM call entirely.
   *
   * @param userInput - The raw user message.
   * @param context - Additional context (injected deps, conversation state).
   * @returns A WavePlan with extractedParams populated.
   */
  plan(userInput: string, context: Record<string, unknown>): Promise<WavePlan>;

  /**
   * Execute the wave's action using parameters from the plan.
   * This is the "do the work" method — call APIs, query databases, etc.
   * Access injected dependencies via `plan.extractedParams._deps`.
   *
   * @param plan - The WavePlan with extractedParams and step descriptions.
   * @returns A ToolResult with success/failure and human-readable output.
   */
  execute(plan: WavePlan): Promise<ToolResult>;

  /**
   * Optional validation of the execution result.
   * Use this to catch stale data, API errors, or suspicious output
   * before it reaches the user.
   *
   * @param result - The ToolResult from execute().
   * @returns Whether the result is valid, with optional feedback if not.
   */
  validate?(result: ToolResult): Promise<{ valid: boolean; feedback?: string }>;
}

/**
 * Wave manifest — the declarative config file (wave.json) that describes
 * what a wave does, what it needs, and when it should activate.
 */
export interface WaveManifest {
  /** Unique kebab-case identifier (e.g., "stock-monitor", "web-search"). */
  name: string;
  /** Semver version string (e.g., "1.0.0"). */
  version: string;
  /** One-sentence description of what the wave does. */
  description: string;
  /** Author name or organization. */
  author: string;
  /** Permission declarations — what the wave needs access to. */
  permissions: {
    /** Network domains the wave may contact (e.g., ["api.example.com"]). */
    domains: string[];
    /** Shell commands the wave may execute (dangerous, rarely needed). */
    shell: string[];
    /** Filesystem paths the wave may access. */
    directories: string[];
    /** Whether the wave requires a headless browser. */
    requiresBrowser: boolean;
    /** OAuth providers the wave needs (e.g., ["google"]). */
    requiresOAuth: string[];
  };
  /** Keywords that activate the wave when they appear in user messages. */
  triggers: string[];
  /** If true, the wave uses at most 1 LLM call (param extraction). If false, full planning path. */
  deterministic: boolean;
  /** Tool definitions describing the wave's capabilities and their parameters. */
  tools: Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }>;
  /** Minimum subscription tier required: "basic", "standard", "power". */
  minTier: 'basic' | 'standard' | 'power';
  /** Path to the JavaScript entry file (usually "index.js"). */
  entryPoint: string;
  /** Safety tier controlling what security/model combinations can run this wave. */
  safetyTier?: WaveSafetyTier;
  /** Whether this is a personal wave (owner only) or party wave (external contacts). */
  waveCategory?: WaveCategory;
  /** Skills Hub category for browsing (e.g., "communication", "productivity", "finance"). */
  category?: string;
}

/**
 * The execution plan produced by a wave's plan() method.
 * Contains the extracted parameters and a description of what steps will run.
 */
export interface WavePlan {
  /** Ordered list of steps the wave will execute. */
  steps: WaveStep[];
  /** Estimated cost in USD for executing this plan. 0 for deterministic waves. */
  estimatedCostUsd: number;
  /** Whether the plan can be executed without additional LLM calls. */
  isDeterministic: boolean;
  /**
   * Parameters extracted from the user's message.
   * The `_deps` key is injected by the executor with { db, getAccessToken }.
   */
  extractedParams: Record<string, unknown>;
}

/**
 * A single step in a wave's execution plan.
 */
export interface WaveStep {
  /** The type of action this step performs. */
  type: 'api_call' | 'browser_action' | 'shell_command' | 'llm_call' | 'file_operation';
  /** Human-readable description of what this step does. */
  description: string;
  /** Parameters for this step. */
  params: Record<string, unknown>;
}

// === Wave Safety ===

/**
 * Safety tier classification for waves, ordered from least to most dangerous.
 * Interacts with the user's security level and model tier to produce allow/confirm/block decisions.
 * - observe: Read-only data retrieval (stock prices, weather)
 * - create: Creates new content (emails, calendar events)
 * - modify: Changes existing data (edit events, rename files)
 * - destroy: Deletes data permanently
 * - execute: Runs shell commands or arbitrary code
 */
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
