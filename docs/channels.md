# Channels

Channels are the messaging platforms that Lil Dude connects to. Each channel is implemented as a **ChannelAdapter** -- a thin bridge that normalizes inbound messages into a common format and sends outbound responses through the platform's API.

Channel adapters contain no business logic. They only handle message normalization, platform-specific formatting (message splitting, markdown escaping, buttons), and connection lifecycle.

---

## Channel Table

| Channel | Type | Auth Required | Platform Restrictions | Default Enabled |
|---------|------|---------------|----------------------|-----------------|
| Discord | `discord` | Bot token | None | No |
| Telegram | `telegram` | Bot token | None | No |
| iMessage | `imessage` | None (macOS login) | macOS only | No |
| Slack | `slack` | Bot token + App token | None | No |
| WhatsApp | `whatsapp` | Bridge library | None | No |
| Signal | `signal` | signal-cli + phone number | signal-cli installed | No |
| WebChat | `webchat` | None | None | Yes |
| CLI | `cli` | None | None | Built-in |

---

## ChannelAdapter Interface

Every channel adapter implements this interface:

```typescript
interface ChannelAdapter {
  readonly name: string;
  readonly type: ChannelType;
  connect(config: ChannelConfig): Promise<void>;
  onMessage(handler: (msg: ChannelMessage) => Promise<void>): void;
  send(channelId: string, text: string, options?: SendOptions): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
}
```

**`connect(config)`**: Initialize the adapter with platform-specific configuration (tokens, allowFrom lists, etc.).

**`onMessage(handler)`**: Register the callback that the orchestrator uses to receive inbound messages. The handler receives a normalized `ChannelMessage`.

**`send(channelId, text, options)`**: Send a text response to a channel. Options support reply threading, buttons (for approval flows), parse mode (markdown/HTML/plain), and silent mode.

**`disconnect()`**: Clean up resources and close connections.

**`isConnected()`**: Check if the adapter is currently active.

### ChannelMessage Format

All inbound messages are normalized to:

```typescript
interface ChannelMessage {
  id: string;              // Unique ID (nanoid)
  channelType: ChannelType;
  channelId: string;       // Platform-specific channel/chat ID
  userId: string;          // Platform-specific user ID
  text: string;            // Message text content
  attachments: Attachment[];
  replyToMessageId?: string;
  timestamp: Date;
  raw?: unknown;           // Original platform message (for debugging)
}
```

---

## Discord

### Setup

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Click "New Application" and give it a name
3. Go to the "Bot" section and click "Add Bot"
4. Under "Privileged Gateway Intents", enable:
   - **Message Content Intent**
   - **Server Members Intent** (optional, for user filtering)
5. Copy the bot token
6. Go to "OAuth2" > "URL Generator", select the `bot` scope with permissions:
   - Send Messages
   - Read Message History
   - Add Reactions
7. Use the generated URL to add the bot to your server

### Configuration

```json
{
  "channels": {
    "discord": {
      "enabled": true,
      "token": "YOUR_BOT_TOKEN",
      "allowFrom": ["123456789012345678"]
    }
  }
}
```

**`token`** (required): Your Discord bot token.

**`allowFrom`** (optional): Array of Discord user IDs. If empty, accepts messages from all users. If populated, only listed user IDs can interact with the bot.

### Features

