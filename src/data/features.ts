export interface Feature {
  title: string
  description: string
  icon: string
}

export const features: Feature[] = [
  {
    title: 'Self-Learning',
    description: 'Learns your preferences, communication style, and routines from every conversation. Your assistant gets smarter and more personalized over time.',
    icon: 'Brain',
  },
  {
    title: 'Wave Safety Tiers',
    description: 'Every action is classified: observe, create, modify, destroy, or execute. Read-only tasks always work. Destructive actions always confirm. Your local model stays safe.',
    icon: 'Shield',
  },
  {
    title: 'Shorebreak',
    description: "Can't check your email? Lil Dude builds the capability itself. Template-based generation with AST security scanning and user approval before activation.",
    icon: 'Waves',
  },
  {
    title: 'Contact Trust Levels',
    description: 'Every sender is resolved to a contact with trust levels: owner, trusted, known, or unknown. Each level gates what waves they can trigger, with per-contact rate limits and budget caps.',
    icon: 'Users',
  },
  {
    title: 'External User Waves',
    description: 'Friends check your availability, request meetings, and leave messages — all without needing you present. Privacy-first: time slots only, never event details.',
    icon: 'UserCheck',
  },
  {
    title: 'Smart Routing',
    description: 'Routes every message to the most efficient model. Simple questions hit small/fast models, complex tasks get the big guns. Quality feedback improves routing over time.',
    icon: 'Zap',
  },
  {
    title: '8 Channels',
    description: 'Discord, Telegram, Slack, iMessage, WhatsApp, Signal, WebChat, and CLI. Talk to your assistant wherever you already hang out.',
    icon: 'MessageSquare',
  },
  {
    title: '20+ Community Waves',
    description: 'Pre-built, verified capabilities: weather, todos, timezones, currency, expenses, and more. HMAC-SHA256 signed manifests with verified badges. One-click install and auto-updates.',
    icon: 'Package',
  },
  {
    title: 'Injection Hardening',
    description: '30+ threat patterns blocked. Output filtering catches leaked secrets. Canary tokens detect context leakage. Abuse detection auto-blocks after 3 injection attempts.',
    icon: 'ShieldAlert',
  },
  {
    title: 'Gateway Security',
    description: 'Bearer token auth on every endpoint. Token-bucket rate limiting. WebSocket auth with 5-second timeout. Per-contact rate limits and budget caps.',
    icon: 'KeyRound',
  },
  {
    title: 'Docker Ready',
    description: 'Multi-stage Alpine build with non-root user, health checks, and persistent data. docker compose up and you\'re running. Optional Ollama sidecar for local models.',
    icon: 'Container',
  },
  {
    title: 'Activity Dashboard',
    description: 'Per-contact activity metrics, contact groups, notification preferences, relayed messages, and pending meeting requests — all in the web panel.',
    icon: 'BarChart3',
  },
]
