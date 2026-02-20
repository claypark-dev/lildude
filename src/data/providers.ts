export interface Provider {
  name: string
  models: string
  highlight?: string
  iconType: 'brand' | 'lucide'
  iconName: string
}

export const providers: Provider[] = [
  { name: 'Anthropic', models: 'Claude Haiku \u00b7 Sonnet \u00b7 Opus', iconType: 'brand', iconName: 'Anthropic' },
  { name: 'OpenAI', models: 'GPT-4o-mini \u00b7 GPT-4o \u00b7 GPT-4.1', iconType: 'brand', iconName: 'OpenAI' },
  { name: 'Google', models: 'Gemini Flash \u00b7 Pro', iconType: 'brand', iconName: 'Google' },
  { name: 'DeepSeek', models: 'DeepSeek Chat', iconType: 'lucide', iconName: 'Sparkles' },
  { name: 'Ollama', models: 'LLaMA \u00b7 Qwen (local)', highlight: 'Free', iconType: 'lucide', iconName: 'Cpu' },
]
