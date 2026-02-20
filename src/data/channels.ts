export interface Channel {
  name: string
  description: string
  color: string
  iconType: 'brand' | 'lucide'
  iconName: string
}

export const channels: Channel[] = [
  { name: 'Discord', description: 'Threads, embeds, button interactions', color: '#5865F2', iconType: 'brand', iconName: 'Discord' },
  { name: 'Telegram', description: 'MarkdownV2, inline keyboards, rate limiting', color: '#26A5E4', iconType: 'brand', iconName: 'Telegram' },
  { name: 'iMessage', description: 'AppleScript bridge, zero-config on Mac', color: '#34C759', iconType: 'lucide', iconName: 'MessageCircle' },
  { name: 'Slack', description: 'Socket Mode, threading, Block Kit', color: '#4A154B', iconType: 'brand', iconName: 'Slack' },
  { name: 'WhatsApp', description: 'Phone-based auth, message splitting', color: '#25D366', iconType: 'brand', iconName: 'WhatsApp' },
  { name: 'Signal', description: 'Phone-based auth, group support', color: '#3A76F0', iconType: 'brand', iconName: 'Signal' },
  { name: 'WebChat', description: 'WebSocket, ships with web panel', color: '#3b82f6', iconType: 'lucide', iconName: 'Globe' },
  { name: 'CLI', description: 'Direct terminal access', color: '#a0a0a0', iconType: 'lucide', iconName: 'Terminal' },
]
