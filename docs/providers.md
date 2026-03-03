# Providers

Lil Dude supports 5 LLM providers with intelligent model routing. The system classifies message complexity, selects the cheapest model that can handle the task, and learns from user feedback to improve routing over time.

---

## Provider Table

| Provider | Model | Tier | Context Window | Input/1K tokens | Output/1K tokens | Cached Input/1K | Tools |
|----------|-------|------|----------------|-----------------|-------------------|-----------------|-------|
| **Anthropic** | claude-haiku-4-5-20251001 | small | 200,000 | $0.0010 | $0.0050 | $0.0001 | Yes |
| **Anthropic** | claude-sonnet-4-5-20250929 | medium | 200,000 | $0.0030 | $0.0150 | $0.0003 | Yes |
| **Anthropic** | claude-opus-4-6 | large | 200,000 | $0.0150 | $0.0750 | $0.0015 | Yes |
| **OpenAI** | gpt-4o-mini | small | 128,000 | $0.00015 | $0.0006 | $0.000075 | Yes |
| **OpenAI** | gpt-4o | medium | 128,000 | $0.0025 | $0.0100 | $0.00125 | Yes |
| **OpenAI** | gpt-4.1 | medium | 1,000,000 | $0.0020 | $0.0080 | $0.0010 | Yes |
| **Gemini** | gemini-2.0-flash | small | 1,000,000 | $0.0001 | $0.0004 | $0.000025 | Yes |
| **Gemini** | gemini-2.0-pro | medium | 1,000,000 | $0.00125 | $0.0050 | $0.000315 | Yes |
| **Gemini** | gemini-1.5-pro | medium | 2,000,000 | $0.00125 | $0.0050 | $0.000315 | Yes |
| **DeepSeek** | deepseek-chat | small | 64,000 | $0.00014 | $0.00028 | $0.00007 | Yes |
| **Ollama** | ollama/llama3.2 | small | 8,192 | $0.00 | $0.00 | $0.00 | No |
| **Ollama** | ollama/qwen2.5 | small | 32,768 | $0.00 | $0.00 | $0.00 | Yes |

Prices are in USD per 1,000 tokens.

---

## Model Tiers

Models are classified into three tiers that map to task complexity:

| Tier | Purpose | Preferred Models (in order) |
|------|---------|----------------------------|
| **small** | Simple queries, parameter extraction, deterministic wave execution | Claude Haiku 4.5, GPT-4o-mini, Gemini 2.0 Flash, DeepSeek Chat, Ollama |
| **medium** | Moderate complexity, multi-step planning, non-deterministic waves | Claude Sonnet 4.5, GPT-4o, Gemini 2.0 Pro, GPT-4.1 |
| **large** | Complex analysis, thorough reasoning, detailed content creation | Claude Opus 4.6, GPT-4o, Claude Sonnet 4.5 |

The router selects the first available model in the preference list for each tier. A model is "available" if its provider is enabled (has a valid API key or is a local Ollama model).

---

## Model Routing

### Complexity Classification

The router uses deterministic heuristics (no LLM call) to classify message complexity:

| Signal | Classification |
|--------|---------------|
| Word count < 20, no question mark | `small` |
| Word count < 20 with question mark | `small` |
| Word count 20-100, no complexity keywords | `medium` |
| Word count > 100 | `large` |
| Contains keywords: "analyze", "compare", "comprehensive", "detailed", "write a", "create a", "thorough", "in-depth", "exhaustive", "step by step", "multi-step", "explain in detail" | `large` |
| Contains multi-step indicators (numbered lists with 2+ items, 2+ bullet points, 2+ chain words like "then", "after that", "next", "finally") | `large` |

### Routing Flow

1. **Classify**: Determine the model tier from the message text
2. **Select**: Walk the tier preference list and pick the first model whose provider is enabled
3. **Budget check**: Estimate cost and verify `canAfford()` before calling the LLM
4. **Execute**: Send the request to the selected provider
5. **Track**: Record token usage and cost for budget monitoring

---

## Quality-Aware Routing

Lil Dude learns from user feedback to improve model selection over time.

