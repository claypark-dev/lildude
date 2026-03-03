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
  <strong>Your personal AI executive assistant that learns and grows with you</strong><br/>
  Self-hosted. Self-learning. Multi-channel. Privacy-first. Security-first.
</p>

<p align="center">
  <a href="#quick-start"><img src="https://img.shields.io/badge/Quick_Start-blue?style=for-the-badge" alt="Quick Start"/></a>
  <a href="https://github.com/claypark-dev/lildude/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/claypark-dev/lildude/ci.yml?style=for-the-badge&label=CI" alt="CI"/></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge" alt="MIT License"/></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/Node.js-20+-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="Node 20+"/></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-Strict-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript"/></a>
  <a href="#development"><img src="https://img.shields.io/badge/Tests-2,440_passing-brightgreen?style=for-the-badge" alt="Tests"/></a>
</p>

---

Lil Dude is a **free, open-source** AI executive assistant that runs on **your machine**. It connects to your messaging apps, automates your daily tasks, and learns your preferences over time — like hiring an EA on Day 1 who gets better every week. All while keeping your data private, your costs low, and your system safe.

---

## Why Lil Dude?

**It learns you.** Lil Dude extracts your preferences, communication style, and routines from every conversation. Your morning briefing gets more relevant. Your assistant gets more efficient.

**It builds itself.** When Lil Dude can't do something, [Shorebreak](docs/waves.md#shorebreak-dynamic-wave-generation) triggers — automatically generating new capabilities from safe templates, scanning them for security issues, and asking for your approval before activation.

**Every model is safe.** Whether you're running Claude Opus or a local 7B model through Ollama, [wave safety tiers](docs/waves.md#wave-safety-tiers) ensure read-only tasks always work, destructive actions always confirm, and small models auto-escalate when they struggle. [Learn more about local model safeguards.](docs/local-models.md)

**Your data stays yours.** Everything runs locally. SQLite database on your machine. No cloud telemetry. No account required.

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

The onboarding wizard walks you through provider API keys, channel setup, security level, and token budget.

**Windows:** `irm https://raw.githubusercontent.com/claypark-dev/lildude/main/scripts/install.ps1 | iex`

**From source:** `git clone`, `npm install`, `npm run build`, `npm run onboard`, `npm run start`

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
 WhatsApp ─┼────>│   Agent Loop      │─────>├─ Google (Gemini)
   Signal ─┤     │                  │      ├─ DeepSeek
  WebChat ─┤     │  Sanitize        │      ├─ Ollama (local)
      CLI ─┘     │  > Security Gate │      └─ Groq (voice)
                 │  > Cost Gate     │
                 │  > Route Model   │     ┌─ Shell (sandboxed)
                 │  > Build Context │────>├─ File I/O
                 │  > LLM Call      │     ├─ HTTP fetch
                 │  > Tool Loop     │     ├─ Knowledge base
                 │  > Track Cost    │     └─ Waves (extensible)
                 └──────────────────┘
                         │
                    SQLite (local)
