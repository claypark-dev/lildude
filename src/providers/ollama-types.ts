/**
 * Type definitions for Ollama REST API requests and responses.
 * Used by the Ollama provider to type-check raw fetch interactions.
 * See https://github.com/ollama/ollama/blob/main/docs/api.md
 */

// === Request Types ===

/** A single message in the Ollama chat format */
export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: OllamaToolCall[];
}

/** A tool call returned by the model */
export interface OllamaToolCall {
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

/** Tool definition in Ollama's OpenAI-compatible format */
export interface OllamaTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: string;
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}

/** Request body for POST /api/chat */
export interface OllamaChatRequest {
  model: string;
  messages: OllamaMessage[];
  stream: boolean;
  tools?: OllamaTool[];
  options?: {
    temperature?: number;
    num_predict?: number;
    stop?: string[];
  };
}

// === Response Types ===

/** Full response from /api/chat (non-streaming, stream: false) */
export interface OllamaChatResponse {
  model: string;
  message: OllamaMessage;
  done: boolean;
  done_reason?: string;
  total_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
}

/** A single NDJSON chunk from /api/chat (streaming, stream: true) */
export interface OllamaStreamChunk {
  model: string;
  message: OllamaMessage;
  done: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

/** Error response structure from Ollama API */
export interface OllamaErrorResponse {
  error: string;
}
