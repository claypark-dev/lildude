/** Shared type definitions for the Lil Dude web panel */

export interface HealthStatus {
  status: string;
  uptime: number;
  memoryMb: number;
  dbStatus: string;
}

export interface BudgetInfo {
  monthlyBudgetUsd: number;
  spentUsd: number;
  remainingUsd: number;
  percentUsed: number;
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

export interface DailyUsage {
  date: string;
  totalTokens: number;
  totalCostUsd: number;
}

export interface DailyUsageResponse {
  usage: DailyUsage[];
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

/** WebSocket message types sent by the client */
export type WsOutgoingMessage =
  | { type: 'subscribe'; channels: string[] }
  | { type: 'chat'; text: string };

/** WebSocket message types received from the server */
export type WsIncomingMessage =
  | { type: 'message'; text: string; role: 'assistant' }
  | { type: 'stream_chunk'; text: string }
  | { type: 'stream_end' }
  | { type: 'task_update'; task: Task };
