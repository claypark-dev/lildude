# Waves

Waves are Lil Dude's extensible capability modules -- the plugin system that gives the assistant its skills. Each wave encapsulates a specific capability (web search, calendar management, stock monitoring, etc.) and declares exactly what permissions it needs, what safety tier it operates at, and what triggers activate it.

## Core Concepts

A wave is a self-contained module that:

- Declares its capabilities and permissions in a **manifest** (`wave.json`)
- Responds to **trigger keywords** in user messages
- Can run **deterministically** (1 LLM call for parameter extraction, then direct execution) or through a **full planning path** (LLM plans steps, then executes)
- Is classified into a **safety tier** that controls what security level and model tier combinations can run it
- Always checks **canAfford()** before making any LLM call

---

## Safety Tiers

Every wave declares a safety tier that describes the maximum impact it can have on the outside world. Safety tiers are ordered from least to most dangerous:

| Tier | Description | Examples | Minimum Model Tier |
|------|-------------|----------|--------------------|
| `observe` | Read-only data retrieval. No side effects. | Web search, stock price lookup, weather check | `small` |
| `create` | Creates new content that did not exist before. Does not modify existing data. | Draft email, create calendar event, generate reminders | `small` |
| `modify` | Changes existing data or state. | Edit calendar event, update a file, rename items | `medium` |
| `destroy` | Deletes data or removes state permanently. | Delete files, remove calendar events, clear data | `large` |
| `execute` | Runs shell commands or executes arbitrary code. Highest risk. | Shell scripts, code execution, system automation | `medium` (level 4+) or `large` |

---

## Safety Tier and Security Level Interaction

The safety tier of a wave interacts with two other systems to produce an access decision:

1. **Security Level** (1-5): The user's chosen paranoia setting (see [Security](security.md))
2. **Model Tier** (`small`, `medium`, `large`): The capability class of the model handling the request

### Decision Matrix

The table below shows the decision (`allow`, `confirm`, `block`) for each combination of security level, wave safety tier, and model tier:

| Security Level | observe (small) | observe (medium) | observe (large) | create (small) | create (medium) | create (large) | modify (medium) | modify (large) | destroy (large) | execute (medium) | execute (large) |
|----------------|-----------------|-------------------|-----------------|----------------|-----------------|----------------|-----------------|----------------|-----------------|------------------|-----------------|
| 1 - Tin Foil Hat | allow | allow | allow | block | block | block | block | block | block | block | block |
| 2 - Careful | allow | allow | allow | confirm | allow | allow | block | block | block | block | block |
| 3 - Balanced | allow | allow | allow | allow | allow | allow | confirm | allow | block | block | block |
| 4 - Trusting | allow | allow | allow | allow | allow | allow | allow | allow | confirm | confirm | allow |
| 5 - YOLO | allow | allow | allow | allow | allow | allow | allow | allow | allow | allow | allow |

Key rules:

- **`observe` waves** are always allowed at every level (they are read-only).
- **`create` waves** require at least security level 2 with confirmation, or level 3+ for auto-allow with small models.
- **`modify` waves** require at least a medium-tier model and security level 3+ (with confirmation at level 3).
- **`destroy` waves** require a large-tier model and security level 4+ (with confirmation at level 4).
- **`execute` waves** require at least security level 4 with confirmation, or level 5 for auto-allow.
- Small models are never allowed to run `modify`, `destroy`, or `execute` waves.

---

## Built-in Waves

Lil Dude ships with several built-in waves:

| Wave | Safety Tier | Deterministic | Description |
|------|-------------|---------------|-------------|
| `web-search` | `observe` | Yes | Search the web and return summarized results |
| `google-calendar` | `modify` | No | Read, create, edit, and delete calendar events |
| `reminders` | `create` | Yes | Set and manage time-based reminders |
| `stock-monitor` | `observe` | Yes | Track stock prices and set alerts |
| `google-flights` | `observe` | Yes | Search for flight prices and schedules |

Deterministic waves use a single small-model LLM call to extract parameters, then execute directly without further LLM involvement. This minimizes cost and latency.

---

## Wave Manifest Format

