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
    title: 'Local Model Safeguards',
    description: 'Tool input validation, malformed JSON repair, and auto-escalation. Two consecutive failures upgrade to a better model. Every model is safe by design.',
    icon: 'HardDrive',
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
    title: 'Security Sandbox',
    description: '5-level permission system intersected with wave safety tiers and model capabilities. Commands are parsed, not string-matched. Prompt injection detected and blocked.',
    icon: 'Lock',
  },
  {
    title: 'Wave Hub',
    description: 'Curated community wave registry with AST-level security scanning, permission auditing, and manual review. More secure than "anyone can upload" registries.',
    icon: 'Puzzle',
  },
  {
    title: 'Web Onboarding',
    description: 'No terminal needed. Start the app and set everything up through a web wizard. Pick providers, download models, configure settings — all in your browser.',
    icon: 'Globe',
  },
]
