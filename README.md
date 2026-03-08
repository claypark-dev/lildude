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
  <a href="https://claypark-dev.github.io/lildude/"><img src="https://img.shields.io/badge/Landing_Page-2dd4bf?style=for-the-badge&logo=github&logoColor=white" alt="Landing Page"/></a>
  <a href="https://claypark-dev.github.io/wave-registry/"><img src="https://img.shields.io/badge/Wave_Hub-38bdf8?style=for-the-badge&logo=github&logoColor=white" alt="Wave Hub"/></a>
  <a href="#quick-start"><img src="https://img.shields.io/badge/Quick_Start-blue?style=for-the-badge" alt="Quick Start"/></a>
</p>

<p align="center">
  <a href="https://github.com/claypark-dev/lildude/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/claypark-dev/lildude/ci.yml?style=for-the-badge&label=CI" alt="CI"/></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge" alt="MIT License"/></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/Node.js-20+-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="Node 20+"/></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-Strict-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript"/></a>
  <a href="#development"><img src="https://img.shields.io/badge/Tests-4,000+-brightgreen?style=for-the-badge" alt="Tests"/></a>
  <a href="#"><img src="https://img.shields.io/badge/Version-1.1.0-orange?style=for-the-badge" alt="v1.1.0"/></a>
</p>

---

Lil Dude is a **free, open-source** AI executive assistant that runs on **your machine**. It connects to your messaging apps, automates your daily tasks, and learns your preferences over time — like hiring an EA on Day 1 who gets better every week. All while keeping your data private, your costs low, and your system safe.

**967 community waves. 12 messaging channels. 5 LLM providers. Zero cloud telemetry.**

---

## Why Lil Dude?

**It learns you.** Lil Dude extracts your preferences, communication style, and routines from every conversation — using deterministic regex and SQL, not expensive LLM calls. Inline fact extraction catches "Sarah is my manager" in real-time. Contradiction detection knows when "I moved to Portland" supersedes "I live in Seattle." Entity linking connects the dots across conversations. Your morning briefing gets more relevant every day.

**It builds itself.** When Lil Dude can't do something, [Shorebreak](docs/waves.md#shorebreak-dynamic-wave-generation) triggers — automatically generating new capabilities from safe templates, scanning them for security issues, and asking for your approval before activation.

