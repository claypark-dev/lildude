# Configuration

Lil Dude uses a single JSON configuration file that controls every aspect of the system: providers, channels, security, budget, gateway, preferences, and voice.

---

## Config File Location

```
~/.lil-dude/config.json
```

On first run, the onboarding wizard creates this file with your initial settings. You can edit it directly or use the web panel's settings page.

---

## Complete Configuration Reference

Below is a fully annotated configuration file showing every available field with its default value:

```json5
{
  // Schema version (do not change)
  "version": 1,

  // --- User ---
  "user": {
    "name": "Friend",                    // Your name (used in greetings and briefings)
    "timezone": "America/New_York"        // IANA timezone for scheduling and briefings
  },

  // --- LLM Providers ---
  "providers": {
    "anthropic": {
      "apiKey": "",                       // Anthropic API key (sk-ant-...)
      "enabled": false                    // Enable Claude models
    },
    "openai": {
      "apiKey": "",                       // OpenAI API key (sk-...)
      "enabled": false                    // Enable GPT models
    },
    "gemini": {
      "apiKey": "",                       // Google AI Studio API key (AIza...)
      "enabled": false                    // Enable Gemini models
    },
    "deepseek": {
      "apiKey": "",                       // DeepSeek API key
      "enabled": false,                   // Enable DeepSeek models
      "apiBase": "https://api.deepseek.com" // API base URL (OpenAI-compatible)
    },
    "ollama": {
      "enabled": false,                   // Enable local Ollama models
      "baseUrl": "http://localhost:11434", // Ollama server URL
      "model": "llama3.2"                // Default Ollama model to use
    }
  },

  // --- Messaging Channels ---
  "channels": {
    "discord": {
      "enabled": false,
      "token": "",                        // Discord bot token
      "allowFrom": []                     // Discord user IDs to accept messages from (empty = all)
    },
    "telegram": {
      "enabled": false,
      "token": "",                        // Telegram bot token from BotFather
      "allowFrom": []                     // Telegram user IDs to accept messages from (empty = all)
    },
    "imessage": {
      "enabled": false                    // macOS only, no token needed
    },
    "webchat": {
      "enabled": true                     // Built-in web chat (enabled by default)
    },
    "slack": {
      "enabled": false,
      "token": "",                        // Slack Bot User OAuth Token (xoxb-...)
      "appToken": "",                     // Slack App-Level Token (xapp-...) for Socket Mode
      "allowFrom": []                     // Slack user IDs to accept messages from (empty = all)
    },
    "whatsapp": {
      "enabled": false,
      "allowFrom": []                     // WhatsApp phone numbers to accept messages from
    },
    "signal": {
      "enabled": false,
      "phoneNumber": "",                  // Phone number registered with signal-cli
      "allowFrom": []                     // Phone numbers to accept messages from
    }
  },

  // --- Security ---
  "security": {
    "level": 3,                           // 1=Tin Foil Hat, 2=Careful, 3=Balanced, 4=Trusting, 5=YOLO
    "shellAllowlistOverride": [],         // Additional allowed shell binaries
    "shellBlocklistOverride": [],         // Shell binaries to always block
    "dirAllowlistOverride": [],           // Additional allowed directories
    "dirBlocklistOverride": [],           // Directories to always block
    "domainAllowlistOverride": [],        // Additional allowed outbound domains
    "domainBlocklistOverride": []         // Domains to always block
  },

  // --- Budget ---
  "budget": {
    "monthlyLimitUsd": 20,               // Maximum monthly LLM spend in USD
    "perTaskDefaultLimitUsd": 0.50,       // Default budget per task in USD
    "warningThresholdPct": 0.8,           // Warn user when this % of monthly budget is used
    "hardStopEnabled": true               // Stop all LLM calls when monthly budget is exhausted
  },

  // --- Gateway ---
  "gateway": {
    "wsPort": 18420,                      // WebSocket port for real-time communication
    "httpPort": 18421,                    // HTTP port for REST API and web panel
    "host": "127.0.0.1"                  // Bind address (localhost only by default)
  },

  // --- Preferences ---
  "preferences": {
    "defaultModel": null,                 // Override model selection (e.g., "claude-sonnet-4-5-20250929")
    "enableModelRouting": true,           // Enable automatic complexity-based model routing
    "briefingTime": "08:00",              // Daily briefing time (HH:MM in user's timezone)
    "powerUserMode": false,               // Show technical details in responses
    "enableQualityChecks": false          // Enable post-response quality verification
  },

  // --- Voice ---
  "voice": {
    "enabled": false,                     // Enable voice input/output
    "transcription": {
      "backend": "groq",                  // "groq" (cloud) or "local" (whisper.cpp)
      "groqApiKey": "",                   // Groq API key for Whisper transcription
      "language": "en"                    // ISO 639-1 language code
    },
    "synthesis": {
      "enabled": false,                   // Enable text-to-speech output
      "backend": "elevenlabs",            // "elevenlabs" (cloud) or "local"
      "elevenLabsApiKey": "",             // ElevenLabs API key
      "voiceId": "pNInz6obpgDQGcFmaJgB"  // ElevenLabs voice ID (default: Adam)
    }
  }
}
```

