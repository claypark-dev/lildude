export interface Channel {
  name: string
  description: string
  color: string
}

export const channels: Channel[] = [
  { name: 'Discord', description: 'Threads, embeds, button interactions', color: '#5865F2' },
  { name: 'Telegram', description: 'MarkdownV2, inline keyboards, rate limiting', color: '#26A5E4' },
  { name: 'iMessage', description: 'AppleScript bridge, zero-config on Mac', color: '#34C759' },
  { name: 'Slack', description: 'Socket Mode, threading, Block Kit', color: '#4A154B' },
  { name: 'WhatsApp', description: 'Phone-based auth, message splitting', color: '#25D366' },
  { name: 'Signal', description: 'Phone-based auth, group support', color: '#3A76F0' },
  { name: 'WebChat', description: 'WebSocket, ships with web panel', color: '#3b82f6' },
  { name: 'CLI', description: 'Direct terminal access', color: '#a0a0a0' },
]