Every wave must include a `wave.json` manifest validated against the `WaveManifestSchema`. Here is the full structure:

```json
{
  "name": "stock-monitor",
  "version": "1.0.0",
  "description": "Track stock prices and set price alerts",
  "author": "lil-dude",
  "safetyTier": "observe",
  "permissions": {
    "domains": ["api.polygon.io", "finnhub.io"],
    "shell": [],
    "directories": [],
    "requiresBrowser": false,
    "requiresOAuth": []
  },
  "triggers": ["stock", "price", "ticker", "shares", "market"],
  "deterministic": true,
  "tools": [
    {
      "name": "get_stock_price",
      "description": "Get the current price for a stock ticker",
      "parameters": {
        "type": "object",
        "properties": {
          "ticker": { "type": "string", "description": "Stock ticker symbol" }
        },
        "required": ["ticker"]
      }
    }
  ],
  "minTier": "basic",
  "entryPoint": "index.js"
}
```

### Manifest Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Unique wave identifier |
| `version` | string | Yes | Semver version string |
| `description` | string | Yes | Human-readable description |
| `author` | string | Yes | Author name or organization |
| `safetyTier` | string | No | One of: `observe`, `create`, `modify`, `destroy`, `execute`. Defaults to `observe` if omitted. |
| `permissions.domains` | string[] | Yes | Outbound domains this wave needs access to |
| `permissions.shell` | string[] | Yes | Shell binaries this wave may execute |
| `permissions.directories` | string[] | Yes | Filesystem paths this wave may access |
| `permissions.requiresBrowser` | boolean | Yes | Whether the wave needs browser automation |
| `permissions.requiresOAuth` | string[] | Yes | OAuth providers needed (e.g., `["google"]`) |
| `triggers` | string[] | Yes | Keywords that activate this wave (at least one) |
| `deterministic` | boolean | Yes | If `true`, uses 1 LLM call + direct execution. If `false`, uses full plan+execute path. |
| `tools` | array | No | Tool definitions the wave provides |
| `minTier` | string | Yes | Minimum subscription tier: `basic`, `standard`, or `power` |
| `entryPoint` | string | Yes | Path to the wave's main JavaScript module |

---

## Wave Trigger Matching

When a user sends a message, Lil Dude checks it against all registered wave triggers:

1. Each wave's trigger keywords are matched case-insensitively against the message text.
2. A **match score** is computed based on:
   - **Coverage ratio**: total character length of matching triggers divided by message length
   - **Count bonus**: `min(matching_trigger_count * 0.1, 0.5)`
3. The wave with the highest score is selected for execution.
4. If no triggers match, the message is handled by the general agent loop.

---

## Wave Execution Paths

### Deterministic Path (1 LLM call)

Used when `deterministic: true` in the manifest:

1. Select a **small** model for parameter extraction
2. Check `canAfford()` with the estimated cost
3. Make a single LLM call to extract parameters from the user message
4. Build a `WavePlan` from the extracted parameters
5. Call `wave.execute(plan)` directly -- no further LLM involvement
6. Optionally validate the result with `wave.validate()`

### Non-Deterministic Path (2+ LLM calls)

Used when `deterministic: false`:

1. Select a **medium** model for planning
2. Check `canAfford()` before the planning call
3. Call `wave.plan()` to generate a `WavePlan` with multiple steps
4. Check `canAfford()` again before execution
5. Call `wave.execute(plan)` with the generated plan
6. Optionally validate the result

---

## Installing Waves

### From GitHub

```bash
lil-dude wave install github:username/wave-name
```

The CLI clones the repository, validates the manifest against the `WaveManifestSchema`, checks declared permissions against your security level, and registers the wave.

### From Wave Hub

```bash
lil-dude wave install hub:wave-name
```

Wave Hub is the curated registry of community waves. All waves on the Hub have been through security scanning (static analysis of declared permissions, AST scanning of source code).

### CLI Commands

| Command | Description |
|---------|-------------|
| `lil-dude wave install <source>` | Install a wave from GitHub or Wave Hub |
| `lil-dude wave list` | List all installed waves with their safety tiers |
| `lil-dude wave search <query>` | Search Wave Hub for waves matching a query |
| `lil-dude wave uninstall <name>` | Remove an installed wave |

