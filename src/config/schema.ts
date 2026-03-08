/**
 * Configuration schema for Lil Dude.
 * Defines the full Zod schema with defaults for every setting.
 * See HLD Section 4 for config structure.
 */

import { z } from 'zod';

export const ConfigSchema = z.object({
  version: z.number().default(1),
  installTier: z.enum(['lite', 'standard', 'full']).default('standard'),
  user: z.object({
    name: z.string().default('Friend'),
    timezone: z.string().default('America/New_York'),
  }).default({}),
  agent: z.object({
    /** Display name for the assistant (shown in chat, briefings, and dashboard). */
    name: z.string().default('Lil Dude'),
    /** Short persona description injected into the system prompt. */
    persona: z.string().default('a chill, capable AI executive assistant'),
  }).default({}),
  providers: z.object({
    anthropic: z.object({
      apiKey: z.string().optional(),
      enabled: z.boolean().default(false),
    }).default({}),
    openai: z.object({
      apiKey: z.string().optional(),
      enabled: z.boolean().default(false),
    }).default({}),
    deepseek: z.object({
      apiKey: z.string().optional(),
      enabled: z.boolean().default(false),
      apiBase: z.string().default('https://api.deepseek.com'),
    }).default({}),
    gemini: z.object({
      apiKey: z.string().optional(),
      enabled: z.boolean().default(false),
    }).default({}),
    ollama: z.object({
      enabled: z.boolean().default(false),
      baseUrl: z.string().default('http://localhost:11434'),
      model: z.string().default('llama3.2'),
    }).default({}),
  }).default({}),
  channels: z.object({
    cli: z.object({
      enabled: z.boolean().default(false),
    }).default({}),
    discord: z.object({
      enabled: z.boolean().default(false),
      token: z.string().optional(),
      allowFrom: z.array(z.string()).default([]),
    }).default({}),
    telegram: z.object({
      enabled: z.boolean().default(false),
      token: z.string().optional(),
      allowFrom: z.array(z.string()).default([]),
    }).default({}),
    imessage: z.object({
      enabled: z.boolean().default(false),
    }).default({}),
    webchat: z.object({
      enabled: z.boolean().default(true),
    }).default({}),
    slack: z.object({
      enabled: z.boolean().default(false),
      token: z.string().optional(),
      appToken: z.string().optional(),
      allowFrom: z.array(z.string()).default([]),
    }).default({}),
    whatsapp: z.object({
      enabled: z.boolean().default(false),
      allowFrom: z.array(z.string()).default([]),
    }).default({}),
    signal: z.object({
      enabled: z.boolean().default(false),
      phoneNumber: z.string().optional(),
      allowFrom: z.array(z.string()).default([]),
    }).default({}),
    matrix: z.object({
      enabled: z.boolean().default(false),
      homeserverUrl: z.string().optional(),
      accessToken: z.string().optional(),
      allowFrom: z.array(z.string()).default([]),
    }).default({}),
    teams: z.object({
      enabled: z.boolean().default(false),
      appId: z.string().optional(),
      appPassword: z.string().optional(),
      allowFrom: z.array(z.string()).default([]),
    }).default({}),
    line: z.object({
      enabled: z.boolean().default(false),
      channelAccessToken: z.string().optional(),
      channelSecret: z.string().optional(),
      allowFrom: z.array(z.string()).default([]),
    }).default({}),
    googlechat: z.object({
      enabled: z.boolean().default(false),
      serviceAccountKey: z.string().optional(),
      allowFrom: z.array(z.string()).default([]),
    }).default({}),
  }).default({}),
  security: z.object({
    level: z.number().min(1).max(5).default(3),
    shellAllowlistOverride: z.array(z.string()).optional(),
    shellBlocklistOverride: z.array(z.string()).optional(),
    dirAllowlistOverride: z.array(z.string()).optional(),
    dirBlocklistOverride: z.array(z.string()).optional(),
    domainAllowlistOverride: z.array(z.string()).optional(),
    domainBlocklistOverride: z.array(z.string()).optional(),
  }).default({}),
  budget: z.object({
    monthlyLimitUsd: z.number().default(20),
    perTaskDefaultLimitUsd: z.number().default(0.50),
    warningThresholdPct: z.number().default(0.8),
    hardStopEnabled: z.boolean().default(true),
  }).default({}),
  gateway: z.object({
    wsPort: z.number().default(18420),
    httpPort: z.number().default(18421),
    host: z.string().default('127.0.0.1'),
    rateLimitPerMinute: z.number().min(1).default(100),
    wsMaxMessageBytes: z.number().min(1024).default(65536),
  }).default({}),
  preferences: z.object({
    defaultModel: z.string().optional(),
    enableModelRouting: z.boolean().default(true),
    briefingTime: z.string().default('08:00'),
    powerUserMode: z.boolean().default(false),
    enableQualityChecks: z.boolean().default(false),
  }).default({}),
  integrations: z.object({
    google: z.object({
      clientId: z.string().optional(),
      clientSecret: z.string().optional(),
    }).default({}),
    microsoft: z.object({
      clientId: z.string().optional(),
      clientSecret: z.string().optional(),
    }).default({}),
  }).default({}),
  heartbeat: z.object({
    enabled: z.boolean().default(true),
    intervalMinutes: z.number().min(5).max(1440).default(30),
    maxDailyBudgetUsd: z.number().min(0).default(0.50),
    model: z.string().optional(),
  }).default({}),
  mcp: z.object({
    enabled: z.boolean().default(false),
    autoConnectOnStartup: z.boolean().default(true),
    servers: z.array(z.object({
      name: z.string(),
      transport: z.enum(['stdio', 'sse']).default('stdio'),
      command: z.string().optional(),
      args: z.array(z.string()).optional(),
      url: z.string().optional(),
      env: z.record(z.string()).optional(),
    })).default([]),
  }).default({}),
  voice: z.object({
    enabled: z.boolean().default(false),
    transcription: z.object({
      backend: z.enum(['groq', 'local']).default('groq'),
      groqApiKey: z.string().optional(),
      language: z.string().default('en'),
    }).default({}),
    synthesis: z.object({
      enabled: z.boolean().default(false),
      backend: z.enum(['say', 'kokoro', 'elevenlabs']).default('say'),
      elevenLabsApiKey: z.string().optional(),
      voiceId: z.string().default('pNInz6obpgDQGcFmaJgB'),
      /** OS voice name for say.js backend (e.g., 'Samantha', 'Daniel'). */
      sayVoice: z.string().optional(),
      /** Speaking rate for say.js backend (0.5 = slow, 1.0 = normal, 2.0 = fast). */
      sayRate: z.number().min(0.1).max(3.0).default(1.0),
      /** Kokoro model ID (e.g., 'kokoro-en-v0_19'). */
      kokoroModelId: z.string().default('kokoro-en-v0_19'),
      /** Kokoro speaker voice. */
      kokoroSpeaker: z.string().default('af_heart'),
      /** Auto-speak all assistant responses (not just voice-initiated). */
      autoSpeak: z.boolean().default(false),
    }).default({}),
  }).default({}),
});

/** Fully-resolved configuration type inferred from the Zod schema */
export type Config = z.infer<typeof ConfigSchema>;
