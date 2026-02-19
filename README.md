<p align="center">
<pre align="center">
  _     _ _   ____            _
 | |   (_) | |  _ \ _   _  __| | ___
 | |   | | | | | | | | | |/ _` |/ _ \
 | |___| | | | |_| | |_| | (_| |  __/
 |_____|_|_| |____/ \__,_|\__,_|\___|
</pre>
</p>

<p align="center">
  <strong>Your personal AI executive assistant</strong><br/>
  Self-hosted. Multi-channel. Privacy-first. Ruthlessly token-efficient.
</p>

<p align="center">
  <a href="#quick-start"><img src="https://img.shields.io/badge/Quick_Start-blue?style=for-the-badge" alt="Quick Start"/></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge" alt="MIT License"/></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/Node.js-20+-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="Node 20+"/></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-Strict-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript"/></a>
  <a href="#development"><img src="https://img.shields.io/badge/Tests-1,546_passing-brightgreen?style=for-the-badge" alt="Tests"/></a>
</p>

---

Lil Dude is a **free, open-source** AI executive assistant that runs on **your machine**, connects to **your messaging apps**, automates **your daily tasks**, and gives you a daily briefing — all while minimizing token usage, keeping your data private, and keeping your system safe behind a 5-level security sandbox.

<p align="center">
  <a href="#highlights">Highlights</a> |
  <a href="#quick-start">Quick Start</a> |
  <a href="#installation">Installation</a> |
  <a href="#how-it-works">Architecture</a> |
  <a href="#supported-providers">Providers</a> |
  <a href="#supported-channels">Channels</a> |
  <a href="#security-model">Security</a> |
  <a href="#configuration">Configuration</a> |
  <a href="#skills">Skills</a> |
  <a href="#voice">Voice</a> |
  <a href="#development">Development</a>
</p>

---

## Highlights

- **5 LLM Providers** — Anthropic, OpenAI, Google Gemini, DeepSeek, and Ollama (local). Smart routing picks the most efficient model that can handle the task.
- **8 Messaging Channels** — Discord, Telegram, iMessage, Slack, WhatsApp, Signal, WebChat, and CLI. Talk to your assistant from wherever you already are.
- **5-Level Security Sandbox** — Every shell command, network request, and file access is checked against a tiered permission system. Default: Level 3 (balanced).
- **Quality-Aware Model Routing** — Routes simple messages to cheap/fast models, complex ones to powerful models. Learns from quality feedback to improve over time.
- **Voice I/O** — Transcribe audio with Groq Whisper, generate speech with ElevenLabs TTS. Works as an augmentation layer on any channel.
- **Skill System** — Install community skills from GitHub with `lil-dude skill install github:user/repo`. Sandboxed execution with permission checks.
- **Daily Briefings & Cron** — Scheduled tasks and morning briefings delivered to your preferred channel.
- **Web Control Panel** — React-based dashboard for monitoring tasks, costs, conversations, and routing history.
- **Token Efficiency** — Smart model routing, per-task token limits, configurable budget guardrails, and Ollama as a free local fallback. Your API spend stays lean.
- **Startup Resume** — Rebooted your machine? Lil Dude detects stale tasks and missed cron jobs, then offers to catch up.
- **Concurrent Task Pool** — Run multiple tasks simultaneously with FIFO queuing and per-task abort via `AbortController`.
- **Local-First** — All data stays in a local SQLite database. No cloud telemetry. No account required.

---

## Quick Start

```bash
# Install
curl -fsSL https://raw.githubusercontent.com/claypark-dev/lildude/main/scripts/install.sh | bash

# Set up your assistant
lil-dude onboard