---

## Shorebreak: Dynamic Wave Generation

Shorebreak is Lil Dude's ability to generate new waves on the fly when it detects a capability gap. The process follows a strict pipeline:

### 1. Gap Detection

When the user requests something that no existing wave can handle, the orchestrator identifies the capability gap.

### 2. Template Match

Shorebreak first checks if the request matches a known wave template (common patterns like "monitor X" or "search Y"). Templates are pre-validated and minimize the need for free-form generation.

### 3. Free-Form Fallback

If no template matches, the LLM generates wave source code and a manifest from scratch. The generated code must declare a valid `safetyTier`.

### 4. AST Scan

The generated source code is parsed into an Abstract Syntax Tree and scanned for:

- Use of undeclared domains, binaries, or directories
- Attempts to access filesystem paths outside declared permissions
- Network calls to undeclared endpoints
- Any code patterns that contradict the declared safety tier

### 5. User Approval

The generated wave manifest and a summary of its capabilities are presented to the user for explicit approval. The user sees:

- Wave name and description
- Declared safety tier
- Required permissions (domains, shell, directories)
- Whether it passed the AST scan

### 6. Sandbox Test

After approval, the wave is executed in a sandboxed environment with restricted permissions to verify it works correctly.

### 7. Registration

If the sandbox test passes, the wave is registered in the wave registry and available for future use. Generated waves track their usage count and success rate.

---

## Wave Hub

Wave Hub is the curated community registry for Lil Dude waves. It provides:

- **Security scanning**: Every submitted wave undergoes static analysis, AST scanning, and permission verification
- **Safety tier verification**: The declared safety tier is validated against actual code behavior
- **Version management**: Waves are versioned and updates are reviewed
- **Search and discovery**: Browse and search waves by category, safety tier, or keyword
- **Trust scores**: Community ratings and usage statistics

Waves on the Hub must pass all security checks before being listed. The Hub never hosts waves that declare a lower safety tier than their code actually requires.

---

## Developing Custom Waves

This section walks through creating, testing, and publishing a wave from scratch.

### Project Structure

A wave is a directory containing at minimum:

```
my-wave/
  wave.json      # Manifest (required)
  index.js       # Entry point (required)
```

### Entry Point Contract

Your `index.js` must export three async functions:

```javascript
/**
 * Plan the execution of this wave.
 * @param {string} input - The user's message text.
 * @param {object} ctx   - Context: { contactId, trustLevel, conversationId }.
 * @returns {{ steps: Array, estimatedCostUsd: number, isDeterministic: boolean, extractedParams: object }}
 */
export async function plan(input, ctx) {
  return {
    steps: [{ type: 'compute', description: 'Calculate result' }],
    estimatedCostUsd: 0,
    isDeterministic: true,
    extractedParams: { query: input },
  };
}

/**
 * Execute the planned wave.
 * @param {object} wavePlan - The plan returned by plan().
 * @returns {{ success: boolean, output: string, metadata?: object }}
 */
export async function execute(wavePlan) {
  const result = doWork(wavePlan.extractedParams);
  return {
    success: true,
    output: JSON.stringify(result),
    metadata: { waveId: 'my-wave' },
  };
}

/**
 * Validate the execution result (optional but recommended).
 * @param {object} result - The result returned by execute().
 * @returns {{ valid: boolean, feedback?: string }}
 */
export async function validate(result) {
  if (result.success) {
    return { valid: true };
  }
  return { valid: false, feedback: result.error || 'Execution failed' };
}
```

### Design Rules

1. **Deterministic first**: If the wave can run without LLM calls beyond parameter extraction, set `"deterministic": true`. This is cheaper and faster.
2. **Declare all permissions**: Every domain, shell binary, and directory the wave touches must be in the manifest. Undeclared access is blocked by the security scanner.
3. **Keep it focused**: One wave = one capability. Split multi-feature modules into separate waves.
4. **Handle errors gracefully**: Always return `{ success: false, output: errorMessage }` instead of throwing.
5. **No secrets in code**: Never hardcode API keys. Use the context object or environment variables.

