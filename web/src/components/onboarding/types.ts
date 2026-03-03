/**
 * Shared types for the onboarding wizard sub-components.
 * Keeps interfaces in one place to avoid circular imports.
 */

import type { HardwareProfile, OllamaModelInfo, OllamaStatus } from '../../lib/types.ts';
import type { ModelEntry } from '../../lib/model-catalog.ts';

// ── Provider Types ──────────────────────────────────────────────────

export interface ProviderState {
  enabled: boolean;
  apiKey: string;
  verified: boolean | null;
  verifying: boolean;
  error?: string;
}

export type ProviderName = 'anthropic' | 'openai' | 'deepseek' | 'gemini';

// ── Channel Types ───────────────────────────────────────────────────

export interface TelegramChannelState {
  enabled: boolean;
  token: string;
}

export interface DiscordChannelState {
  enabled: boolean;
  token: string;
}

export interface IMessageChannelState {
  enabled: boolean;
}

export interface ChannelSetupState {
  telegram: TelegramChannelState;
  discord: DiscordChannelState;
  imessage: IMessageChannelState;
}

// ── Component Props ─────────────────────────────────────────────────

export interface CloudProvidersProps {
  providers: Record<ProviderName, ProviderState>;
  onUpdateProvider: (name: ProviderName, update: Partial<ProviderState>) => void;
  onVerifyKey: (name: ProviderName) => void;
}

export interface LocalModelsProps {
  hardware: HardwareProfile | null;
  ollamaStatus: OllamaStatus;
  ollamaModels: OllamaModelInfo[];
  ollamaChecking: boolean;
  pullingModel: string | null;
  waitingForInstall: boolean;
  selectedModel: string | null;
  onCheckOllama: () => void;
  onPullModel: (model: ModelEntry) => void;
  onSetWaitingForInstall: (waiting: boolean) => void;
  onSelectModel: (modelName: string) => void;
}

export interface BasicsFormProps {
  userName: string;
  securityLevel: number;
  monthlyBudget: number;
  onUserNameChange: (name: string) => void;
  onSecurityLevelChange: (level: number) => void;
  onMonthlyBudgetChange: (budget: number) => void;
}

export interface ResetBannerProps {
  confirmingReset: boolean;
  resetting: boolean;
  resetError: string | null;
  onStartReset: () => void;
  onConfirmReset: () => void;
  onCancelReset: () => void;
}

export interface CompletionScreenProps {
  /** Called after restart is triggered (optional side-effect hook). */
  onRestartTriggered?: () => void;
}

export interface ChannelSetupProps {
  hardware: HardwareProfile | null;
  channels: ChannelSetupState;
  onChannelChange: <K extends keyof ChannelSetupState>(
    channel: K,
    update: Partial<ChannelSetupState[K]>,
  ) => void;
}