# Launch
lil-dude start
```

The onboarding wizard walks you through provider API keys, channel setup, security level, and token budget — no config files to edit manually.

---

## Installation

### One-Line Installer (macOS / Linux)

```bash
curl -fsSL https://raw.githubusercontent.com/claypark-dev/lildude/main/scripts/install.sh | bash
```

Checks for Node.js 20+, installs globally via npm, runs `lil-dude doctor` to verify your system.

### Windows (PowerShell)

```powershell
irm https://raw.githubusercontent.com/claypark-dev/lildude/main/scripts/install.ps1 | iex
```

### From Source

```bash
git clone https://github.com/claypark-dev/lildude.git
cd lildude
npm install
npm run build
npm run onboard
npm run start
```

### Requirements

| Requirement | Minimum | Recommended |
|-------------|---------|-------------|
| Node.js | 20.0.0 | 22+ |
| RAM | 4 GB | 16 GB (for local models + voice) |
| Disk | 500 MB | 2 GB (with Ollama models) |
| OS | macOS, Linux, Windows 10+ | macOS (Apple Silicon) |

---

## How It Works

```
  Discord ─┐
 Telegram ─┤
 iMessage ─┤                              ┌─ Anthropic (Claude)
    Slack ─┤     ┌──────────────────┐      ├─ OpenAI (GPT-4o)
 WhatsApp ─┼────▸│   Agent Loop      │─────▸├─ Google (Gemini)
   Signal ─┤     │                  │      ├─ DeepSeek
  WebChat ─┤     │  Sanitize        │      ├─ Ollama (local)
      CLI ─┘     │  ▸ Security Gate │      └─ Groq (voice)
                 │  ▸ Cost Gate     │
                 │  ▸ Route Model   │     ┌─ Shell (sandboxed)
                 │  ▸ Build Context │────▸├─ Browser
                 │  ▸ LLM Call      │     ├─ File I/O
                 │  ▸ Tool Loop     │     ├─ HTTP fetch
                 │  ▸ Track Cost    │     └─ Crypto, calendar...
                 └──────────────────┘
                         │
                    SQLite (local)
                  ~/.lil-dude/lil-dude.db
