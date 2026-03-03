# Local Models

Lil Dude is designed to work safely with local models through Ollama. Unlike other AI assistants that assume a cloud-hosted model with strong instruction following, Lil Dude's architecture makes every model safe by matching capabilities to safety tiers. This is a core differentiator.

**The key insight**: local models are less reliable at structured output (tool calls, JSON formatting) and more susceptible to producing unsafe actions. Rather than hoping the model "gets it right," Lil Dude constrains what local models are allowed to do based on their capability tier.

---

## How Safety Tiers Enable Local Models

Every wave (plugin) declares a safety tier that describes its maximum impact:

| Safety Tier | Impact | Local Model Eligible? |
|-------------|--------|----------------------|
| `observe` | Read-only. No side effects. | Yes -- small models can run these. |
| `create` | Creates new content. No modifications. | Yes -- small models can run these at security level 3+. |
| `modify` | Changes existing data. | No -- requires medium+ model. |
| `destroy` | Deletes data permanently. | No -- requires large model. |
| `execute` | Runs arbitrary code. | No -- requires medium+ at level 4+. |

Local Ollama models are classified as **small tier**. They can only be assigned to `observe` and `create` waves. The router never sends a local model to handle `modify`, `destroy`, or `execute` operations.

---

## The Full Decision Matrix

The table below shows the complete interaction between security level, wave safety tier, and model tier. Local models (Ollama) are always in the `small` column.

| Security Level | observe + small | observe + medium | observe + large | create + small | create + medium | create + large | modify + medium | modify + large | destroy + large | execute + medium | execute + large |
|----------------|-----------------|-------------------|-----------------|----------------|-----------------|----------------|-----------------|----------------|-----------------|------------------|-----------------|
| **1 - Tin Foil Hat** | allow | allow | allow | block | block | block | block | block | block | block | block |
| **2 - Careful** | allow | allow | allow | confirm | allow | allow | block | block | block | block | block |
| **3 - Balanced** | allow | allow | allow | allow | allow | allow | confirm | allow | block | block | block |
| **4 - Trusting** | allow | allow | allow | allow | allow | allow | allow | allow | confirm | confirm | allow |
| **5 - YOLO** | allow | allow | allow | allow | allow | allow | allow | allow | allow | allow | allow |

### What This Means for Local Models

- **Security Level 1**: Local models can only run `observe` waves (read-only lookups).
- **Security Level 2**: Local models run `observe` waves freely. `create` waves require user confirmation.
- **Security Level 3 (default)**: Local models run both `observe` and `create` waves without confirmation.
- **Security Level 4-5**: Same as level 3 for local models (they still cannot access higher-tier waves).

The critical point: **small models never run modify, destroy, or execute waves regardless of security level**. Those always require medium or large cloud models.

---

## Which Waves Work with Small Models

Out of the box, these built-in waves work with local Ollama models at security level 3+:

| Wave | Safety Tier | Works with Local Models |
|------|-------------|------------------------|
| `web-search` | observe | Yes |
| `stock-monitor` | observe | Yes |
| `google-flights` | observe | Yes |
| `reminders` | create | Yes |
| `google-calendar` | modify | No -- routes to cloud model |

Community waves that declare `observe` or `create` safety tiers will also work with local models.

---

## Automatic Escalation

When a local model fails at tool use, Lil Dude does not keep retrying with the same model. The **tool guard** monitors consecutive failures and escalates:

### Escalation Flow

1. **First failure**: Retry with the same small model. The tool guard records the failure.
2. **Second consecutive failure**: The tool guard triggers escalation. The task is re-routed to a **medium-tier cloud model** (e.g., Claude Sonnet 4.5 or GPT-4o).
3. **Third consecutive failure** (at any tier): The task is halted with an error message to the user.

### What Triggers a Failure

- Tool call returns an error
- Required parameters are missing after extraction
- JSON parsing fails even after repair attempts
- The model produces no tool call when one was expected

### Escalation Decision

```typescript
interface ToolGuardDecision {
  shouldContinue: boolean;    // Keep going or stop?
  shouldEscalate: boolean;    // Switch to a better model?
  recommendedTier?: ModelTier; // Which tier to escalate to
  reason: string;             // Human-readable explanation
}
```

Once escalated, the task stays on the higher-tier model for the remainder of execution. The escalation flag is per-task, so future tasks start fresh with the local model.

---

## Tool Input Validation

Before executing any tool call from a small model, Lil Dude validates the inputs:

**Required parameter check**: Every parameter marked as `required` in the tool schema must be present. If a required parameter is missing, the call is rejected and counted as a failure.

**Type checking**: Parameter values are checked against their declared types. A `string` field must contain a string, a `number` field must be numeric, etc.

**Structural validation**: The overall input must be a valid JSON object. Nested structures are validated recursively against the schema.

This validation happens **before** the tool executes, so a malformed tool call from a local model never reaches the underlying system (shell, API, filesystem).

