/**
 * Type definitions for Google Gemini REST API requests and responses.
 * Used by the Gemini provider to avoid importing @google/generative-ai.
 * See https://ai.google.dev/api/generate-content
 */

// === Request Types ===

/** A single part within Gemini content */
export interface GeminiPart {
  text?: string;
  functionCall?: {
    name: string;
    args: Record<string, unknown>;
  };
  functionResponse?: {
    name: string;
    response: Record<string, unknown>;
  };
}

/** A single content entry in the conversation */
export interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

/** A function declaration for tool use */
export interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/** Tool definitions wrapper */
export interface GeminiTool {
  functionDeclarations: GeminiFunctionDeclaration[];
}

/** Generation configuration parameters */
export interface GeminiGenerationConfig {
  maxOutputTokens?: number;
  temperature?: number;
  stopSequences?: string[];
}

/** Full request body for generateContent */
export interface GeminiGenerateContentRequest {
  contents: GeminiContent[];
  systemInstruction?: GeminiContent;
  tools?: GeminiTool[];
  generationConfig?: GeminiGenerationConfig;
}

// === Response Types ===

/** Token usage metadata from Gemini */
export interface GeminiUsageMetadata {
  promptTokenCount: number;
  candidatesTokenCount: number;
  totalTokenCount: number;
  cachedContentTokenCount?: number;
}

/** A candidate response from Gemini */
export interface GeminiCandidate {
  content: GeminiContent;
  finishReason: string;
  index: number;
}

/** Full response from generateContent */
export interface GeminiGenerateContentResponse {
  candidates: GeminiCandidate[];
  usageMetadata: GeminiUsageMetadata;
}

/** Error response structure from Gemini API */
export interface GeminiErrorResponse {
  error: {
    code: number;
    message: string;
    status: string;
  };
}

// === SSE Stream Types ===

/** A single SSE chunk from streamGenerateContent */
export interface GeminiStreamChunk {
  candidates?: Array<{
    content?: GeminiContent;
    finishReason?: string;
  }>;
  usageMetadata?: GeminiUsageMetadata;
}