---

## Section Details

### User

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | string | `"Friend"` | Your name, used in greetings and daily briefings |
| `timezone` | string | `"America/New_York"` | IANA timezone string for scheduling, cron jobs, and briefing times |

### Providers

At least one provider must be enabled for Lil Dude to function. See [Providers](providers.md) for detailed setup instructions.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `providers.<name>.apiKey` | string | `""` | API key for the provider |
| `providers.<name>.enabled` | boolean | `false` | Whether this provider is active |
| `providers.deepseek.apiBase` | string | `"https://api.deepseek.com"` | Custom API base URL |
| `providers.ollama.baseUrl` | string | `"http://localhost:11434"` | Ollama server URL |
| `providers.ollama.model` | string | `"llama3.2"` | Default Ollama model |

### Channels

See [Channels](channels.md) for detailed setup instructions for each platform.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `channels.<name>.enabled` | boolean | varies | Whether this channel is active |
| `channels.<name>.token` | string | `""` | Platform bot/auth token |
| `channels.<name>.allowFrom` | string[] | `[]` | User IDs/numbers to accept messages from (empty = all) |
| `channels.slack.appToken` | string | `""` | Slack App-Level Token for Socket Mode |
| `channels.signal.phoneNumber` | string | `""` | Phone number registered with signal-cli |

### Security

See [Security](security.md) for the full security system documentation.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `level` | number (1-5) | `3` | Security preset level |
| `shellAllowlistOverride` | string[] | `[]` | Additional binaries to allow |
| `shellBlocklistOverride` | string[] | `[]` | Binaries to always block |
| `dirAllowlistOverride` | string[] | `[]` | Additional directories to allow |
| `dirBlocklistOverride` | string[] | `[]` | Directories to always block |
| `domainAllowlistOverride` | string[] | `[]` | Additional outbound domains to allow |
| `domainBlocklistOverride` | string[] | `[]` | Domains to always block |

### Budget

Lil Dude tracks every LLM call's token usage and cost. The budget system prevents runaway spending.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `monthlyLimitUsd` | number | `20` | Maximum total LLM spend per calendar month |
| `perTaskDefaultLimitUsd` | number | `0.50` | Default maximum spend for a single task |
| `warningThresholdPct` | number | `0.8` | Percentage of monthly budget that triggers a warning (0.0-1.0) |
| `hardStopEnabled` | boolean | `true` | If true, all LLM calls are blocked when the monthly budget is exhausted |

When `hardStopEnabled` is `true` and the monthly budget is reached, Lil Dude will refuse all LLM calls until the next month. When `false`, it will warn but continue operating.

### Gateway

The gateway serves the REST API, web panel, and WebSocket connections.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `wsPort` | number | `18420` | WebSocket server port |
| `httpPort` | number | `18421` | HTTP server port (API + web panel) |
| `host` | string | `"127.0.0.1"` | Bind address. Use `127.0.0.1` for local-only access. Use `0.0.0.0` to expose on the network (not recommended without additional security). |

### Preferences

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `defaultModel` | string or null | `null` | Force a specific model for all requests, bypassing the router |
| `enableModelRouting` | boolean | `true` | Enable automatic complexity-based routing. If `false`, uses `defaultModel` or the first available model. |
| `briefingTime` | string | `"08:00"` | Time for the daily briefing in HH:MM format (in the user's timezone) |
| `powerUserMode` | boolean | `false` | Show model selection, token counts, and cost in responses |
| `enableQualityChecks` | boolean | `false` | Run a follow-up quality check on responses and auto-regenerate if quality is too low |

### Voice

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `voice.enabled` | boolean | `false` | Master switch for voice features |
| `voice.transcription.backend` | `"groq"` or `"local"` | `"groq"` | Speech-to-text backend |
| `voice.transcription.groqApiKey` | string | `""` | Groq API key (for Whisper large-v3 transcription) |
| `voice.transcription.language` | string | `"en"` | ISO 639-1 language code for transcription |
| `voice.synthesis.enabled` | boolean | `false` | Enable text-to-speech output |
| `voice.synthesis.backend` | `"elevenlabs"` or `"local"` | `"elevenlabs"` | Text-to-speech backend |
| `voice.synthesis.elevenLabsApiKey` | string | `""` | ElevenLabs API key |
| `voice.synthesis.voiceId` | string | `"pNInz6obpgDQGcFmaJgB"` | ElevenLabs voice ID |

---

## Environment Variable Notes

Lil Dude does **not** read API keys from environment variables. All configuration lives in `~/.lil-dude/config.json`. This is by design -- it prevents accidental key leakage through process environment inheritance.

The security sandbox actively strips all sensitive environment variables (`*API_KEY*`, `*SECRET*`, `*TOKEN*`, etc.) from child processes to prevent key exfiltration through shell commands.