---

## Malformed JSON Repair

Small models frequently produce JSON that is almost correct but has syntax issues. Before failing, Lil Dude attempts automatic repair:

### Repair Steps

1. **Strip markdown code fences**: Models often wrap JSON in ```` ```json ... ``` ````. The repair layer removes these.

2. **Remove trailing commas**: `{"key": "value",}` becomes `{"key": "value"}`.

3. **Replace single quotes**: When the output contains `'key': 'value'` but no double quotes, single quotes are converted to double quotes.

4. **Extract embedded tool calls**: When a model embeds a tool call as plain text instead of using the structured `tool_calls` field, the system attempts to extract it by pattern-matching JSON with `"name"` and `"arguments"` (or `"parameters"` or `"input"`) keys.

### Example

Model outputs:
```
I'll search for that stock price now.
```json
{"name": "get_stock_price", "arguments": {"ticker": "AAPL",}}
```
```

After repair:
```json
{"name": "get_stock_price", "arguments": {"ticker": "AAPL"}}
```

The repaired JSON is then parsed and routed as a normal tool call.

---

## The Security Sandbox

All shell commands go through the permissions engine and process sandbox **regardless of which model initiated them**. This is a hard architectural rule.

Even if a local model somehow produces a dangerous command:

1. The command is **parsed** (not string-matched) into a structured `ParsedCommand`
2. Checked against **dangerous patterns** (fork bombs, recursive deletes, disk writes)
3. Checked against the **binary allowlist/blocklist** for the current security level
4. Checked against **directory access rules**
5. If allowed, executed in a **sandboxed child process** with:
   - Stripped environment (no API keys, tokens, secrets)
   - Restricted PATH (`/usr/local/bin:/usr/bin:/bin`)
   - `shell: false` (prevents shell injection)
   - 30-second timeout
   - 1MB output limit

The sandbox protects against local model hallucinations because the security layer is entirely deterministic -- it does not depend on the model's behavior.

---

## Recommended Minimum Model Sizes

| Use Case | Minimum Parameters | Recommended Models |
|----------|-------------------|-------------------|
| `observe` waves (search, lookup) | 7B+ | llama3.2 (8B), qwen2.5 (7B), mistral (7B) |
| `create` waves (drafts, reminders) | 7B+ | qwen2.5 (7B+), llama3.2 (8B) |
| Parameter extraction (deterministic waves) | 3B+ | phi3 (3.8B), llama3.2 (3B) |
| Tool calling (structured output) | 7B+ | qwen2.5 (7B+) -- best small-model tool support |

For `modify` and `execute` waves: these always require cloud models (medium tier minimum). Local models of any size are not used for these tiers.

---

## Tested Ollama Model Compatibility

| Model | Parameters | Tool Support | JSON Quality | Notes |
|-------|-----------|-------------|-------------|-------|
| **llama3.2** | 3B, 8B, 11B | No native | Moderate | Good for observe waves. Tool calls extracted from text via fallback parser. 8B+ recommended. |
| **qwen2.5** | 7B, 14B, 32B, 72B | Yes (native) | Good | Best small-model tool support. 7B sufficient for observe/create. The router includes this in the small tier. |
| **phi3** | 3.8B | Limited | Moderate | Usable for simple parameter extraction. Not recommended for complex tool chains. |
| **mistral** | 7B | Limited | Moderate | Good general-purpose model. Works for observe waves. Tool calling requires the text extraction fallback. |

### Model Selection Tips

- **qwen2.5** is the recommended default for Ollama users who want tool support
- **llama3.2** works well when tool calling is not needed (simple observe waves)
- Larger parameter counts (14B+) improve JSON quality and reduce the need for repair
- If you have 16GB+ RAM, prefer 13B+ models for more reliable structured output
- All models benefit from the malformed JSON repair -- even good models occasionally produce imperfect JSON

---

## How Lil Dude Differs from Competitors

Most AI assistants assume a capable cloud model and give it full access to tools. When run with a local model, they either fail silently or produce dangerous actions.

Lil Dude takes a different approach: **we make every model safe by matching capabilities to safety tiers**.

1. **Safety tiers constrain what local models can do**: A 7B model cannot delete files or run shell scripts, no matter what it outputs.
2. **Deterministic security layer**: The permissions engine is code, not prompts. It cannot be jailbroken.
3. **Automatic escalation**: When a local model struggles, the system seamlessly escalates to a cloud model -- the user gets a correct result without manual intervention.
4. **Zero-cost fallback**: Observe and create waves running on Ollama cost $0.00, making Lil Dude viable for users who want to minimize spending.
5. **Repair before rejection**: The malformed JSON repair layer gives local models extra chances to succeed before falling back to escalation.

The result: users with a modest local model get a useful, safe assistant for read-only tasks and content creation, with seamless escalation to cloud models when the task demands it.
