export interface Feature {
  title: string
  description: string
  icon: string
}

export const features: Feature[] = [
  {
    title: 'Smart Routing',
    description: 'Routes every message to the most efficient model that can handle it. Simple questions go to small/fast models, complex tasks get the big guns.',
    icon: 'Zap',
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
    title: 'Skill System',
    description: 'Install community skills from GitHub with one command. Each skill runs sandboxed with declared permissions.',
    icon: 'Puzzle',
  },
  {
    title: 'Voice I/O',
    description: 'Transcribe audio with Groq Whisper, generate speech with ElevenLabs. Works as a layer on any channel.',
    icon: 'Mic',
  },
  {
    title: 'Daily Briefings',
    description: 'Scheduled tasks and morning summaries delivered to your preferred channel. Cron jobs with zero config.',
    icon: 'Sunrise',
  },
]