### How It Works

1. After each task, users can rate the response (thumbs up/down)
2. Ratings are stored per model and optional task type
3. When routing, the system checks each model's quality statistics:
   - **Boost**: Models with average score >= 0.8 (with 5+ ratings) get priority boost (-100 to sort order)
   - **Penalize**: Models with average score < 0.4 (with 5+ ratings) get deprioritized (+100 to sort order)
4. Models with fewer than 5 ratings use the default heuristic ordering

This means a model that consistently produces poor results for a specific task type will be automatically deprioritized in favor of alternatives, without requiring configuration changes.

---

## Provider Configuration

### Anthropic

```json
{
  "providers": {
    "anthropic": {
      "apiKey": "sk-ant-...",
      "enabled": true
    }
  }
}
```

Get your API key at [console.anthropic.com](https://console.anthropic.com/).

### OpenAI

```json
{
  "providers": {
    "openai": {
      "apiKey": "sk-...",
      "enabled": true
    }
  }
}
```

Get your API key at [platform.openai.com](https://platform.openai.com/).

### Gemini

```json
{
  "providers": {
    "gemini": {
      "apiKey": "AIza...",
      "enabled": true
    }
  }
}
```

Get your API key at [aistudio.google.com](https://aistudio.google.com/).

### DeepSeek

DeepSeek uses an OpenAI-compatible API. The adapter is the same `OpenAIProvider` class with a custom base URL.

```json
{
  "providers": {
    "deepseek": {
      "apiKey": "sk-...",
      "enabled": true,
      "apiBase": "https://api.deepseek.com"
    }
  }
}
```

Get your API key at [platform.deepseek.com](https://platform.deepseek.com/).

### Ollama (Local)

Ollama requires no API key. It runs entirely on your machine at zero cost.

```json
{
  "providers": {
    "ollama": {
      "enabled": true,
      "baseUrl": "http://localhost:11434",
      "model": "llama3.2"
    }
  }
}
```

---

## Ollama: Zero-Cost Local Fallback

Ollama is the only provider that requires no API key and incurs zero cost. It serves as:

- **Cost fallback**: When budget is tight, small-tier tasks route to Ollama
- **Offline operation**: Works without internet for basic tasks
- **Privacy guarantee**: All inference happens locally -- no data leaves your machine

### How Ollama Works in Lil Dude

1. The Ollama provider communicates with the Ollama REST API via raw `fetch` calls (no SDK dependency)
2. The configured model is registered with the router at startup
3. Ollama models are only placed in the **small** tier -- they do not participate in medium or large tier routing
4. All responses are tracked with zero cost (`$0.00` per token)
5. The provider handles NDJSON streaming, tool call parsing, and malformed JSON repair

### Small Model Safeguards for Ollama

Because local models are less capable at structured output, Lil Dude applies extra safeguards:

**Tool Input Validation**: Before executing any tool call, the system checks that all required parameters are present and types match.

**Malformed JSON Repair**: Small models sometimes embed tool calls in plain text or produce malformed JSON. The system:
- Strips markdown code fences (```` ```json ... ``` ````)
- Removes trailing commas before `}` and `]`
- Replaces single quotes with double quotes (when no double quotes exist)
- Extracts tool call JSON embedded in text content when the model does not use the structured `tool_calls` field

**Auto-Escalation**: After 2 consecutive tool call failures from a small model, the tool guard escalates to a medium-tier model. After 3 consecutive failures at any tier, the task halts.

### Recommended Ollama Models

| Model | Parameters | Recommended For | Tool Support |
|-------|-----------|----------------|--------------|
| llama3.2 | 3B-11B | `observe` and `create` waves | No (text extraction fallback) |
| qwen2.5 | 7B-72B | `observe` and `create` waves, basic tool use | Yes |
| phi3 | 3.8B | Simple observe waves, parameter extraction | Limited |
| mistral | 7B | General `observe` waves | Limited |

**Minimum recommendations**:
- **7B+ parameters** for `observe` and `create` waves
- **13B+ parameters** for `modify` and `execute` waves (though these always require medium+ models via cloud providers at security level 3)
