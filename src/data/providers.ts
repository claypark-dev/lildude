export interface Provider {
  name: string
  models: string
  highlight?: string
}

export const providers: Provider[] = [
  { name: 'Anthropic', models: 'Claude Haiku \u00b7 Sonnet \u00b7 Opus' },
  { name: 'OpenAI', models: 'GPT-4o-mini \u00b7 GPT-4o \u00b7 GPT-4.1' },
  { name: 'Google', models: 'Gemini Flash \u00b7 Pro' },
  { name: 'DeepSeek', models: 'DeepSeek Chat' },
  { name: 'Ollama', models: 'LLaMA \u00b7 Qwen (local)', highlight: 'Free' },
]
