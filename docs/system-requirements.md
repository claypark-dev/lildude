# Lil Dude — System Requirements

> Last updated: March 2026 (v1.0, Sprint 18A)

## Quick Reference

| Tier | RAM | CPU | Disk | GPU | What You Get |
|------|-----|-----|------|-----|-------------|
| **Lite** | 4–8 GB | 2+ cores | 500 MB | No | Core agent, webchat, 2 channels, basic waves |
| **Standard** | 16 GB | 4+ cores | 2 GB | No | Full agent, all channels, browser automation, all waves |
| **Full** | 32+ GB | 4+ cores | 10+ GB | Yes | Everything + local models (Ollama) + voice + TTS |

## Software Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| **Node.js** | 20+ (LTS) | Required. ESM modules, `fetch()` built-in |
| **npm** | 10+ | Comes with Node.js |
| **Git** | 2.30+ | For installing waves from GitHub |
| **SQLite** | Bundled | Ships via `better-sqlite3` — no separate install |
| **Docker** (optional) | 20+ | For containerized deployment |
| **Ollama** (optional) | 0.3+ | Only for local model inference |

## Resource Footprint

### Application Size

| Component | Size |
|-----------|------|
| Compiled server (`dist/`) | 856 KB |
| Web panel (`web/dist/`) | 364 KB |
| Bundled waves | 248 KB |
| Database migrations | 68 KB |
| **Total application** | **~1.5 MB** |
| Production `node_modules/` | ~80 MB (after `--omit=dev`) |
| Dev `node_modules/` | 223 MB |

### Runtime Memory

| Configuration | Estimated RSS |
|--------------|---------------|
| Idle (no channels connected) | ~60–80 MB |
| Active (webchat + 1 channel) | ~100–150 MB |
| Active (all channels + waves) | ~150–250 MB |
| With Ollama (3B model loaded) | +4–8 GB (Ollama process) |
| With local TTS model | +200–500 MB (CPU inference) |

Memory is dominated by Node.js baseline and the LLM SDK clients. SQLite uses minimal memory (WAL mode, no in-memory cache).

### Disk Usage

| Component | Size |
|-----------|------|
| Application + dependencies | ~80 MB |
| SQLite database (typical) | 5–50 MB (grows with conversations) |
| Ollama models (optional) | 2–8 GB per model |
| TTS voice models (optional) | 60–82 MB per voice |
| Docker image (Alpine) | ~200 MB |

### Network

| Service | Direction | When |
|---------|-----------|------|
| LLM providers (Claude, OpenAI, etc.) | Outbound HTTPS | Every AI-powered wave execution |
| Groq Whisper (optional) | Outbound HTTPS | Voice transcription (cloud mode) |
| Wave registry (GitHub) | Outbound HTTPS | Hub browse, cached 24h |
| Channel APIs (Discord, Telegram) | Outbound WSS/HTTPS | When channels are enabled |
| OAuth (Google, Microsoft) | Outbound HTTPS | Integration setup |
| **No inbound internet required** | — | Binds to localhost only |

### Ports

| Port | Protocol | Purpose | Configurable |
|------|----------|---------|-------------|
| 18421 | HTTP | REST API + web panel | `gateway.httpPort` |
| 18420 | WebSocket | Real-time events | `gateway.wsPort` |

Both bind to `127.0.0.1` (localhost only) by default. Change `gateway.host` to `0.0.0.0` for LAN access.

## Hardware Feature Gating

Lil Dude automatically detects hardware at startup and enables/disables features:

| Feature | Requires | Detection |
|---------|----------|-----------|
| Core agent | 4 GB RAM, 2 cores | Always available |
| Browser automation | 8+ GB RAM | `os.totalmem() >= 8 GB` |
| Local models (Ollama) | 16+ GB RAM | `os.totalmem() >= 16 GB` |
| Voice (TTS/STT) | 16+ GB RAM + GPU | RAM check + GPU detection |