```

Every message flows through: input sanitization, security gate, budget check, model routing, context building (with learned knowledge), LLM call with tool-use loop, and cost tracking.

---

## Key Features

### Waves: Extensible Capabilities

Waves are self-contained modules that give Lil Dude new abilities. Each wave declares a **safety tier** that controls execution:

| Safety Tier | Description | Small Model? |
|---|---|---|
| `observe` | Read-only (email, calendar, weather) | Yes |
| `create` | Adds data (new events, reminders, messages) | Yes (with confirmation) |
| `modify` | Changes existing data | Medium+ preferred |
| `destroy` | Deletes or irreversible actions | Always confirms |
| `execute` | Runs arbitrary code or shell | Full trust required |

```bash
lil-dude wave install github:user/awesome-wave
lil-dude wave list
```

**Wave Registry & Updates:** HMAC-SHA256 signed wave manifests with verified badges. Automatic update checking compares installed versions against the community registry. One-click updates preserve configuration.

**20+ Verified Community Waves** — Pre-built, security-scanned capabilities ready to install:

| Category | Waves |
|----------|-------|
| **Productivity** | note-taker, todo-manager, file-organizer, timer-pomodoro, clipboard-saver |
| **Communication** | email-template, quick-reply, contact-lookup |
| **Finance** | expense-tracker, currency-converter, receipt-parser |
| **Utilities** | weather-checker, timezone-converter, unit-converter, text-summarizer, url-shortener |
| **Social** | birthday-reminder, rsvp-tracker, gift-ideas, social-scheduler |

All deterministic-first, verified by the CI pipeline, and installable with `lil-dude wave install`.

[Full wave documentation](docs/waves.md) | [Wave safety tiers](docs/waves.md#wave-safety-tiers) | [Shorebreak](docs/waves.md#shorebreak-dynamic-wave-generation)

### 5-Level Security Sandbox

| Level | Name | Shell | Network | Files |
|-------|------|-------|---------|-------|
| **1** | Tin Foil Hat | All blocked | All blocked | Read-only |
| **2** | Careful | Allowlist only | Allowlist only | Approved paths |
| **3** | Balanced (default) | Allowlist + approval | Allowlist + approval | Home directory |
| **4** | Trusting | Most allowed | Most allowed | Most allowed |
| **5** | YOLO | Everything except blocklist | Everything | Everything |

Commands are parsed, not string-matched. Prompt injection is detected and blocked. Security-relevant actions are logged.

**Gateway Security:** Bearer token authentication on all API endpoints, token-bucket rate limiting (100 req/min default), WebSocket auth protocol with 5-second timeout, message size limits.

**Prompt Injection Hardening:** 30+ threat patterns covering instruction overrides, role impersonation, delimiter injection, Unicode homoglyphs, invisible characters, HTML/markdown injection, multi-turn jailbreaks, and indirect injection via tool results. Output filter scans every LLM response for leaked API keys, private keys, database schemas, and config paths. Canary tokens detect context leakage. Nonce-tagged spotlighting prevents delimiter-matching attacks.

**Advanced Security Pipeline:** Unified input/output security chain — intent classification, injection detection, output filtering, and canary token verification in a single pipeline. Abuse detection auto-blocks contacts after 3 injection attempts within an hour (reversible by owner). All security events logged to audit trail.

[Full security documentation](docs/security.md)

### Contact Management + Trust Levels

Lil Dude knows who's talking to it. Every sender is resolved to a contact with a trust level that controls what they can do:

| Trust Level | Wave Access | Description |
|-------------|-------------|-------------|
| **owner** | All tiers | Full access to everything |
| **trusted** | observe/create/modify | Friends and close contacts |
| **known** | observe only | Acquaintances (read-only waves) |
| **unknown** | Messages only | First-time senders (no wave access) |

Per-contact rate limits, budget caps, wave allowlists, and favorites. All trust level changes logged to the security audit trail.

**Contact Groups & Activity Dashboard:** Organize contacts into named groups (Family, Work, VIP). Per-contact activity metrics track message counts, spending, wave usage, meeting requests, and relayed messages. Per-contact notification preferences with mute, digest frequency, and per-event toggles. External activity summary powers the dashboard widget showing unread messages, pending meetings, and recent events.

### External User Waves

Five bundled waves let external contacts interact with Lil Dude safely — without needing the owner present:

| Wave | Safety Tier | Description |
|------|-------------|-------------|
| **availability-check** | observe | Check owner's free time without revealing event details |
| **meeting-request** | create | Propose meeting times for owner approval |
| **contact-share** | observe | Get owner's shareable contact info (privacy-first, opt-in fields only) |
| **message-relay** | create | Leave messages with urgency levels (low/normal/high/urgent) |
| **auto-responder** | observe | Get owner's current status/away message |

All gated by trust levels — owner controls who can do what. Meeting requests and relayed messages require owner approval. Full audit trail on every external interaction.

### Smart Model Routing

5 providers, 3 tiers, automatic complexity classification:

| Provider | Best Models | Cost |
|----------|------------|------|
| **Anthropic** | Haiku, Sonnet, Opus | Pay per token |
| **OpenAI** | GPT-4o-mini, GPT-4o, GPT-4.1 | Pay per token |
| **Gemini** | Flash, Pro | Pay per token |
| **DeepSeek** | deepseek-chat | Pay per token |
| **Ollama** | llama3.2, qwen2.5, phi3, mistral | Free (local) |

Quality-aware routing learns from feedback to improve model selection over time.

[Full provider documentation](docs/providers.md) | [Local model safeguards](docs/local-models.md)

### 8 Messaging Channels

Discord, Telegram, iMessage, Slack, WhatsApp, Signal, WebChat, CLI. Talk to your assistant from wherever you already are.

[Channel setup guide](docs/channels.md)

### Budget Guardrails

| Guardrail | Default |
|-----------|---------|
| Monthly limit | $20.00 |
| Per-task limit | $0.50 |
| Warning threshold | 80% |
| Hard stop | Enabled |

Typical cost with cloud providers: ~$0.25/day (~$7.50/month). With Ollama: $0/month.

### Email & Calendar (OAuth2)

Read and summarize emails, send messages, manage calendar events — all via Gmail/Google Calendar or Microsoft Graph APIs. OAuth2 with PKCE keeps credentials secure; AES-256-GCM encrypted token storage.

### Wave Hub & Plugins

Browse, install, rate, and manage community waves from a curated registry. Extend Lil Dude with custom LLM providers, messaging channels, and memory backends via the plugin architecture. Connect external MCP servers as additional tool providers.

### Self-Improvement Loop

Thumbs up/down feedback, failure pattern analysis, wave effectiveness tracking, and a daily learning journal. The agent gets better with every interaction — no extra LLM cost.

### Voice I/O

Transcribe audio with Groq Whisper, generate speech with ElevenLabs TTS. Works as an augmentation layer on any channel.

### Daily Briefings & Cron

Scheduled tasks and morning briefings (email summary, calendar, weather, cost overview, learning insights) delivered to your preferred channel. Gets smarter over time as Lil Dude learns your routines.

---

## Documentation

| Topic | Description |
|-------|-------------|
| [Waves & Shorebreak](docs/waves.md) | Wave system, safety tiers, dynamic generation, Wave Hub |
| [Security](docs/security.md) | 5-level sandbox, command parsing, injection detection, wave safety enforcement |
| [Providers & Routing](docs/providers.md) | Model routing, quality-aware selection, pricing |
| [Local Models](docs/local-models.md) | Ollama safeguards, safety tiers for small models, auto-escalation |
| [Channels](docs/channels.md) | Setup guides for all 8 messaging platforms |
| [Configuration](docs/configuration.md) | Full config reference |
| [CLAUDE.md](CLAUDE.md) | Development rules and coding standards |

---

## Development

```bash
git clone https://github.com/claypark-dev/lildude.git
cd lildude && npm install
```

| Script | Description |
|--------|-------------|
| `npm run dev` | Start with hot reload |
| `npm run build` | Build with tsup |
| `npm test` | Run 2,440 tests |
| `npm run typecheck` | TypeScript strict check |
| `npm run lint` | ESLint |
| `npm run web:dev` | Web panel dev server |

### Project Structure

```
src/
  orchestrator/     # Agent loop, task pool, tool guard, quality rater, learning journal
  waves/            # Wave loader, executor, safety tiers, hub, shorebreak, request classifier
  security/         # Permission engine, command parser, injection detection, output filter, canary tokens, intent classifier
  providers/        # LLM adapters (Anthropic, OpenAI, Gemini, DeepSeek, Ollama) + plugins
  channels/         # 8 channel adapters + plugin discovery
  cost/             # Pricing, budget enforcement, token counting
  contacts/         # Contact permissions, trust-level gating, profile learning, rate limiting, budget tracking, activity metrics, notifications
  persistence/      # SQLite DAL with 12 migrations
  context/          # Knowledge management, summarization
  memory/           # Hybrid search (vector + BM25), embeddings, temporal decay, MMR
  integrations/     # OAuth2, Gmail, Google Calendar, MCP client
  tools/            # Tool executor with input validation
  voice/            # Transcription, synthesis
  gateway/          # Fastify HTTP + WebSocket + REST APIs + auth middleware + rate limiter
  types/            # All canonical interfaces
web/                # React + Tailwind control panel
docs/               # Detailed documentation
waves/community/    # 20+ verified community waves with registry
tests/              # 2,440 tests across 132 files
```

### Architecture Principles

1. **Security first** — Every feature passes through the security layer
2. **Token-efficient** — Deterministic over AI; budget checks before every LLM call
3. **Performance** — Fast, low memory, local SQLite
4. **Approachable** — Non-developers can set up via the onboarding wizard
5. **Self-learning** — Gets better with every interaction

---

## Contributing

Contributions welcome! See [CLAUDE.md](CLAUDE.md) for the full development rulebook.

---

## License

[MIT](LICENSE) — Use it, fork it, self-host it. Your assistant, your data, your rules.