```

Every message flows through the same pipeline:

1. **Input Sanitization** — Prompt injection detection strips malicious content
2. **Security Gate** — Parsed command checking against the 5-level permission system
3. **Token Budget Gate** — Pre-flight budget check before any LLM call
4. **Model Routing** — Deterministic complexity classification routes to the most efficient capable model
5. **Context Building** — Conversation history, key facts, and knowledge injection
6. **LLM Call + Tool Loop** — Multi-round tool use with kill conditions (max rounds, max tokens, max duration, max cost)
7. **Token Tracking** — Every token is logged; per-task and monthly budgets enforced

---

## Supported Providers

| Provider | Models | Tier | Context Window | Cost (per 1K tokens) |
|----------|--------|------|---------------|---------------------|
| **Anthropic** | `claude-haiku-4-5-20251001` | Small | 200K | $0.001 in / $0.005 out |
| | `claude-sonnet-4-5-20250929` | Medium | 200K | $0.003 in / $0.015 out |
| | `claude-opus-4-6` | Large | 200K | $0.015 in / $0.075 out |
| **OpenAI** | `gpt-4o-mini` | Small | 128K | $0.00015 in / $0.0006 out |
| | `gpt-4o` | Medium | 128K | $0.0025 in / $0.01 out |
| | `gpt-4.1` | Medium | 1M | $0.002 in / $0.008 out |
| **Google Gemini** | `gemini-2.0-flash` | Small | 1M | $0.0001 in / $0.0004 out |
| | `gemini-2.0-pro` | Medium | 1M | $0.00125 in / $0.005 out |
| | `gemini-1.5-pro` | Medium | 2M | $0.00125 in / $0.005 out |
| **DeepSeek** | `deepseek-chat` | Small | 64K | $0.00014 in / $0.00028 out |
| **Ollama** | `llama3.2` | Small | 8K | Free (local) |
| | `qwen2.5` | Small | 32K | Free (local) |

Lil Dude is free and open-source. The costs above are third-party API pricing — what the LLM providers charge per token. Use Ollama for completely free local inference.

The model router classifies each message by complexity (word count, keywords, multi-step detection) and picks the most efficient model in the appropriate tier. Quality-aware routing learns from feedback to boost high-performing models and penalize low-quality ones.

---

## Supported Channels

| Channel | Type | Auth | Key Features |
|---------|------|------|-------------|
| **Discord** | Bot | Bot token | Threads, embeds, button interactions |
| **Telegram** | Bot | BotFather token | MarkdownV2, inline keyboards, rate limiting |
| **iMessage** | Native | macOS only | AppleScript bridge, zero-config on Mac |
| **Slack** | App | Bot + App token | Socket Mode (no public URL), threading, Block Kit buttons |
| **WhatsApp** | Bridge | Session auth | Phone-based allowFrom, 4K message splitting |
| **Signal** | Bridge | signal-cli | Phone-based allowFrom, group support |
| **WebChat** | Built-in | None | WebSocket, ships with web panel |
| **CLI** | Built-in | None | Direct terminal access |

All channels implement the same `ChannelAdapter` interface — they only normalize messages in and out. Zero business logic in adapters.

---

## Security Model

Lil Dude uses a **5-level security system** that controls what the AI can do on your machine:

| Level | Shell | Network | Files | Best For |
|-------|-------|---------|-------|----------|
| **1** | All blocked | All blocked | Read-only | Maximum lockdown |
| **2** | Allowlist only | Allowlist only | Approved paths | Cautious users |
| **3** (default) | Allowlist + approval | Allowlist + approval | Home directory | Balanced safety |
| **4** | Most allowed | Most allowed | Most allowed | Power users |
| **5** | Everything except blocklist | Everything | Everything | Full trust |

### Key Safety Features

- **Command Parsing** — Commands are parsed, not string-matched. No shell injection via clever quoting.
- **Prompt Injection Detection** — External content is wrapped with `wrapUntrustedContent()` and scanned.
- **Approval Queue** — Medium/high-risk actions pause and ask for your confirmation via the channel.
- **Security Logging** — Every security-relevant action is written to `security_log` in the database.
- **Cross-Platform** — Platform-aware dangerous patterns cover both Unix (`rm -rf`, `mkfs`) and Windows (`del /f /s`, `format`, `diskpart`, PowerShell destructive cmdlets). Directory rules protect system paths on all platforms.
- **Override Lists** — Customize with `shellAllowlistOverride`, `shellBlocklistOverride`, `dirAllowlistOverride`, `dirBlocklistOverride`, `domainAllowlistOverride`, `domainBlocklistOverride`.

```json
{
  "security": {
    "level": 3,
    "shellAllowlistOverride": ["ffmpeg", "convert"],
    "domainBlocklistOverride": ["example.com"]
  }
}
```

---

## Configuration

Config lives at `~/.lil-dude/config.json`. The onboarding wizard generates this for you, but here's the full structure:

```json5
{
  "version": 1,
  "user": {
    "name": "Your Name",
    "timezone": "America/New_York"
  },
  "providers": {
    "anthropic": { "apiKey": "sk-ant-...", "enabled": true },
    "openai":    { "apiKey": "sk-...",     "enabled": true },
    "gemini":    { "apiKey": "AI...",      "enabled": false },
    "deepseek":  { "apiKey": "sk-...",     "enabled": false, "apiBase": "https://api.deepseek.com" },
    "ollama":    { "enabled": false, "baseUrl": "http://localhost:11434", "model": "llama3.2" }
  },
  "channels": {
    "discord":  { "enabled": false, "token": "...", "allowFrom": ["user-id-1"] },
    "telegram": { "enabled": true,  "token": "...", "allowFrom": ["123456789"] },
    "imessage": { "enabled": false },
    "webchat":  { "enabled": true },
    "slack":    { "enabled": false, "token": "xoxb-...", "appToken": "xapp-...", "allowFrom": [] },
    "whatsapp": { "enabled": false, "allowFrom": ["+1234567890"] },
    "signal":   { "enabled": false, "phoneNumber": "+1234567890", "allowFrom": [] }
  },
  "security": {
    "level": 3
  },
  "budget": {
    "monthlyLimitUsd": 20,
    "perTaskDefaultLimitUsd": 0.50,
    "warningThresholdPct": 0.8,
    "hardStopEnabled": true
  },
  "gateway": {
    "httpPort": 18421,
    "wsPort": 18420,
    "host": "127.0.0.1"
  },
  "preferences": {
    "enableModelRouting": true,
    "briefingTime": "08:00",
    "powerUserMode": false,
    "enableQualityChecks": false
  },
  "voice": {
    "enabled": false,
    "transcription": { "backend": "groq", "language": "en" },
    "synthesis": { "enabled": false, "backend": "elevenlabs", "voiceId": "pNInz6obpgDQGcFmaJgB" }
  }
}
```

---

## Channel Setup

### Discord

1. Create a bot at [discord.com/developers](https://discord.com/developers/applications)
2. Enable **Message Content Intent**
3. Copy the bot token

```json
{ "channels": { "discord": { "enabled": true, "token": "YOUR_BOT_TOKEN", "allowFrom": ["your-user-id"] } } }
```

### Telegram

1. Message [@BotFather](https://t.me/BotFather) to create a bot
2. Copy the token

```json
{ "channels": { "telegram": { "enabled": true, "token": "YOUR_BOT_TOKEN", "allowFrom": ["your-telegram-id"] } } }
```

### Slack

1. Create a Slack app at [api.slack.com/apps](https://api.slack.com/apps)
2. Enable **Socket Mode** (no public URL needed)
3. Add bot scopes: `chat:write`, `app_mentions:read`, `im:history`
4. Install to workspace

```json
{ "channels": { "slack": { "enabled": true, "token": "xoxb-...", "appToken": "xapp-..." } } }
```

### iMessage (macOS only)

No token needed — uses AppleScript bridge.

```json
{ "channels": { "imessage": { "enabled": true } } }
```

### WhatsApp

Requires a WhatsApp Web bridge library (whatsapp-web.js or Baileys). QR code authentication.

```json
{ "channels": { "whatsapp": { "enabled": true, "allowFrom": ["+1234567890"] } } }
```

### Signal

Requires [signal-cli](https://github.com/AsamK/signal-cli) installed and registered.

```json
{ "channels": { "signal": { "enabled": true, "phoneNumber": "+1234567890", "allowFrom": ["+0987654321"] } } }
```

---

## Skills

### Built-in Skills

Lil Dude ships with bundled skills for common tasks — weather, reminders, web search, calculations, and more. These work out of the box with no configuration.

### Installing from GitHub

```bash
lil-dude skill install github:user/awesome-skill
lil-dude skill list
lil-dude skill search "weather"
lil-dude skill uninstall awesome-skill
```

Skills are sandboxed: their `skill.json` manifest declares required permissions (shell commands, directories, domains, browser access), and the security engine checks these against your security level before installation.

### Skill Manifest

```json
{
  "name": "my-skill",
  "version": "1.0.0",
  "description": "Does something useful",
  "author": "you",
  "triggers": ["do the thing", "make it happen"],
  "deterministic": true,
  "permissions": {
    "domains": ["api.example.com"],
    "shell": [],
    "directories": [],
    "requiresBrowser": false,
    "requiresOAuth": []
  }
}
```

---

## Voice

Voice is an optional augmentation layer that works on top of any channel.

| Feature | Cloud Provider | Local Option | Requirement |
|---------|---------------|-------------|-------------|
| **Transcription** | Groq (Whisper large-v3) | whisper.cpp (stub) | 16GB+ RAM |
| **Synthesis** | ElevenLabs (v1) | Local TTS (stub) | 16GB+ RAM + GPU |

### Enable Voice

```json
{
  "voice": {
    "enabled": true,
    "transcription": {
      "backend": "groq",
      "groqApiKey": "gsk_..."
    },
    "synthesis": {
      "enabled": true,
      "backend": "elevenlabs",
      "elevenLabsApiKey": "sk_..."
    }
  }
}
```

Audio attachments on any channel are automatically transcribed. If synthesis is enabled, responses can include generated audio.

---

## CLI Commands

| Command | Description |
|---------|-------------|
| `lil-dude start` | Start the assistant |
| `lil-dude onboard` | Run the setup wizard |
| `lil-dude doctor` | Check system health |
| `lil-dude skill install <source>` | Install a skill from GitHub |
| `lil-dude skill list` | List installed and bundled skills |
| `lil-dude skill uninstall <name>` | Remove an installed skill |
| `lil-dude skill search <query>` | Search the skill registry |
| `lil-dude --version` | Print version |

---

## Token Efficiency

Lil Dude is **free and open-source**. You only pay for LLM API tokens from third-party providers — and even that is optional with Ollama (local, $0). The token efficiency engine makes sure every token counts:

**Smart Model Routing** — Messages are classified by complexity and routed to the smallest model that can handle the job:
- Simple messages ("what time is it?") → Small tier (Haiku, GPT-4o-mini, Gemini Flash)
- Medium tasks → Medium tier (Sonnet, GPT-4o, Gemini Pro)
- Complex multi-step requests → Large tier (Opus)
- Ollama models → Always free, used as local fallback

**Budget Guardrails** — Configurable safety nets to prevent runaway API spend:

| Guardrail | Default | Description |
|-----------|---------|-------------|
| **Monthly limit** | $20.00 | Hard cap on total API spend per calendar month |
| **Per-task limit** | $0.50 | Max API spend for a single conversation/task |
| **Warning threshold** | 80% | Alert when approaching the monthly limit |
| **Hard stop** | Enabled | Refuse requests when limit is exhausted |

**Real-world API costs** (typical day with ~50 messages):

| Routing tier | Share | Daily API cost |
|--------------|-------|---------------|
| Small tier (80% of messages) | ~40 msgs | ~$0.02 |
| Medium tier (15% of messages) | ~8 msgs | ~$0.08 |
| Large tier (5% of messages) | ~2 msgs | ~$0.15 |
| **Total** | | **~$0.25/day (~$7.50/month)** |
| **With Ollama (local)** | | **$0/month** |

Every token is tracked in the database. View usage in the web panel at `http://127.0.0.1:18421`.