- Automatic message splitting at 2,000 characters (Discord's limit)
- Splits on newlines when possible, falls back to space boundaries
- Button components for approval queue integration
- DM and server channel support
- Bot messages are automatically ignored (prevents self-reply loops)

---

## Telegram

### Setup

1. Open Telegram and message [@BotFather](https://t.me/BotFather)
2. Send `/newbot` and follow the prompts to create your bot
3. Copy the bot token BotFather gives you
4. Optionally send `/setprivacy` and choose "Disable" if you want the bot to see all messages in groups (not just commands)

### Configuration

```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "token": "YOUR_BOT_TOKEN",
      "allowFrom": ["123456789"]
    }
  }
}
```

**`token`** (required): Your Telegram bot token from BotFather.

**`allowFrom`** (optional): Array of Telegram user IDs (as strings). If empty, accepts messages from all users.

### Features

- Message splitting at 4,096 characters (Telegram's limit)
- MarkdownV2 and HTML parse modes
- Inline keyboard buttons for approval flows
- Rate limiting (minimum 50ms between sends to avoid Telegram's rate limits)
- Reply threading via `reply_parameters`
- Silent message support (`disable_notification`)

---

## Slack

### Setup

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and create a new app
2. Under "Socket Mode", enable Socket Mode and generate an **App-Level Token** with the `connections:write` scope
3. Under "OAuth & Permissions", add these bot token scopes:
   - `chat:write`
   - `channels:history`
   - `groups:history`
   - `im:history`
   - `mpim:history`
4. Under "Event Subscriptions", subscribe to `message.channels`, `message.groups`, `message.im`, `message.mpim`
5. Install the app to your workspace and copy the **Bot User OAuth Token**
6. Install `@slack/bolt` as a dependency: `npm install @slack/bolt`

### Configuration

```json
{
  "channels": {
    "slack": {
      "enabled": true,
      "token": "xoxb-YOUR-BOT-TOKEN",
      "appToken": "xapp-YOUR-APP-TOKEN",
      "allowFrom": ["U0123456789"]
    }
  }
}
```

**`token`** (required): Bot User OAuth Token (`xoxb-...`).

**`appToken`** (required): App-Level Token (`xapp-...`) for Socket Mode.

**`allowFrom`** (optional): Array of Slack user IDs. If empty, accepts messages from all users.

### Features

- Socket Mode connection (no public URL needed)
- Message splitting at 3,000 characters (conservative limit within Slack's 4,000)
- Block Kit button components for approval flows
- Thread reply support via `thread_ts`
- Rate limiting (1,000ms minimum between sends)

---

## iMessage

### Setup

iMessage is macOS-only. It works by:

- **Sending**: AppleScript commands via `osascript` to the Messages app
- **Receiving**: Polling the iMessage SQLite database at `~/Library/Messages/chat.db` (read-only)

Requirements:

1. macOS with the Messages app configured and signed in to iMessage
2. Full Disk Access permission for the terminal or app running Lil Dude (System Settings > Privacy & Security > Full Disk Access)

On non-macOS platforms, the adapter logs a warning and skips initialization gracefully.

### Configuration

```json
{
  "channels": {
    "imessage": {
      "enabled": true
    }
  }
}
```

No token is needed. The `allowFrom` filter is supported but not exposed in the schema -- messages from all contacts are accepted by default.

### Features

- Polls for new messages every 5 seconds
- Only processes messages received after the adapter connects (no historical backfill)
- Handles phone numbers and email addresses as recipient identifiers
- Gracefully degrades on non-macOS platforms

---

## WhatsApp

### Setup

WhatsApp requires a bridge library. Lil Dude defines a `WhatsAppConnection` interface that can be satisfied by:

- [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js)
- [@whiskeysockets/baileys](https://github.com/WhiskeySockets/Baileys)
- A custom implementation

1. Install your chosen library: `npm install whatsapp-web.js`
2. Create a connection implementation that satisfies the `WhatsAppConnection` interface
3. The first time you connect, you will need to scan a QR code with your phone

### Configuration

```json
{
  "channels": {
    "whatsapp": {
      "enabled": true,
      "allowFrom": ["+1234567890@c.us"]
    }
  }
}
```

**`allowFrom`** (optional): Array of WhatsApp phone numbers. If empty, accepts messages from all contacts.

### Features

- Message splitting at 4,096 characters
- Rate limiting (500ms minimum between sends)
- Group and direct message support
- Dependency injection for the connection library (testable)

---

## Signal

### Setup

Signal requires [signal-cli](https://github.com/AsamK/signal-cli) installed on your system.

1. Install signal-cli: Follow the [signal-cli installation guide](https://github.com/AsamK/signal-cli#installation)
2. Register or link a phone number with signal-cli:
   ```bash
   signal-cli -u +1234567890 register
   signal-cli -u +1234567890 verify CODE
   ```
3. Provide a `SignalConnection` implementation that wraps signal-cli's JSON RPC interface

### Configuration

```json
{
  "channels": {
    "signal": {
      "enabled": true,
      "phoneNumber": "+1234567890",
      "allowFrom": ["+0987654321"]
    }
  }
}
```

**`phoneNumber`** (required): The phone number registered with signal-cli.

**`allowFrom`** (optional): Array of phone numbers. If empty, accepts messages from all contacts.

### Features

- Message splitting at 4,096 characters
- Group and direct message support
- Dependency injection for the signal-cli connection (testable)

---

## WebChat

### Setup

WebChat is built into Lil Dude and enabled by default. It uses WebSocket connections through the gateway server. No external setup is required.

The web panel is served by the gateway's HTTP server and connects via WebSocket on the configured ports.

### Configuration

```json
{
  "channels": {
    "webchat": {
      "enabled": true
    }
  }
}
```

### Features

- WebSocket-based real-time messaging
- Built-in web UI served by the gateway
- No external dependencies or tokens required
- Multiple simultaneous client connections
- Streaming response support

---

## CLI

### Setup

The CLI channel is always available. It is the built-in interactive mode when you run Lil Dude from the terminal.

```bash
lil-dude
```

No configuration is needed. The CLI adapter reads from stdin and writes to stdout.

### Features

- Interactive terminal interface
- Streaming output display
- Built-in -- no configuration or tokens required
