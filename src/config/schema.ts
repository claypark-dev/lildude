/**
 * Configuration schema for Lil Dude.
 * Defines the full Zod schema with defaults for every setting.
 * See HLD Section 4 for config structure.
 */

import { z } from 'zod';

export const ConfigSchema = z.object({
  version: z.number().default(1),
  user: z.object({
    name: z.string().default('Friend'),
    timezone: z.string().default('America/New_York'),
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
  }).default({}),
  preferences: z.object({
    defaultModel: z.string().optional(),
    enableModelRouting: z.boolean().default(true),
    briefingTime: z.string().default('08:00'),
    powerUserMode: z.boolean().default(false),
  }).default({}),
});

/** Fully-resolved configuration type inferred from the Zod schema */
export type Config = z.infer<typeof ConfigSchema>;