---

## Hardware Requirements

| Feature | RAM | GPU | Notes |
|---------|-----|-----|-------|
| Basic operation | 4 GB | No | Cloud providers only |
| Browser automation | 8 GB | No | Headless Chrome |
| Local models (Ollama) | 16 GB | No | Runs LLaMA, Qwen locally |
| Voice I/O | 16 GB | Yes | Transcription + synthesis |

Hardware is auto-detected at startup. Features are gated behind capability flags — you never get errors for missing hardware, just graceful fallbacks.

---

## Development

### Setup

```bash
git clone https://github.com/claypark-dev/lildude.git
cd lildude
npm install
```

### Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start with hot reload (tsx) |
| `npm run build` | Build with tsup (ESM + .d.ts) |
| `npm run start` | Run the built app |
| `npm test` | Run tests (Vitest, 1,546 passing) |
| `npm run test:watch` | Watch mode tests |
| `npm run typecheck` | TypeScript strict mode check |
| `npm run lint` | ESLint |
| `npm run web:dev` | Dev server for web panel |
| `npm run web:build` | Build web panel for production |

### Project Structure

```
src/
  index.ts              # App entry point (12-step startup)
  cli.ts                # CLI commands (commander)
  startup.ts            # Channel init, wiring helpers
  types/index.ts        # All canonical interfaces
  config/               # Zod schema, loader
  providers/            # LLM adapters (Anthropic, OpenAI, Gemini, Ollama)
  channels/             # Channel adapters (8 platforms)
  orchestrator/         # Agent loop, task pool, quality rater
  security/             # Permission engine, command parser, injection detection
  cost/                 # Pricing table, budget enforcement, token counting
  persistence/          # SQLite DAL (tasks, conversations, routing history)
  context/              # Knowledge management, summarization
  tools/                # Tool executor, sandbox
  skills/               # Skill loader, executor, hub (GitHub install)
  voice/                # Transcription (Groq), synthesis (ElevenLabs)
  gateway/              # Fastify HTTP + WebSocket server
  onboarding/           # Setup wizard
  utils/                # Logger (pino), hardware detection, shutdown
  errors.ts             # Error class hierarchy
web/
  src/pages/            # React + Tailwind control panel
scripts/
  install.sh            # macOS/Linux installer
  install.ps1           # Windows installer
  uninstall.sh          # Clean uninstall
tests/
  unit/                 # 1,546 tests across 75 files
```