**GPU detection by platform:**
- **macOS**: `system_profiler SPDisplaysDataType` (detects Apple Silicon GPU, discrete GPUs)
- **Linux**: `/proc/driver/nvidia/version` (NVIDIA), `/sys/class/drm/card*/device/vendor` (AMD/Intel)
- **Windows**: `wmic path win32_VideoController get name` (any dedicated GPU)

## Tier Details

### Lite (4–8 GB RAM)

Best for: trying out Lil Dude, low-resource machines, Raspberry Pi 4 (8 GB).

- Core message pipeline with deterministic waves
- Webchat + up to 2 messaging channels
- Cloud LLM only (Anthropic, OpenAI, DeepSeek, Gemini)
- 7 personal waves (reminders, stock-monitor, web-search, etc.)
- No browser automation, no local models, no voice
- Estimated idle memory: ~60 MB

### Standard (16 GB RAM)

Best for: daily use as a full executive assistant.

- Everything in Lite, plus:
- All messaging channels (Discord, Telegram, Slack, iMessage)
- Browser automation (Playwright)
- All 16 bundled waves including party waves
- Local model support via Ollama (if installed)
- Up to 5 concurrent task executions
- Estimated active memory: ~150–250 MB (+Ollama if used)

### Full (32+ GB RAM + GPU)

Best for: power users who want fully local, private operation.

- Everything in Standard, plus:
- Voice transcription (local Whisper or cloud Groq)
- Text-to-speech (local TTS or cloud ElevenLabs)
- Larger local models (13B+ parameter)
- Custom voice profiles
- Estimated active memory: ~300 MB + Ollama + TTS models

## Platform Support

| Platform | Status | Notes |
|----------|--------|-------|
| macOS 13+ (Apple Silicon) | ✅ Full support | Best experience. Unified memory helps with Ollama + TTS |
| macOS 13+ (Intel) | ✅ Full support | Voice features need discrete GPU |
| Ubuntu 22.04+ / Debian 12+ | ✅ Full support | NVIDIA GPU recommended for voice |
| Windows 10+ (WSL2) | ✅ Supported | Run inside WSL2 with Node.js |
| Windows 10+ (native) | ⚠️ Partial | `better-sqlite3` needs build tools; Docker recommended |
| Raspberry Pi 4 (8 GB) | ⚠️ Lite only | ARM64, no GPU, limited to cloud LLM |
| Docker (any platform) | ✅ Full support | Alpine-based, multi-stage build, ~200 MB image |

## Codebase Stats (v1.0)

| Metric | Value |
|--------|-------|
| Source files | 186 TypeScript files |
| Source lines | 36,860 |
| Test files | 155 |
| Test lines | 40,637 |
| Test count | 2,884 passing |
| Test-to-source ratio | 1.10x |
| Bundled waves | 16 |
| Database migrations | 14 |
| Production dependencies | 21 |
| Dev dependencies | 10 |

## Running in Docker

```bash
docker build -t lildude .
docker run -d \
  --name lildude \
  -p 18421:18421 \
  -p 18420:18420 \
  -v ~/.lil-dude:/home/lildude/.lil-dude \
  -e LIL_DUDE_ANTHROPIC_KEY=sk-... \
  lildude
```

The Docker image uses `node:20-alpine` with a multi-stage build. Build tools (python3, make, g++) are only present during compilation and removed in the runtime stage.

## Configuration Reference

All settings live in `~/.lil-dude/config.json`. Key sections:

| Section | Controls |
|---------|----------|
| `user` | Name, timezone |
| `providers` | API keys for Claude, OpenAI, DeepSeek, Gemini, Ollama |
| `channels` | Enable/disable Discord, Telegram, Slack, iMessage, webchat |
| `security` | Level (1–5), shell/dir/domain allowlists |
| `budget` | Monthly limit ($20 default), per-task limit ($0.50 default) |
| `gateway` | Ports, host binding, rate limits |
| `voice` | Transcription backend, synthesis backend, voice ID |
| `preferences` | Default model, briefing time, power user mode |
| `integrations` | Google/Microsoft OAuth credentials |

See `docs/configuration.md` for the full reference.
