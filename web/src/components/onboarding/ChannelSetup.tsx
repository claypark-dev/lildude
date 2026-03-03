/**
 * Chat channel configuration section of the onboarding wizard.
 * Allows users to optionally configure Telegram, Discord, and iMessage.
 * Includes lightweight client-side token format validation.
 */

import type { ChannelSetupProps } from './types.ts';

/** Validate Telegram bot token format (numeric_id:alphanumeric_string) */
function isTelegramTokenFormatValid(token: string): boolean {
  return /^\d{8,15}:[A-Za-z0-9_-]{35,}$/.test(token.trim());
}

/** Validate Discord bot token format (three dot-separated base64 segments) */
function isDiscordTokenFormatValid(token: string): boolean {
  const parts = token.trim().split('.');
  return parts.length === 3 && parts.every((part) => part.length > 0);
}

/** Token format indicator shown next to token inputs */
function TokenFormatIndicator({ token, isValid }: { token: string; isValid: boolean }) {
  if (!token.trim()) return null;

  if (isValid) {
    return (
      <span className="text-green-400 text-xs">{'\u2713'} Format looks good</span>
    );
  }

  return (
    <span className="text-amber-400 text-xs">
      Token format looks unusual — will validate on startup
    </span>
  );
}

/** Optional chat channel setup for Telegram, Discord, and iMessage */
export function ChannelSetup({ hardware, channels, onChannelChange }: ChannelSetupProps) {
  const isMac = hardware?.os === 'darwin';

  return (
    <section className="mb-8 bg-[#111] border border-[#222] rounded-xl p-6">
      <h2 className="text-xl font-semibold text-white mb-1">Chat Channels</h2>
      <p className="text-sm text-[#a0a0a0] mb-4">
        Connect messaging platforms (optional). You can always add these later in Settings.
      </p>

      {/* Telegram */}
      <div className="mb-5">
        <label className="flex items-center gap-2 mb-2 cursor-pointer">
          <input
            type="checkbox"
            checked={channels.telegram.enabled}
            onChange={(e) => onChannelChange('telegram', { enabled: e.target.checked })}
            className="w-4 h-4 rounded border-[#333] bg-[#1a1a1a] text-blue-500 focus:ring-blue-500"
          />
          <span className="text-white text-sm font-medium">Telegram</span>
        </label>

        {channels.telegram.enabled && (
          <div className="ml-6 space-y-2">
            <div className="flex gap-2 items-center">
              <input
                type="password"
                placeholder="Bot token from @BotFather"
                value={channels.telegram.token}
                onChange={(e) => onChannelChange('telegram', { token: e.target.value })}
                className="flex-1 bg-[#0a0a0a] border border-[#333] rounded-lg px-3 py-2 text-white text-sm
                           placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <TokenFormatIndicator
              token={channels.telegram.token}
              isValid={isTelegramTokenFormatValid(channels.telegram.token)}
            />
            <p className="text-xs text-[#666]">
              Get a bot token from{' '}
              <a
                href="https://t.me/botfather"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:underline"
              >
                @BotFather
              </a>
              {' '}on Telegram. Create a new bot, then paste the token here.
            </p>
          </div>
        )}
      </div>

      {/* Discord */}
      <div className="mb-5">
        <label className="flex items-center gap-2 mb-2 cursor-pointer">
          <input
            type="checkbox"
            checked={channels.discord.enabled}
            onChange={(e) => onChannelChange('discord', { enabled: e.target.checked })}
            className="w-4 h-4 rounded border-[#333] bg-[#1a1a1a] text-blue-500 focus:ring-blue-500"
          />
          <span className="text-white text-sm font-medium">Discord</span>
        </label>

        {channels.discord.enabled && (
          <div className="ml-6 space-y-2">
            <div className="flex gap-2 items-center">
              <input
                type="password"
                placeholder="Bot token"
                value={channels.discord.token}
                onChange={(e) => onChannelChange('discord', { token: e.target.value })}
                className="flex-1 bg-[#0a0a0a] border border-[#333] rounded-lg px-3 py-2 text-white text-sm
                           placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <TokenFormatIndicator
              token={channels.discord.token}
              isValid={isDiscordTokenFormatValid(channels.discord.token)}
            />
            <p className="text-xs text-[#666]">
              Create a bot at the{' '}
              <a
                href="https://discord.com/developers/applications"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:underline"
              >
                Discord Developer Portal
              </a>
              . Enable the Message Content intent, add the bot to your server, then paste the token.
            </p>
          </div>
        )}
      </div>

      {/* iMessage (macOS only) */}
      {isMac && (
        <div>
          <label className="flex items-center gap-2 mb-2 cursor-pointer">
            <input
              type="checkbox"
              checked={channels.imessage.enabled}
              onChange={(e) => onChannelChange('imessage', { enabled: e.target.checked })}
              className="w-4 h-4 rounded border-[#333] bg-[#1a1a1a] text-blue-500 focus:ring-blue-500"
            />
            <span className="text-white text-sm font-medium">iMessage</span>
            <span className="px-1.5 py-0.5 bg-[#1a1a1a] text-[#666] text-xs rounded border border-[#333]">
              macOS
            </span>
          </label>
          {channels.imessage.enabled && (
            <p className="ml-6 text-xs text-[#666]">
              Reads from your Messages app. No token needed — uses macOS AppleScript integration.
              Your Mac may ask for permission to access Messages.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