### Architecture Principles

1. **Security first** — Every feature passes through the security layer
2. **Token-efficient** — Deterministic over AI; check `canAfford` before every LLM call
3. **Performance** — Fast, low memory, local SQLite
4. **Approachable** — Non-developers can set up via the onboarding wizard
5. **Modular** — Features scale with hardware; channels are hot-pluggable

---

## Built With

| | |
|---|---|
| **Runtime** | Node.js 20+, TypeScript (strict, ESM) |
| **Server** | Fastify (HTTP + WebSocket) |
| **Database** | better-sqlite3 (WAL mode) |
| **Frontend** | React 18, Vite, Tailwind CSS |
| **Testing** | Vitest (1,546 tests) |
| **AI SDKs** | @anthropic-ai/sdk, openai, raw fetch (Gemini/Ollama) |
| **Channels** | discord.js, telegraf, @slack/bolt |
| **Validation** | Zod |
| **Logging** | Pino |
| **Build** | tsup |

---

## Uninstall

```bash
# Remove the global package
npm uninstall -g lil-dude

# Optionally remove config and data
rm -rf ~/.lil-dude
```

Or use the uninstall script:

```bash
curl -fsSL https://raw.githubusercontent.com/claypark-dev/lildude/main/scripts/uninstall.sh | bash
```

**Windows:**

```powershell
npm uninstall -g lil-dude
Remove-Item -Recurse -Force "$env:USERPROFILE\.lil-dude"
```

---

## Contributing

Contributions welcome! Lil Dude follows strict coding standards:

- TypeScript strict mode, no `any` types
- Files under 300 lines
- JSDoc on all public functions
- Named exports only
- Dependency injection for testability
- Every async function needs try/catch
- Security functions tested with bypass attempts

See [CLAUDE.md](CLAUDE.md) for the full development rulebook.

---

## License

[MIT](LICENSE) — Use it, fork it, self-host it. Your assistant, your data, your rules.
