export interface Feature {
  title: string
  description: string
  icon: string
}

export const features: Feature[] = [
  {
    title: 'Web Onboarding',
    description: 'No terminal needed. Start the app and set everything up through a web wizard. Pick providers, download models, configure settings — all in your browser.',
    icon: 'Globe',
  },
  {
    title: 'Smart Routing',
    description: 'Routes every message to the most efficient model that can handle it. Simple questions go to small/fast models, complex tasks get the big guns.',
    icon: 'Zap',
  },
  {
    title: 'Local Models',
    description: 'Run open-source models locally with Ollama. Pick from a curated catalog with hardware-aware recommendations. No API key required.',
    icon: 'HardDrive',
  },
  {
    title: '8 Channels',
    description: 'Discord, Telegram, Slack, iMessage, WhatsApp, Signal, WebChat, and CLI. Talk to your assistant wherever you already hang out.',
    icon: 'MessageSquare',
  },
  {
    title: 'Security Sandbox',
    description: '5-level permission system. Every shell command is parsed (not string-matched), every network request checked. Prompt injection detection built in.',
    icon: 'Shield',
  },
  {
    title: 'Voice I/O',
    description: 'Text-to-speech in the web chat. Play assistant responses as audio with one click. Supports ElevenLabs cloud and local backends.',
    icon: 'Mic',
  },
  {
    title: 'Skill System',
    description: 'Install community skills from GitHub with one command. Each skill runs sandboxed with declared permissions.',
    icon: 'Puzzle',
  },
  {
    title: 'Daily Briefings',
    description: 'Scheduled tasks and morning summaries delivered to your preferred channel. Cron jobs with zero config.',
    icon: 'Sunrise',
  },
  {
    title: 'Starts Lean',
    description: 'Everything is opt-in. Start with just one provider and add features as you need them. Your assistant grows with you.',
    icon: 'Layers',
  },
]