**It watches your back.** The [Heartbeat system](#heartbeat-proactive-agent) checks in on a schedule — surfacing unread notifications, upcoming calendar events, and overdue reminders without being asked. Stays silent when there's nothing to report. Uses the cheapest model with a $0.50/day budget cap.

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

**Docker:** `docker compose up -d` (see [Docker setup](#docker))

**Auto-start on login:**
- **macOS:** `bash scripts/install-macos.sh` (LaunchAgent)
- **Linux:** `bash scripts/install-linux.sh` (systemd user service)
- **Windows:** `powershell scripts/install-windows.ps1` (Scheduled Task)

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
 WhatsApp ─┤     │   Agent Loop      │─────>├─ Google (Gemini)
   Signal ─┤     │                  │      ├─ DeepSeek
  WebChat ─┼────>│  Sanitize        │      ├─ Ollama (local)
      CLI ─┤     │  > Security Gate │      └─ Groq (voice)
   Matrix ─┤     │  > Cost Gate     │
    Teams ─┤     │  > Route Model   │     ┌─ Shell (sandboxed)
     LINE ─┤     │  > Build Context │────>├─ File I/O
  G. Chat ─┘     │  > LLM Call      │     ├─ HTTP fetch
                 │  > Tool Loop     │     ├─ Knowledge base
                 │  > Track Cost    │     ├─ MCP servers
                 └──────────────────┘     └─ Waves (extensible)
                         │
                    SQLite (local)
```

Every message flows through: input sanitization, inline fact extraction, security gate, budget check, model routing, context building (with learned knowledge + entity links), LLM call with tool-use loop, and cost tracking.

---

## Key Features

### Artifacts: Rich Output Rendering

Lil Dude renders rich content inline in chat — not just plain text:

| Type | Rendering | Security |
|------|-----------|----------|
| **HTML** | Sandboxed iframe (`srcdoc` + `sandbox`) | DOMPurify sanitization |
| **SVG** | Inline rendering | SVG-specific sanitization |
| **Mermaid** | Client-side diagrams (lazy-loaded mermaid.js) | Fallback on parse error |
| **Code** | Syntax highlighting (40+ languages) | Read-only display |
| **Tables** | Styled HTML with alignment detection | Sanitized output |

Every artifact gets a copy-to-clipboard button and collapse/expand toggle. HTML iframes auto-resize to content (60-600px). Mermaid diagrams render client-side with error fallback.

### Heartbeat: Proactive Agent

The Heartbeat system turns Lil Dude from reactive to proactive. It runs on a configurable schedule, reads standing instructions from `~/.lil-dude/heartbeat.md`, and surfaces actionable items without being asked.

| Setting | Default | Description |
|---------|---------|-------------|
| `heartbeat.enabled` | `true` | Master toggle |
| `heartbeat.intervalMinutes` | `30` | Check frequency |
| `heartbeat.maxDailyBudgetUsd` | `$0.50` | Daily spend cap |
| `heartbeat.model` | auto | Uses cheapest small-tier model |

When nothing needs attention, Heartbeat stays silent — zero cost. Standing instructions are user-editable markdown. Dashboard widget shows last run time, actions taken today, and daily cost.

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

**[967 Community Waves](https://claypark-dev.github.io/wave-registry/)** — Browse, search, and install from the Wave Hub marketplace:

| Category | Count | Examples |
|----------|-------|---------|
| **Utilities** | 826 | weather, timezone-converter, text-summarizer, url-shortener |
| **AI** | 37 | image-gen, text-classifier, sentiment-analyzer |
| **Development** | 31 | git-helper, code-reviewer, test-generator |
| **Communication** | 24 | email-template, quick-reply, contact-lookup |
| **Cloud** | 20 | aws-helper, gcp-monitor, azure-deploy |
| **Productivity** | 10 | note-taker, todo-manager, file-organizer |
| **Data** | 8 | csv-parser, json-transformer, data-cleaner |
| **Media** | 8 | image-resize, audio-convert, video-thumbnail |

All security-scanned, safety-tier labeled, and installable with `lil-dude wave install`. Every wave passes quality gates: valid manifest, entry point exists, no dangerous shell commands.

[Full wave documentation](docs/waves.md) | [Wave safety tiers](docs/waves.md#wave-safety-tiers) | [Shorebreak](docs/waves.md#shorebreak-dynamic-wave-generation) | [Wave Hub](https://claypark-dev.github.io/wave-registry/)

### MCP Protocol Support

Connect any [Model Context Protocol](https://modelcontextprotocol.io/) server as a tool provider. MCP tools appear alongside waves in the agent loop — same security pipeline, same budget tracking.

```json
{
  "mcpServers": [
    {
      "name": "filesystem",
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/user"]
    },
    {
      "name": "database",
      "transport": "sse",
      "url": "http://localhost:3001/sse"
    }
  ]
}
```

- **Tool discovery**: Automatically discovers and registers tools from connected servers
- **Namespaced tools**: `mcp_filesystem_readFile` prevents collisions between servers
- **Dynamic management**: Add/remove servers at runtime via API or config
- **Parallel connection**: Connects to all servers simultaneously with individual error handling
- **Status monitoring**: Dashboard shows tool count, connection status, and errors per server

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

### Adaptive Memory System

Lil Dude's memory runs on **deterministic-first** principles — regex extraction, SQL aggregation, and entity linking. Zero additional LLM cost.

| Component | What It Does | LLM Cost |
|-----------|-------------|----------|
| **Inline Extraction** | Catches facts from every message in real-time ("Sarah is my manager", "I live in Seattle") | $0 |
| **Contradiction Detection** | Knows "I moved to Portland" supersedes "I live in Seattle" — supersedes old facts automatically | $0 |
| **Entity Linking** | Links "Sarah's email is sarah@work.com" to the same Sarah entity across conversations | $0 |
| **Behavioral Analysis** | Infers active hours, preferred response length, recurring topics from conversation patterns | $0 |
| **Knowledge Lifecycle** | Auto-evicts stale facts, decays confidence on unused entries, deduplicates — daily maintenance | $0 |
| **Confidence Feedback** | Facts that keep being useful get boosted; contradicted facts get demoted | $0 |

**Extraction patterns:** relationships, personal facts (location, birthday, email), corrections ("actually it's..."), temporal updates ("starting Monday..."), contact attributes, and entity types (person, organization, project, location, event).

**Safety guards:** Never evicts explicit user-set facts or high-confidence entries (>=0.9). Superseded facts kept for 14-day audit window.

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

Quality-aware routing tracks every model's quality score per task type — models scoring well get boosted, poor performers get deprioritized. The system learns which models work best for your usage patterns.

[Full provider documentation](docs/providers.md) | [Local model safeguards](docs/local-models.md)

### 12 Messaging Channels

| Channel | Transport | Message Limit |
|---------|-----------|---------------|
| **Discord** | WebSocket (discord.js) | 2,000 chars |
| **Telegram** | Polling (telegraf) | 4,096 chars |
| **iMessage** | AppleScript bridge | 20,000 chars |
| **Slack** | WebSocket (Bolt) | 40,000 chars |
| **WhatsApp** | Cloud API webhook | 4,096 chars |
| **Signal** | signal-cli bridge | 6,000 chars |
| **WebChat** | Built-in WebSocket | Unlimited |
| **CLI** | stdin/stdout | Unlimited |
| **Matrix** | matrix-js-sdk | 8,192 chars |
| **Microsoft Teams** | Bot Framework | 28,000 chars |
| **LINE** | Messaging API webhook | 5,000 chars |
| **Google Chat** | Workspace API | 4,096 chars |

Talk to your assistant from wherever you already are. Long responses are automatically chunked to stay within platform limits.

[Channel setup guide](docs/channels.md)

### Budget Guardrails

| Guardrail | Default |
|-----------|---------|
| Monthly limit | $20.00 |
| Per-task limit | $0.50 |
| Warning threshold | 80% |
| Heartbeat daily cap | $0.50 |
| Hard stop | Enabled |

Typical cost with cloud providers: ~$0.25/day (~$7.50/month). With Ollama: $0/month.

### Email & Calendar (OAuth2)

Read and summarize emails, send messages, manage calendar events — all via Gmail/Google Calendar or Microsoft Graph APIs. OAuth2 with PKCE keeps credentials secure; AES-256-GCM encrypted token storage.

### Wave Hub & Marketplace

Browse, search, and install from **[967 community waves](https://claypark-dev.github.io/wave-registry/)** in a ClawHub-style marketplace. Real-time search, category filtering, safety tier badges, one-click install commands, and security scan indicators. Rate and review waves, check for updates, and publish your own.

### Self-Improvement Loop

Thumbs up/down feedback, failure pattern analysis, wave effectiveness tracking, and a daily learning journal. The agent gets better with every interaction — no extra LLM cost.

### Voice I/O

Transcribe audio with Groq Whisper, generate speech with ElevenLabs TTS. Works as an augmentation layer on any channel.

### Daily Briefings & Cron

Scheduled tasks and morning briefings (email summary, calendar, weather, cost overview, learning insights) delivered to your preferred channel. Gets smarter over time as Lil Dude learns your routines.

### Integrated Dashboard

11-page web dashboard — no separate products to install:

- **Chat** — WebChat interface with artifact rendering
- **Dashboard** — System health, budget widget, heartbeat status, activity overview
- **Tasks** — Cron job management and scheduled task monitoring
- **Settings** — Provider keys, channel config, security level, budget caps
- **Waves Hub** — Browse, install, and manage community waves
- **Shorebreak** — Review and approve auto-generated capabilities
- **Contacts** — Trust levels, groups, activity metrics, notification preferences

---

## Docker

Run Lil Dude in a container with persistent data:

```bash
# Build and start
docker compose up -d

# View logs
docker compose logs -f lildude

# Stop
docker compose down
```

The Docker setup exposes port 18421 (HTTP API) and 18420 (WebSocket). Data persists in `~/.lil-dude/` on the host. Health checks run automatically on `/api/v1/health`.

For local LLM support, uncomment the `ollama` service in `docker-compose.yml`.

---

## Documentation

| Topic | Description |
|-------|-------------|
| [Waves & Shorebreak](docs/waves.md) | Wave system, safety tiers, dynamic generation, Wave Hub |
| [Security](docs/security.md) | 5-level sandbox, command parsing, injection detection, wave safety enforcement |
| [Providers & Routing](docs/providers.md) | Model routing, quality-aware selection, pricing |
| [Local Models](docs/local-models.md) | Ollama safeguards, safety tiers for small models, auto-escalation |
| [Channels](docs/channels.md) | Setup guides for all 12 messaging platforms |
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
| `npm test` | Run 4,000+ tests |
| `npm run typecheck` | TypeScript strict check |
| `npm run lint` | ESLint |
| `npm run web:dev` | Web panel dev server |

### Project Structure

```
src/
  orchestrator/     # Agent loop, heartbeat, task pool, tool guard, quality rater, learning journal
  waves/            # Wave loader, executor, safety tiers, hub, shorebreak, request classifier
  security/         # Permission engine, command parser, injection detection, output filter, canary tokens, intent classifier
  providers/        # LLM adapters (Anthropic, OpenAI, Gemini, DeepSeek, Ollama) + plugins
  channels/         # 12 channel adapters (Discord, Telegram, iMessage, Slack, WhatsApp, Signal, WebChat, CLI, Matrix, Teams, LINE, Google Chat)
  cost/             # Pricing, budget enforcement, token counting
  contacts/         # Contact permissions, trust-level gating, profile learning, rate limiting, budget tracking, activity metrics, notifications
  persistence/      # SQLite DAL with 20 migrations (001-020)
  context/          # Knowledge management, summarization
  memory/           # Inline extraction, contradiction detection, entity linking, behavioral analysis, knowledge lifecycle, hybrid search
  integrations/     # OAuth2, Gmail, Google Calendar, MCP manager
  tools/            # Tool executor with input validation + MCP bridge
  voice/            # Transcription, synthesis
  gateway/          # Fastify HTTP + WebSocket + REST APIs + MCP management API + auth middleware + rate limiter
  types/            # All canonical interfaces
web/                # React + Tailwind control panel with artifact rendering
landing/            # GitHub Pages landing site
docs/               # Detailed documentation
waves/bundled/      # Core bundled waves
scripts/            # Install scripts (macOS/Linux/Windows), benchmark
tests/              # 4,000+ tests across 218 files (unit, integration, E2E)
```

### Architecture Principles

1. **Security first** — Every feature passes through the security layer
2. **Deterministic over AI** — Regex, SQL, and static analysis before reaching for LLM calls
3. **Cost-conscious** — Budget checks before every LLM call; cheapest model that works
4. **Approachable** — Non-developers can set up via the onboarding wizard
5. **Self-learning** — Gets better with every interaction, at zero additional LLM cost
6. **You approve** — The agent suggests, you decide. No autonomous surprises.

---

## Contributing

Contributions welcome! See [CLAUDE.md](CLAUDE.md) for the full development rulebook.

---

## License

[MIT](LICENSE) — Use it, fork it, self-host it. Your assistant, your data, your rules.