### Testing Your Wave

```bash
# Validate the manifest
node -e "
  import('./src/waves/schema.js').then(m => {
    const manifest = JSON.parse(require('fs').readFileSync('my-wave/wave.json', 'utf-8'));
    console.log(m.validateManifest(manifest));
  });
"

# Run the security scanner
node -e "
  import('./src/waves/security-scanner.js').then(m => {
    const code = require('fs').readFileSync('my-wave/index.js', 'utf-8');
    console.log(m.scanWaveCode(code));
  });
"
```

---

## Trust Levels and External Users

When external users interact with Lil Dude, wave access is gated by their **trust level**:

| Trust Level | Allowed Safety Tiers | Notes |
|-------------|---------------------|-------|
| `owner` | All tiers | Full access to every wave |
| `trusted` | `observe`, `create`, `modify` | Cannot run `destroy` or `execute` waves |
| `known` | `observe` only | Read-only interactions |
| `unknown` | None | Cannot trigger any waves; messaging only |

Per-contact wave allowlists can further restrict access. If a contact has `permittedWaves` configured, only those specific waves are available regardless of trust level.

---

## Manifest Signing and Verification

Waves published through the official registry are signed with HMAC-SHA256. Signed waves display a "Verified" badge in the Wave Hub.

### How It Works

1. The registry CI pipeline generates an HMAC signature of the `wave.json` content using a shared secret key.
2. The signature is stored in a `.wave-signature` file alongside the manifest.
3. When Lil Dude installs the wave, it verifies the signature against the manifest.

### Signature File Format

```json
{
  "signature": "a1b2c3d4e5f6...",
  "algorithm": "sha256",
  "signer": "lildude-ci",
  "signedAt": "2024-01-15T10:30:00.000Z"
}
```

Unsigned waves still install with a warning. Tampered manifests (where the content no longer matches the signature) are rejected.

---

## Community Wave Registry

The community wave registry lives at `lildude-community/wave-registry` on GitHub. It is a JSON index that Lil Dude queries for discovery and updates.

### Registry Structure

```
wave-registry/
  registry.json                     # Main index of all published waves
  schemas/wave-entry.schema.json    # Validation schema for registry entries
  .github/workflows/validate-pr.yml # CI pipeline for wave submissions
```

### Submitting a Wave

1. Create your wave in its own GitHub repository (e.g., `yourname/wave-my-tool`).
2. Ensure `wave.json` passes manifest validation and `index.js` passes the security scanner with zero critical findings.
3. Fork `lildude-community/wave-registry`.
4. Add an entry to `registry.json`:

```json
{
  "name": "my-tool",
  "version": "1.0.0",
  "description": "What your wave does",
  "author": "yourname",
  "repo": "github:yourname/wave-my-tool",
  "category": "utilities",
  "safetyTier": "observe",
  "verified": false,
  "tags": ["keyword1", "keyword2"]
}
```

5. Open a pull request. The CI pipeline will:
   - Clone your wave repo
   - Validate the manifest against `WaveManifestSchema`
   - Run `scanWaveCode()` on all JavaScript files
   - Report any security findings
6. If the scan passes with zero critical findings, maintainers review and merge. The `verified` field is set to `true` and the manifest is signed.

### Update Checking

Lil Dude periodically checks the registry for updates to installed waves:

```
GET /api/v1/hub/updates
```

Returns a list of waves with newer versions available. Users can update via the Wave Hub page or CLI:

```bash
lil-dude wave update <name>
```

---

## Bundled External Waves

These waves are designed for external user interactions:

| Wave | Safety Tier | Description |
|------|-------------|-------------|
| `availability-check` | `observe` | Returns the owner's free time slots (without event details) |
| `meeting-request` | `create` | External user proposes a meeting time; owner approves |
| `contact-share` | `observe` | Shares the owner's preferred contact methods |
| `message-relay` | `create` | Leaves a message for the owner with urgency tagging |
| `auto-responder` | `observe` | Replies with the owner's away message (deterministic) |

These waves respect privacy by design — `availability-check` returns time slots only, never event titles or details.
