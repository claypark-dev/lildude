# 🤙 Lil Dude — Sprint Coding Plan

### Work items designed for individual Claude Code sessions

**How to use this document:**
Each work item (WI) is scoped to be completable in a **single Claude Code session** (typically 30–90 minutes). When you start a Claude Code session, give it:
1. The `CLAUDE.md` file (from the HLD, Section 20)
2. The specific work item from this plan
3. Any files listed in the "Depends On" field

Work items are grouped into **feature groups** within **sprints**. You can work on any WI within a sprint once its dependencies are met. You MUST complete all WIs in a sprint before moving to the next sprint.

**Key for each work item:**
- **ID**: Sprint.Group.Number (e.g., S0.A.1)
- **Session prompt**: Copy-paste this into Claude Code to start the session
- **Creates**: Files that should exist when done
- **Depends on**: Work items that must be completed first
- **Acceptance**: How to verify it's done

---

## Sprint 0 — Foundation

> **Goal:** Bootable project with security, cost, persistence, and config — zero AI features.
> **Estimated sessions:** 10–12
> **Exit criteria:** `npm run build` succeeds, `npm test` passes, `lil-dude doctor` runs.

---

### Feature Group A: Project Scaffolding

#### S0.A.1 — Initialize Project Structure

**Session prompt:**
> Initialize a new TypeScript Node.js project called "lil-dude". Create the full directory structure, package.json, tsconfig.json, vitest.config.ts, .eslintrc, .gitignore, LICENSE (MIT), and README.md. Use ESM modules, TypeScript strict mode. Refer to the HLD Section 4 for exact package.json contents and tsconfig. Create empty index files in each src/ subdirectory so the project structure exists. The project should `npm install` and `npm run build` with zero errors (building empty entry points is fine).

**Creates:**
```
package.json, tsconfig.json, vitest.config.ts, .eslintrc.cjs, .gitignore
LICENSE, README.md, CLAUDE.md
src/index.ts, src/cli.ts, src/errors.ts
src/types/index.ts
src/utils/ src/config/ src/persistence/ src/security/
src/cost/ src/context/ src/channels/ src/tools/
src/skills/ src/orchestrator/ src/gateway/ src/web/
tests/unit/ tests/integration/ tests/mocks/ tests/e2e/
```

**Depends on:** Nothing (first WI)

**Acceptance:**
- [ ] `npm install` completes
- [ ] `npm run build` completes with 0 errors
- [ ] `npm run typecheck` passes
- [ ] Directory structure matches HLD Section 20

---

#### S0.A.2 — Error Types & Shared Types

**Session prompt:**
> Create the error type hierarchy in src/errors.ts and the canonical shared interfaces in src/types/index.ts. Refer to HLD Section 10 (Canonical Interface Definitions) for all interfaces: Message, ContentBlock, ChannelMessage, Attachment, ChannelConfig, SendOptions, ChannelAdapter, LLMProvider, ChatOptions, ChatResponse, StreamChunk, ToolDefinition, ToolResult, Task, ContextPayload, KeyFact, Skill, SkillPlan, SkillStep, ModelSelection. Refer to HLD Section 18 for error types: LilDudeError, SecurityError, BudgetExceededError, ProviderError, ToolExecutionError, TaskKilledError. Export everything. Make sure the project still builds.

**Creates:**
```
src/errors.ts (complete)
src/types/index.ts (complete)
```

**Depends on:** S0.A.1

**Acceptance:**
- [ ] `npm run build` succeeds
- [ ] `npm run typecheck` passes
- [ ] All interfaces from HLD Section 10 are exported
- [ ] All error classes from HLD Section 18 are exported

---

### Feature Group B: Core Utilities

#### S0.B.1 — Logger

**Session prompt:**
> Create src/utils/logger.ts wrapping pino. It should: support child loggers per module (security, cost, gateway, etc.), redact any field matching /key|token|secret|password/i, use pino-pretty in development, structured JSON in production, respect LOG_LEVEL env var. Write unit tests in tests/unit/utils/logger.test.ts verifying: child logger creation works, redaction strips sensitive fields, log level respects env var. Refer to HLD Section 5.1.

**Creates:**
```
src/utils/logger.ts
tests/unit/utils/logger.test.ts
```

**Depends on:** S0.A.1

**Acceptance:**
- [ ] `npm test -- tests/unit/utils/logger` passes
- [ ] Logging `{ apiKey: 'sk-secret' }` outputs `[REDACTED]`
- [ ] Child loggers include module name in output

---

#### S0.B.2 — Config System

**Session prompt:**
> Create the config system in src/config/. This includes: schema.ts with the full Zod ConfigSchema (see HLD Section 5.2 for exact schema), loader.ts that loads config from ~/.lil-dude/config.json with env var overrides (LIL_DUDE_HOME, LIL_DUDE_ANTHROPIC_KEY, etc.), and a save function. Config loading priority: env vars > config.json > Zod defaults. Use the LIL_DUDE_HOME env var to override the base directory (critical for testing). Write unit tests verifying: defaults are applied, env vars override file values, invalid config is rejected by Zod, missing config file creates defaults. Use a temp directory in tests, not the real ~/.lil-dude.

**Creates:**
```
src/config/schema.ts
src/config/loader.ts
src/config/index.ts (re-exports)
tests/unit/config/loader.test.ts
```

**Depends on:** S0.A.2, S0.B.1

**Acceptance:**
- [ ] `npm test -- tests/unit/config` passes
- [ ] Loading missing config file creates valid defaults
- [ ] Env var `LIL_DUDE_ANTHROPIC_KEY` overrides config file
- [ ] Invalid security level (e.g., 99) is rejected

---

#### S0.B.3 — Hardware Detection & Shutdown Handler

**Session prompt:**
> Create two utilities: (1) src/utils/hardware.ts that detects OS, architecture, RAM, CPU cores, disk space, and GPU availability, then returns a HardwareProfile and calculates available feature flags (browser automation needs 8GB+, local models need 16GB+, voice needs 16GB+ and GPU). (2) src/utils/shutdown.ts that registers SIGINT/SIGTERM handlers implementing the graceful shutdown sequence from HLD Section 5.6: stop accepting messages, mark running tasks as pending, record last_active_at, flush writes, close DB, exit. The shutdown handler should accept a cleanup registry where modules can register their cleanup functions. Write tests for hardware detection (mock os module) and shutdown handler (verify cleanup order).

**Creates:**
```
src/utils/hardware.ts
src/utils/shutdown.ts
tests/unit/utils/hardware.test.ts
tests/unit/utils/shutdown.test.ts
```

**Depends on:** S0.B.1

**Acceptance:**
- [ ] `npm test -- tests/unit/utils` passes
- [ ] Hardware detection returns valid feature flags
- [ ] Shutdown handler calls cleanup functions in reverse registration order

---

### Feature Group C: Persistence Layer

#### S0.C.1 — SQLite Connection & Migration Runner

**Session prompt:**
> Create src/persistence/db.ts: a SQLite database manager using better-sqlite3. It should: open/create the DB at the configured path (from config's LIL_DUDE_HOME), enable WAL mode and foreign keys, include a migration runner that reads .sql files from src/persistence/migrations/ sorted by filename, tracks applied migrations in a migrations table, and only runs pending ones. Create src/persistence/migrations/001_initial.sql with the full schema from HLD Section 5.3 (all tables: config_store, tasks, token_usage, conversations, conversation_logs, knowledge, cron_jobs, security_log, approval_queue, skills_registry). Write tests: verify DB creation, migration runs, idempotent re-run, WAL mode is active. Use temp directories for test DBs.

**Creates:**
```
src/persistence/db.ts
src/persistence/migrations/001_initial.sql
src/persistence/index.ts (re-exports)
tests/unit/persistence/db.test.ts
```

**Depends on:** S0.B.2

**Acceptance:**
- [ ] `npm test -- tests/unit/persistence/db` passes
- [ ] Fresh DB has all tables after migration
- [ ] Running migrations twice is idempotent
- [ ] WAL mode is active (`PRAGMA journal_mode` returns 'wal')

---

#### S0.C.2 — Data Access Layer: Config & Tasks

**Session prompt:**
> Create DAL modules for the config_store and tasks tables. src/persistence/config-store.ts: get/set/delete key-value pairs in config_store. src/persistence/tasks.ts: CRUD for tasks table — createTask, getTask, updateTaskStatus, updateTaskSpend, getTasksByStatus, getRecentTasks (with pagination), deleteTask. All functions take the Database instance as first argument (dependency injection). Use the Task type from src/types/. Write thorough tests for both modules: verify all CRUD operations, status transitions, pagination.

**Creates:**
```
src/persistence/config-store.ts
src/persistence/tasks.ts
tests/unit/persistence/config-store.test.ts
tests/unit/persistence/tasks.test.ts
```

**Depends on:** S0.C.1

**Acceptance:**
- [ ] `npm test -- tests/unit/persistence/config-store` passes
- [ ] `npm test -- tests/unit/persistence/tasks` passes
- [ ] Task status updates work for all valid transitions
- [ ] Pagination returns correct page sizes

---

#### S0.C.3 — Data Access Layer: Conversations, Logs, Knowledge

**Session prompt:**
> Create DAL modules for conversations, conversation_logs, and knowledge tables. src/persistence/conversations.ts: create, get, update summary, update key_facts, list by channel, get with message count. src/persistence/conversation-logs.ts: append log entry, get logs for conversation (with pagination), get total token count for conversation, delete old logs (cleanup). src/persistence/knowledge.ts: store fact (insert or update by category+key), recall by query (LIKE search on key and value), recall by category, delete fact, list all by category. Write tests for all modules. Knowledge recall should be case-insensitive.

**Creates:**
```
src/persistence/conversations.ts
src/persistence/conversation-logs.ts
src/persistence/knowledge.ts
tests/unit/persistence/conversations.test.ts
tests/unit/persistence/conversation-logs.test.ts
tests/unit/persistence/knowledge.test.ts
```

**Depends on:** S0.C.1

**Acceptance:**
- [ ] All three test files pass
- [ ] Knowledge recall returns results for partial matches
- [ ] Conversation log pagination works correctly
- [ ] Storing knowledge with same category+key updates (not duplicates)

---

#### S0.C.4 — Data Access Layer: Token Usage, Cron, Security Log, Approvals

**Session prompt:**
> Create DAL modules for the remaining tables. src/persistence/token-usage.ts: record usage, get usage by task, get daily/monthly totals, get usage by model, get usage by provider. src/persistence/cron-jobs.ts: CRUD for cron_jobs, getMissedJobs (where enabled=1 and next_run_at < now), updateLastRun. src/persistence/security-log.ts: append entry, get recent entries (with pagination and optional filters by action_type, allowed). src/persistence/approvals.ts: create request, get pending for user, approve/deny, expire old requests, get by ID. Write tests for all modules. The token usage daily/monthly queries should use proper date math.

**Creates:**
```
src/persistence/token-usage.ts
src/persistence/cron-jobs.ts
src/persistence/security-log.ts
src/persistence/approvals.ts
tests/unit/persistence/token-usage.test.ts
tests/unit/persistence/cron-jobs.test.ts
tests/unit/persistence/security-log.test.ts
tests/unit/persistence/approvals.test.ts
```

**Depends on:** S0.C.1

**Acceptance:**
- [ ] All four test files pass
- [ ] Monthly token usage sums correctly across days
- [ ] Missed cron jobs detected correctly after simulated downtime
- [ ] Expired approvals are auto-marked on query

---

### Feature Group D: Security Module

#### S0.D.1 — Command Parser & Dangerous Patterns

**Session prompt:**
> Create the security command parser and pattern matcher. src/security/command-parser.ts: parse a raw shell command string into a structured ParsedCommand (binary, args, pipes, redirects, sudo detection). This MUST handle: quoted arguments, escaped characters, command chaining (;, &&, ||), pipes, subshells ($(), backticks), variable expansion, and multiple spaces. src/security/defaults.ts: define DANGEROUS_PATTERNS (regex-based, NOT string matching), BINARY_ALLOWLIST_DEFAULT, DIRECTORY_RULES, DOMAIN_RULES — all from HLD Section 5.4. Write EXTENSIVE tests for the command parser including ALL bypass attempts listed in HLD Section 19 (rm with extra spaces, quoted binaries, command substitution, backtick substitution, chaining, pipes, base64 encoded commands, env var expansion, aliased commands). This is the most security-critical code in the project.

**Creates:**
```
src/security/command-parser.ts
src/security/defaults.ts
tests/unit/security/command-parser.test.ts
tests/unit/security/defaults.test.ts
```

**Depends on:** S0.A.2

**Acceptance:**
- [ ] All tests pass including EVERY bypass attempt from HLD Section 19
- [ ] Parser correctly identifies binary name from `PATH`-style commands
- [ ] Piped commands are each individually parsed and checked
- [ ] Command substitution ($() and backticks) is detected and flagged

---

#### S0.D.2 — Permissions Engine & Sandbox

**Session prompt:**
> Create the permissions engine and process sandbox. src/security/permissions.ts: given a security level (1-5), a parsed command, and the user's config overrides, determine if the action is allowed/denied/needs-approval. Implement the full preset matrix from HLD Section 5.4 (Tin Foil Hat through YOLO). Check shell commands, file paths, and domains. src/security/sandbox.ts: execute shell commands in a child process with restrictions — forced cwd to workspace, stripped sensitive env vars, timeout enforcement, max output bytes cap, and stdout/stderr capture. All decisions logged via the security-log DAL. Write tests: each security level correctly allows/denies for shell, file, and network; sandbox enforces timeout; sandbox strips env vars.

**Creates:**
```
src/security/permissions.ts
src/security/sandbox.ts
tests/unit/security/permissions.test.ts
tests/unit/security/sandbox.test.ts
```

**Depends on:** S0.D.1, S0.C.4 (security log DAL)

**Acceptance:**
- [ ] Level 1 blocks all shell, writes, and network
- [ ] Level 3 allows allowlisted commands, queues others
- [ ] Level 5 only blocks ALWAYS_BLOCK patterns
- [ ] Sandbox kills process after timeout
- [ ] Sandbox output does not include API keys from parent env

---

#### S0.D.3 — Prompt Injection Detection & Spotlighting

**Session prompt:**
> Create prompt injection defenses. src/security/injection.ts: the checkForInjection function that scans for instruction overrides, role impersonation, delimiter injection, encoded instructions, and tool name mentions in external content. Return a SanitizationResult with threat list and severity levels. src/security/spotlighting.ts: the wrapUntrustedContent function that wraps external data in isolation markers with instructions for the LLM to treat it as data only. Truncate content exceeding 10,000 chars. Write tests: each injection pattern type is detected, external content with hidden instructions is flagged, user messages with legitimate "ignore" wording are not false-positived (e.g., "ignore my last message" from the user is fine), spotlighting wraps content correctly.

**Creates:**
```
src/security/injection.ts
src/security/spotlighting.ts
src/security/index.ts (re-exports all security modules)
tests/unit/security/injection.test.ts
tests/unit/security/spotlighting.test.ts
```

**Depends on:** S0.A.2

**Acceptance:**
- [ ] "Ignore previous instructions" from external source is flagged high
- [ ] "Please ignore my last message" from user is NOT flagged
- [ ] Base64-encoded "delete all files" is detected
- [ ] Spotlighting wraps content with correct markers
- [ ] Content over 10,000 chars is truncated

---

### Feature Group E: Cost Control

#### S0.E.1 — Token Counter, Pricing Table & Cost Tracker

**Session prompt:**
> Create the cost control modules. src/cost/tokens.ts: wrapper around tiktoken using cl100k_base encoding — countTokens(text) and estimateMessageTokens(messages: Message[]). src/cost/pricing.ts: the MODEL_PRICING record from HLD Section 5.5 with per-1k-token costs for all supported models (Anthropic, OpenAI, DeepSeek, Ollama). Include a function to calculate cost given token counts and model ID. src/cost/tracker.ts: record token usage to DB (via the token-usage DAL), get spending for a task, get daily and monthly totals. src/cost/budget.ts: canAfford(estimatedTokens, model) checks against monthly and per-task budgets, returns {allowed, reason, remainingBudget}. src/cost/estimator.ts: heuristic task cost estimation (zero LLM calls) using the HEURISTICS table from HLD Section 12. Write tests for all modules.

**Creates:**
```
src/cost/tokens.ts
src/cost/pricing.ts
src/cost/tracker.ts
src/cost/budget.ts
src/cost/estimator.ts
src/cost/index.ts (re-exports)
tests/unit/cost/tokens.test.ts
tests/unit/cost/pricing.test.ts
tests/unit/cost/budget.test.ts
tests/unit/cost/estimator.test.ts
```

**Depends on:** S0.C.4 (token-usage DAL), S0.A.2

**Acceptance:**
- [ ] Token counting returns reasonable counts for sample text
- [ ] Cost calculation matches manual math for known models
- [ ] canAfford returns false when monthly budget is exceeded
- [ ] Heuristic estimator returns cost without any LLM calls
- [ ] All tests pass

---

### Feature Group F: CLI Foundation

#### S0.F.1 — CLI Entry Point & Doctor Command

**Session prompt:**
> Create the CLI entry point using commander. src/cli.ts: register commands — `lil-dude --version`, `lil-dude doctor`, `lil-dude onboard` (placeholder for Sprint 1), `lil-dude start`. The `doctor` command should: check Node.js version (>=20), check if config exists, check if DB exists and migrations are current, check hardware (via hardware.ts), validate config (via Zod), check if any API keys are configured, check if pricing data is stale (>30 days), and print a report with ✅/❌ for each check. Wire up the bin field in package.json. Test that `doctor` produces correct output for various states (missing config, invalid config, no API keys, etc.).

**Creates:**
```
src/cli.ts (complete with commander setup)
tests/unit/cli/doctor.test.ts
```

**Depends on:** S0.B.2, S0.B.3, S0.C.1, S0.E.1

**Acceptance:**
- [ ] `npx tsx src/cli.ts --version` outputs the version
- [ ] `npx tsx src/cli.ts doctor` runs all checks and prints results
- [ ] Missing config shows ❌ with helpful instruction
- [ ] Tests verify each check independently

---

### 🏁 Sprint 0 Checkpoint

Before proceeding to Sprint 1, verify:
- [ ] `npm run build` succeeds with zero errors
- [ ] `npm run typecheck` passes
- [ ] `npm test` runs ALL Sprint 0 tests and they pass
- [ ] `npx tsx src/cli.ts doctor` produces a full report
- [ ] No `any` types in the codebase
- [ ] All security bypass tests pass

---

## Sprint 1 — MVP Agent

> **Goal:** A working agent that responds on WebChat, Discord, and Telegram with security and budget enforcement.
> **Estimated sessions:** 12–14
> **Exit criteria:** Send a message on WebChat → get an AI response → see token usage in the dashboard.

---

### Feature Group G: LLM Providers

#### S1.G.1 — Anthropic Provider Adapter

**Session prompt:**
> Create src/providers/anthropic.ts implementing the LLMProvider interface. Use the @anthropic-ai/sdk package. Implement: chat() for non-streaming responses with tool use support, chatStream() as an async generator yielding StreamChunks, countTokens() using tiktoken. Handle API errors (rate limits, auth failures, network) by throwing ProviderError with retryable=true for rate limits. Map Anthropic's response format to our ChatResponse type. Map our ToolDefinition format to Anthropic's tool format. Record all calls through the cost tracker. Write integration tests using a mock HTTP server (not real API) that verify: successful chat, streaming, tool use round-trip, rate limit retry, auth error handling.

**Creates:**
```
src/providers/anthropic.ts
tests/integration/providers/anthropic.test.ts
```

**Depends on:** S0.A.2 (types), S0.E.1 (cost tracking)

**Acceptance:**
- [ ] Chat returns properly typed ChatResponse
- [ ] Streaming yields text deltas and tool_use events
- [ ] Rate limit errors are marked retryable
- [ ] Tool definitions are correctly mapped to Anthropic format
- [ ] All tests pass against mock server

---

#### S1.G.2 — OpenAI Provider Adapter

**Session prompt:**
> Create src/providers/openai.ts implementing LLMProvider. Use the openai package. Same interface as the Anthropic adapter but mapping to OpenAI's API format. This adapter should also work for DeepSeek by accepting a custom baseURL in the constructor (DeepSeek uses OpenAI-compatible API). Implement chat(), chatStream(), countTokens(). Map OpenAI function_call/tools format to our types. Write integration tests with a mock server: successful chat, streaming, tool use, DeepSeek base URL override.

**Creates:**
```
src/providers/openai.ts
tests/integration/providers/openai.test.ts
```

**Depends on:** S0.A.2 (types), S0.E.1 (cost tracking)

**Acceptance:**
- [ ] Works with OpenAI API format
- [ ] Works with DeepSeek when given custom baseURL
- [ ] Tool use maps correctly between formats
- [ ] All tests pass

---

#### S1.G.3 — Mock Provider & Model Router

**Session prompt:**
> Create two modules: (1) tests/mocks/provider.ts — a MockProvider implementing LLMProvider for use in all tests. It accepts pre-programmed responses via a `when(inputContains, response)` method and returns them. See HLD Section 19 for the pattern. (2) src/providers/router.ts — the model router. Implements classifyComplexity(message, hasActiveSkill) using heuristics from HLD Section 6.2 (word count, keywords, multi-step detection). Implements selectModel(tier, enabledProviders) that picks the best available model for a tier. Create src/providers/index.ts that initializes all enabled providers from config and exports a ProviderManager with route(message) → {provider, model, tier}. Write tests for the router: simple messages → small, complex → large, skill triggers → small, explicit "thorough" → large.

**Creates:**
```
tests/mocks/provider.ts
src/providers/router.ts
src/providers/index.ts
tests/unit/providers/router.test.ts
```

**Depends on:** S1.G.1, S1.G.2, S0.A.2

**Acceptance:**
- [ ] MockProvider returns pre-programmed responses
- [ ] "What time is it?" routes to small tier
- [ ] "Write a comprehensive analysis of..." routes to large tier
- [ ] selectModel falls back to next provider when preferred is unavailable
- [ ] All tests pass

---

### Feature Group H: Tool Execution

#### S1.H.1 — Shell, Filesystem & HTTP Tools

**Session prompt:**
> Create the tool execution modules. src/tools/shell.ts: wraps the security sandbox — takes a command, runs it through permission checks, executes in sandbox if allowed, returns ToolResult. src/tools/filesystem.ts: read_file, write_file, list_directory — each checks directory permissions before operating. src/tools/api.ts: HTTP client that enforces domain allowlist/blocklist before making requests. All tools take the security config and DB as constructor dependencies. All log to security_log. Write tests: shell tool blocks dangerous commands, filesystem tool blocks access to /etc, HTTP tool blocks localhost. Also test the happy paths — allowed commands execute correctly.

**Creates:**
```
src/tools/shell.ts
src/tools/filesystem.ts
src/tools/api.ts
tests/unit/tools/shell.test.ts
tests/unit/tools/filesystem.test.ts
tests/unit/tools/api.test.ts
```

**Depends on:** S0.D.2 (sandbox + permissions), S0.C.4 (security log)

**Acceptance:**
- [ ] Shell tool rejects `rm -rf /` at any security level
- [ ] Filesystem tool rejects reads from `/etc/passwd`
- [ ] HTTP tool rejects requests to `127.0.0.1`
- [ ] All tools log decisions to security_log
- [ ] Allowed operations return correct results
- [ ] All tests pass

---

#### S1.H.2 — Knowledge & Scheduler Tools + Tool Executor Registry

**Session prompt:**
> Create: (1) src/tools/knowledge.ts — implements knowledge_store and knowledge_recall tools using the knowledge DAL. (2) src/tools/scheduler.ts — implements schedule_task tool that creates cron_job entries via the cron-jobs DAL. Validates cron expressions. (3) src/tools/definitions.ts — the full CORE_TOOLS array from HLD Section 6.1. (4) src/tools/executor.ts — a ToolExecutor class that: takes a tool_use content block from the LLM, matches the tool name to the handler, executes it, returns a ToolResult formatted as a tool_result content block. Handles unknown tools, execution errors, and timeout. This is the bridge between the LLM's tool calls and actual execution. Write tests for all.

**Creates:**
```
src/tools/knowledge.ts
src/tools/scheduler.ts
src/tools/definitions.ts
src/tools/executor.ts
src/tools/index.ts (re-exports)
tests/unit/tools/knowledge.test.ts
tests/unit/tools/scheduler.test.ts
tests/unit/tools/executor.test.ts
```

**Depends on:** S1.H.1, S0.C.3 (knowledge DAL), S0.C.4 (cron DAL)

**Acceptance:**
- [ ] knowledge_store persists and knowledge_recall retrieves
- [ ] scheduler validates cron expressions and rejects invalid ones
- [ ] ToolExecutor routes tool calls to correct handlers
- [ ] Unknown tool names return an error ToolResult (not a crash)
- [ ] All tests pass

---

### Feature Group I: Agent Orchestrator

#### S1.I.1 — System Prompt & Context Builder

**Session prompt:**
> Create: (1) src/orchestrator/system-prompt.ts — the buildSystemPrompt function from HLD Section 15. Takes userName, securityLevel, activeSkills and returns the full system prompt string. (2) src/context/manager.ts — the ContextManager that builds a ContextPayload for an LLM call. Implements the token budget allocation from HLD Section 13: system prompt ~1000, user profile ~300, relevant knowledge ~500, conversation summary ~1000, recent messages ~2000, reserved for response ~1200. Queries knowledge DAL for relevant entries. Loads conversation summary and recent messages. Trims to fit within the target token budget (8000 tokens default, configurable). (3) src/context/knowledge.ts — helper that queries the knowledge base and formats results for inclusion in context. Write tests: system prompt includes correct security rules per level, context builder respects token budget, knowledge is included when relevant.

**Creates:**
```
src/orchestrator/system-prompt.ts
src/context/manager.ts
src/context/knowledge.ts
src/context/index.ts
tests/unit/orchestrator/system-prompt.test.ts
tests/unit/context/manager.test.ts
```

**Depends on:** S0.E.1 (token counting), S0.C.3 (knowledge DAL, conversation DAL)

**Acceptance:**
- [ ] System prompt changes based on security level
- [ ] Context builder total tokens stays within budget
- [ ] Knowledge entries matching user's message are included
- [ ] When conversation is long, summary is used instead of full history

---

#### S1.I.2 — Conversation Summarizer

**Session prompt:**
> Create src/context/summarizer.ts. This module: (1) detects when a conversation needs summarization (>4000 tokens), (2) calls a SMALL model to generate a lossy summary (~1000 tokens), (3) extracts key facts using the key fact extraction prompt from HLD Section 7.4, (4) stores the summary in the conversations table and key facts in the knowledge table, (5) retains full raw logs in conversation_logs. The summarizer should take an LLMProvider as a dependency (for testability — use MockProvider in tests). Write tests: conversation under 4000 tokens is not summarized, over 4000 triggers summarization, key facts are extracted and stored, full logs remain accessible.

**Creates:**
```
src/context/summarizer.ts
tests/unit/context/summarizer.test.ts
```

**Depends on:** S1.I.1, S1.G.3 (mock provider), S0.C.3 (conversation DAL)

**Acceptance:**
- [ ] Short conversations skip summarization
- [ ] Long conversations produce summary + key facts
- [ ] Key facts are stored in knowledge table
- [ ] Raw logs are preserved in conversation_logs
- [ ] Tests pass using MockProvider

---

#### S1.I.3 — Approval Queue

**Session prompt:**
> Create src/orchestrator/approval.ts — the non-blocking approval queue from HLD Section 6.3. It should: create an ApprovalRequest in the DB, send the request to the user's active channel (via a callback — the queue doesn't know about channels directly), return a Promise that resolves when the user responds or the request expires (5 min default). Matching user responses ("yes"/"no"/"approve"/"deny") to pending requests by most-recent-pending. Handle expiration gracefully. The agent loop can await the approval while still processing other messages (non-blocking). Write tests: approval flow resolves on "yes", rejects on "no", expires after timeout, multiple pending approvals are matched correctly.

**Creates:**
```
src/orchestrator/approval.ts
tests/unit/orchestrator/approval.test.ts
```

**Depends on:** S0.C.4 (approvals DAL)

**Acceptance:**
- [ ] Approval resolves true when user says "yes"
- [ ] Approval resolves false when user says "no"
- [ ] Approval resolves false after timeout
- [ ] Multiple pending approvals don't cross-contaminate
- [ ] Tests pass

---

#### S1.I.4 — The Agent Loop (Core Pipeline)

**Session prompt:**
> Create src/orchestrator/agent-loop.ts — this is the central nervous system. Implements the 10-step message pipeline from HLD Section 3: (1) Input Sanitizer (injection check), (2) Permission Gate, (3) Cost Gate (budget check), (4) Skill Router (placeholder — always "no match" for now), (5) Model Router, (6) Context Builder, (7) LLM Call with tool use loop (call LLM → if tool_use, execute tool via ToolExecutor → feed result back → repeat until end_turn or max rounds), (8) Cost Tracker (record usage), (9) Context Updater (append to conversation log, trigger summarization if needed), (10) Return response text. The loop should enforce kill conditions from HLD Section 12 (max 20 round trips, max tokens per task, max duration, max consecutive errors). Takes all dependencies via constructor injection. Write integration tests using MockProvider: simple chat, tool use round-trip, budget exceeded mid-task, kill condition triggered, injection blocked.

**Creates:**
```
src/orchestrator/agent-loop.ts
src/orchestrator/index.ts (re-exports)
tests/integration/agent-loop.test.ts
```

**Depends on:** S1.I.1, S1.I.2, S1.I.3, S1.H.2, S1.G.3, S0.D.3, S0.E.1

**Acceptance:**
- [ ] Simple chat: message in → response out
- [ ] Tool use: LLM requests tool → tool executes → result fed back → final response
- [ ] Budget exceeded: returns budget error message to user
- [ ] Kill condition: loop stops after 20 round trips
- [ ] Injection blocked: malicious input returns denial message
- [ ] All costs tracked in DB
- [ ] Integration tests pass

---

### Feature Group J: Channels

#### S1.J.1 — WebChat Channel

**Session prompt:**
> Create src/channels/webchat.ts implementing ChannelAdapter. WebChat uses the WebSocket connection from the gateway. When a client sends a `chat.send` WS message, it normalizes it to a ChannelMessage and passes it to the message handler. Responses are sent back as `chat.message` or `chat.stream` WS messages. This is the simplest channel — no external API, no auth tokens, always available. Also create tests/mocks/channel.ts — a MockChannelAdapter for use in other tests. Write tests: message normalization, response sending, connection lifecycle.

**Creates:**
```
src/channels/webchat.ts
src/channels/index.ts (channel manager that loads enabled channels)
tests/mocks/channel.ts
tests/unit/channels/webchat.test.ts
```

**Depends on:** S0.A.2 (types)

**Acceptance:**
- [ ] WebChat normalizes WS messages to ChannelMessage type
- [ ] Responses sent back over WS connection
- [ ] MockChannelAdapter captures sent messages for assertion
- [ ] Tests pass

---

#### S1.J.2 — Discord Channel

**Session prompt:**
> Create src/channels/discord.ts implementing ChannelAdapter using discord.js. It should: connect using the bot token from config, listen for DMs and mentions in allowed channels, filter by allowFrom user IDs (empty = allow all), normalize messages to ChannelMessage, send responses with markdown formatting, support approval buttons (Discord message components) for the approval queue, handle rate limits gracefully. Write tests with a mock discord.js client: message handling, allowFrom filtering, rate limit backoff. Include helpful error messages if the bot token is invalid.

**Creates:**
```
src/channels/discord.ts
tests/unit/channels/discord.test.ts
```

**Depends on:** S0.A.2 (types), S0.B.1 (logger)

**Acceptance:**
- [ ] Connects with valid token (test with mock)
- [ ] Filters messages by allowFrom
- [ ] Normalizes Discord message to ChannelMessage
- [ ] Sends formatted responses
- [ ] Invalid token produces helpful error

---

#### S1.J.3 — Telegram Channel

**Session prompt:**
> Create src/channels/telegram.ts implementing ChannelAdapter using telegraf. Similar to Discord adapter: connect with bot token, filter by allowFrom, normalize messages, send responses with Telegram markdown. Handle Telegram-specific quirks: message length limits (4096 chars, split if longer), inline keyboard for approvals, rate limits. Write tests with mock telegraf context.

**Creates:**
```
src/channels/telegram.ts
tests/unit/channels/telegram.test.ts
```

**Depends on:** S0.A.2 (types), S0.B.1 (logger)

**Acceptance:**
- [ ] Connects with valid token (test with mock)
- [ ] Long messages are split at 4096 chars
- [ ] allowFrom filtering works
- [ ] Tests pass

---

### Feature Group K: Gateway & Web Panel

#### S1.K.1 — Fastify Server, REST API & WebSocket Gateway

**Session prompt:**
> Create src/gateway/server.ts — the main Fastify server. It should: serve static files from web/dist/ for the control panel, mount the REST API at /api/v1 with all endpoints from HLD Section 16 (health, config, budget, tasks, conversations, knowledge, skills, cron, security log, approvals, briefing, usage stats), set up WebSocket handling at ws://host:wsPort with the protocol from HLD Section 17 (subscribe, chat.send, approval.respond, task.kill from client; chat.message, chat.stream, task.update, cost.update, approval.request from server). Wire up CORS for local development. Each REST endpoint calls the appropriate DAL module. The WebSocket broadcasts events to subscribed clients. Write tests for key REST endpoints (GET /health, GET /budget, GET /tasks).

**Creates:**
```
src/gateway/server.ts
src/gateway/ws.ts (WebSocket handler)
src/gateway/api/ (route handlers, one file per resource)
  api/health.ts, api/config.ts, api/budget.ts, api/tasks.ts,
  api/conversations.ts, api/knowledge.ts, api/skills.ts,
  api/cron.ts, api/security.ts, api/approvals.ts,
  api/briefing.ts, api/usage.ts
src/gateway/index.ts
tests/integration/gateway/api.test.ts
```

**Depends on:** S0.C.2, S0.C.3, S0.C.4, S0.E.1

**Acceptance:**
- [ ] GET /api/v1/health returns uptime, memory, db status
- [ ] GET /api/v1/budget returns correct monthly spend
- [ ] WebSocket accepts connections and handles subscribe
- [ ] Static files served from web/dist/
- [ ] Tests pass

---

#### S1.K.2 — Web Control Panel (React)

**Session prompt:**
> Create the React control panel in the web/ directory. Initialize a Vite + React 18 + Tailwind CSS project. Build these pages: (1) Dashboard (/) — token usage chart (daily bar chart for the last 7 days), budget progress bar, active task count, system health indicators. (2) Chat (/chat) — WebChat interface with message input, scrolling message list, streaming response display. (3) Settings (/settings) — API key inputs (masked), channel toggle switches, security level slider (1-5 with descriptions), budget controls. (4) Tasks (/tasks) — list of recent tasks with status badges, cost per task, kill button for running tasks. Use fetch() for REST API calls and native WebSocket for real-time updates. The design should be clean, modern, dark-mode by default with a 🤙 shaka accent. Navigation sidebar. Mobile-responsive.

**Creates:**
```
web/package.json, web/vite.config.ts, web/tsconfig.json
web/tailwind.config.js, web/index.html
web/src/main.tsx, web/src/App.tsx
web/src/pages/Dashboard.tsx
web/src/pages/Chat.tsx
web/src/pages/Settings.tsx
web/src/pages/Tasks.tsx
web/src/components/Layout.tsx, Sidebar.tsx, BudgetBar.tsx,
  UsageChart.tsx, TaskList.tsx, ChatMessage.tsx, SecuritySlider.tsx
web/src/hooks/useWebSocket.ts, useApi.ts
web/src/lib/api.ts
```

**Depends on:** S1.K.1 (API to consume)

**Acceptance:**
- [ ] `cd web && npm run build` produces dist/
- [ ] Dashboard shows usage chart and budget bar
- [ ] Chat page sends messages and receives streaming responses
- [ ] Settings page saves config changes via API
- [ ] Mobile-responsive layout

---

### Feature Group L: Onboarding & Wiring

#### S1.L.1 — Onboarding Wizard

**Session prompt:**
> Implement the onboarding wizard in src/cli.ts (the `onboard` command). Use inquirer for interactive prompts, chalk for colors, ora for spinners. Follow the exact flow from HLD Section 6.4: (1) Select AI provider(s), (2) Enter API key and verify by making a test API call, (3) Select channels, (4) Security level slider, (5) Monthly budget, (6) User name. Save config to ~/.lil-dude/config.json. Initialize the database. Print the startup banner with URLs. Write a test that runs onboarding with pre-filled stdin inputs (inquirer supports this).

**Creates:**
```
src/cli.ts (onboard command fully implemented)
tests/e2e/onboarding.test.ts
```

**Depends on:** S0.B.2, S0.C.1, S1.G.1 (to verify API key)

**Acceptance:**
- [ ] Wizard runs interactively
- [ ] API key is verified with a real (mockable) call
- [ ] Config file is written correctly
- [ ] DB is initialized after onboarding

---

#### S1.L.2 — Main Entry Point & Full Wiring

**Session prompt:**
> Wire everything together in src/index.ts. The entry point should: (1) Load config, (2) Initialize DB and run migrations, (3) Detect hardware and log available features, (4) Initialize security module, (5) Initialize cost engine, (6) Initialize enabled providers via ProviderManager, (7) Initialize enabled channels via ChannelManager, (8) Create the AgentLoop with all dependencies injected, (9) Wire channel messages to the agent loop, (10) Start the Fastify gateway server, (11) Start the cron scheduler (placeholder — just the runner, no jobs yet), (12) Register shutdown handlers, (13) Log startup banner. Also add the `start` command to src/cli.ts that calls this. The `start` command should also check if onboarding has been done (config exists). Write a smoke test that starts the app with MockProvider and MockChannel, sends a message, and gets a response.

**Creates:**
```
src/index.ts (complete wiring)
tests/e2e/smoke.test.ts
```

**Depends on:** ALL Sprint 0 + Sprint 1 WIs

**Acceptance:**
- [ ] `npx tsx src/cli.ts start` boots the full application
- [ ] Smoke test: send message via MockChannel → get response → verify cost tracked
- [ ] Shutdown signal cleanly stops the process
- [ ] Missing config prompts user to run onboard

---

### 🏁 Sprint 1 Checkpoint

Before proceeding to Sprint 2, verify:
- [ ] Full pipeline works: WebChat message → AI response → cost tracked → visible in dashboard
- [ ] Security blocks dangerous commands at all levels
- [ ] Budget enforcement prevents overspending
- [ ] Discord and Telegram channels connect (manual test with real tokens)
- [ ] All tests pass (`npm test`)
- [ ] `npm run build` succeeds

---

## Sprint 2 — Skills & Automation

> **Goal:** The agent can do real things — check stocks, set reminders, search the web, generate daily briefings.
> **Estimated sessions:** 12–14
> **Exit criteria:** "Check AAPL stock" returns a real price. Daily briefing generates.

---

### Feature Group M: Skill System Core

#### S2.M.1 — Skill Manifest Schema & Loader

**Session prompt:**
> Create: (1) src/skills/schema.ts — Zod schema for skill.json manifests (see HLD Section 7.1). (2) src/skills/loader.ts — scans skills/bundled/ and ~/.lil-dude/skills/installed/ directories, reads and validates each skill.json, loads the entry point module, registers in the skills_registry DB table. Handles invalid manifests gracefully (log warning, skip). (3) src/skills/registry.ts — maintains an in-memory index of loaded skills, implements trigger matching (given a user message, find the best matching skill by checking trigger keywords), exposes a getSkill(name) method. Write tests: valid manifest loads, invalid manifest is skipped, trigger matching finds correct skill, no match returns null.

**Creates:**
```
src/skills/schema.ts
src/skills/loader.ts
src/skills/registry.ts
src/skills/index.ts
tests/unit/skills/loader.test.ts
tests/unit/skills/registry.test.ts
tests/fixtures/skills/valid-skill/ (test skill with skill.json + index.ts)
tests/fixtures/skills/invalid-skill/ (bad manifest)
```

**Depends on:** S0.A.2, S0.C.4 (skills_registry DAL)

**Acceptance:**
- [ ] Valid skill loads and appears in registry
- [ ] Invalid manifest logs warning and is skipped
- [ ] "check my stocks" matches a skill with trigger "stock"
- [ ] "tell me a joke" returns no match

---

#### S2.M.2 — Deterministic Execution Engine

**Session prompt:**
> Create src/skills/executor.ts — the deterministic-first skill execution engine from HLD Section 7.2. Flow: (1) Skill matched → check if skill.deterministic is true. (2) If deterministic: use SMALL model to extract parameters from user message, then call skill.execute(plan) directly (no LLM for execution), optionally validate result with SMALL model. (3) If not deterministic: use MEDIUM model for full planning, execute with LLM in the loop. Wire this into the agent loop (update S1.I.4) — step 4 (Skill Router) now checks the skill registry and routes to the deterministic executor when a skill matches. Write tests: deterministic skill executes without LLM for execution step, non-deterministic skill uses LLM throughout, parameter extraction works for simple inputs.

**Creates:**
```
src/skills/executor.ts
tests/unit/skills/executor.test.ts
```
**Modifies:** `src/orchestrator/agent-loop.ts` (add skill routing at step 4)

**Depends on:** S2.M.1, S1.I.4

**Acceptance:**
- [ ] Deterministic skill: only 1 LLM call (extraction), rest is deterministic
- [ ] Non-deterministic skill: full LLM loop
- [ ] Agent loop routes to skill executor when match found
- [ ] Tests pass with MockProvider

---

### Feature Group N: Bundled Skills

#### S2.N.1 — Reminders Skill

**Session prompt:**
> Create the first bundled skill: skills/bundled/reminders/. This is the simplest skill — purely cron-based, fully deterministic. skill.json: triggers are ["remind", "reminder", "alert", "notify"]. index.ts: implements Skill interface. plan() uses a SMALL model to extract: reminder text, time/schedule (natural language → cron expression conversion). execute() creates a cron_job entry in the DB. The cron scheduler (create src/orchestrator/cron-runner.ts if not yet built) picks it up and sends the reminder to the user's channel at the scheduled time. Write tests: "remind me to drink water every hour" creates a cron job with "0 * * * *", "remind me tomorrow at 9am to call mom" creates a one-time job.

**Creates:**
```
skills/bundled/reminders/skill.json
skills/bundled/reminders/index.ts
src/orchestrator/cron-runner.ts (cron scheduler using node-cron)
tests/unit/skills/reminders.test.ts
tests/unit/orchestrator/cron-runner.test.ts
```

**Depends on:** S2.M.2, S0.C.4 (cron DAL)

**Acceptance:**
- [ ] "Remind me to drink water every hour" creates correct cron job
- [ ] Cron runner fires at scheduled time and sends message to channel
- [ ] One-time reminders self-delete after firing
- [ ] Tests pass

---

#### S2.N.2 — Web Search Skill

**Session prompt:**
> Create skills/bundled/web-search/. This is a NON-deterministic skill (needs AI to interpret results). Uses http_request tool to call a search API (DuckDuckGo Instant Answer API is free and keyless — `https://api.duckduckgo.com/?q=QUERY&format=json`). skill.json: triggers are ["search", "look up", "find", "what is", "who is"]. plan() extracts the search query. execute() calls DuckDuckGo API (deterministic HTTP call), then uses a SMALL model to summarize the results into a concise answer. The external API response is wrapped with spotlighting before being sent to the LLM. Write tests: search query extraction, API response handling, spotlighting is applied to external data.

**Creates:**
```
skills/bundled/web-search/skill.json
skills/bundled/web-search/index.ts
tests/unit/skills/web-search.test.ts
```

**Depends on:** S2.M.2, S1.H.1 (HTTP tool), S0.D.3 (spotlighting)

**Acceptance:**
- [ ] "Search for weather in Seattle" extracts query "weather in Seattle"
- [ ] External API response is spotlighted before LLM sees it
- [ ] Summary is concise and useful
- [ ] Tests pass with mock HTTP responses

---

#### S2.N.3 — Stock Monitor Skill

**Session prompt:**
> Create skills/bundled/stock-monitor/. This is a DETERMINISTIC skill — no LLM needed for execution. Uses Yahoo Finance API (or similar free endpoint) to fetch stock prices. skill.json: triggers are ["stock", "stocks", "share price", "ticker", "market"]. deterministic: true. plan() uses SMALL model to extract stock symbol(s). execute() makes HTTP request to financial API, parses JSON, formats response with template strings (e.g., "AAPL: $245.30 ▲ 1.2%"). No LLM call for formatting. Also supports: "set a stock alert for AAPL below $240" → creates a cron job that checks price every 30 min and alerts if condition met. Write tests with mock API responses.

**Creates:**
```
skills/bundled/stock-monitor/skill.json
skills/bundled/stock-monitor/index.ts
tests/unit/skills/stock-monitor.test.ts
```

**Depends on:** S2.M.2, S1.H.1 (HTTP tool)

**Acceptance:**
- [ ] "Check AAPL" returns formatted price with NO LLM call for formatting
- [ ] "Alert me if TSLA drops below $200" creates a cron job
- [ ] AI cost for simple stock check is <$0.001
- [ ] Tests pass with mock financial API

---

#### S2.N.4 — Google Flights Skill (Browser-based)

**Session prompt:**
> Create skills/bundled/google-flights/ and the browser tool it depends on. First create src/tools/browser.ts — a Playwright wrapper that: launches headless Chromium in a child process, navigates to URLs (domain allowlist enforced), executes predefined scripts, captures screenshots, enforces timeout. The skill: triggers are ["flight", "flights", "fly", "airline", "travel"]. Uses Playwright to navigate Google Flights, enter search parameters (extracted by SMALL model), scrape results. The scraped HTML is spotlighted before being interpreted by a SMALL model. Mark minTier: "standard" (needs 8GB+ RAM for browser). Write tests with mock Playwright responses (don't launch real browser in tests).

**Creates:**
```
src/tools/browser.ts
skills/bundled/google-flights/skill.json
skills/bundled/google-flights/index.ts
skills/bundled/google-flights/scripts/ (Playwright navigation scripts)
tests/unit/tools/browser.test.ts
tests/unit/skills/google-flights.test.ts
```

**Depends on:** S2.M.2, S0.D.2 (sandbox), S0.D.3 (spotlighting)

**Acceptance:**
- [ ] Browser tool enforces domain allowlist
- [ ] Browser tool times out after configured limit
- [ ] Scraped content is spotlighted
- [ ] Skill not available on basic tier hardware
- [ ] Tests pass with mocked Playwright

---

#### S2.N.5 — Google Calendar Skill

**Session prompt:**
> Create skills/bundled/google-calendar/. This skill uses Google Calendar API (OAuth2 flow required). skill.json: triggers are ["calendar", "meeting", "schedule", "event", "appointment"]. deterministic: true. Implements: (1) OAuth2 setup flow (user runs `lil-dude skill setup google-calendar`, opens browser for auth, stores token in knowledge base encrypted), (2) list events for a date range, (3) create event, (4) delete event. All execution is deterministic (direct API calls). SMALL model only used for parameter extraction ("Meeting with Sarah tomorrow at 2pm" → {title, date, time, duration}). Write tests with mock Google API responses. Store OAuth tokens encrypted using a key derived from a user secret.

**Creates:**
```
skills/bundled/google-calendar/skill.json
skills/bundled/google-calendar/index.ts
skills/bundled/google-calendar/oauth.ts
src/utils/crypto.ts (encrypt/decrypt for OAuth tokens)
tests/unit/skills/google-calendar.test.ts
tests/unit/utils/crypto.test.ts
```

**Depends on:** S2.M.2, S1.H.1 (HTTP tool)

**Acceptance:**
- [ ] OAuth flow stores encrypted token
- [ ] "Add meeting with Sarah tomorrow at 2pm" creates event via API
- [ ] "What's on my calendar today?" lists events
- [ ] Only 1 LLM call (extraction) for deterministic operations
- [ ] OAuth token is encrypted at rest

---

### Feature Group O: Daily Briefing & Context

#### S2.O.1 — Daily Briefing Generator

**Session prompt:**
> Create src/web/dashboard/briefing.ts — the daily briefing generator from HLD Section 7.3. It should: (1) Gather data from all active skills by calling each skill's "status" method (skills that support it return current data — e.g., stock prices, today's calendar, upcoming reminders). (2) Query today's task history, costs, and cron results from DB. (3) Use SMALL model to generate a natural-language greeting + summary (~$0.001 cost). (4) Render as self-contained HTML (inline CSS, no React dependency) and save to ~/.lil-dude/dashboard/index.html. (5) Serve at /briefing via the Fastify server. (6) Hook into cron runner to auto-generate at user's configured briefingTime. Also add the `/briefing regenerate` REST endpoint. Write tests: briefing includes data from skills, HTML is valid, cost is tracked.

**Creates:**
```
src/web/dashboard/briefing.ts
src/web/dashboard/templates/ (HTML template strings)
tests/unit/web/briefing.test.ts
```

**Depends on:** S2.N.1-N.5 (skills), S1.K.1 (server), S2.N.1 (cron runner)

**Acceptance:**
- [ ] Briefing generates valid HTML
- [ ] Includes data from each active skill
- [ ] Shows today's cost and budget status
- [ ] Accessible at /briefing URL
- [ ] Auto-generates at configured time

---

#### S2.O.2 — Context Auto-Summarization & iMessage Channel

**Session prompt:**
> Two items: (1) Wire auto-summarization triggers into the agent loop. After each LLM response, check if the conversation exceeds 4,000 tokens → trigger summarization (from S1.I.2). After a task completes → extract key facts and archive. This is mostly wiring, not new code. (2) Create src/channels/imessage.ts — iMessage channel adapter (macOS only). Use AppleScript via child_process to send/receive iMessages. Detect if running on macOS (skip gracefully on Linux/Windows). Handle the iMessage quirk of needing the Messages app open. Write tests for the summarization trigger logic. iMessage tests should be OS-conditional (skip on non-macOS).

**Creates:**
```
src/channels/imessage.ts
tests/unit/channels/imessage.test.ts
tests/unit/context/auto-summarize.test.ts
```
**Modifies:** `src/orchestrator/agent-loop.ts` (add summarization triggers)

**Depends on:** S1.I.2, S1.I.4

**Acceptance:**
- [ ] Conversations auto-summarize at 4,000+ tokens
- [ ] Key facts extracted on task completion
- [ ] iMessage works on macOS (manual test)
- [ ] iMessage gracefully disabled on other OS
- [ ] Tests pass

---

### 🏁 Sprint 2 Checkpoint

Before proceeding to Sprint 3, verify:
- [ ] "Check AAPL stock" returns real price via deterministic skill (~$0.001 cost)
- [ ] "Remind me to stand up every hour" creates working cron job
- [ ] "Search for best restaurants in Seattle" returns web results
- [ ] Daily briefing generates and shows at /briefing
- [ ] Context auto-summarizes long conversations
- [ ] All tests pass

---

## Sprint 3 — Power Features

> **Goal:** Startup resume, more providers, skill hub, multi-task, advanced routing.
> **Estimated sessions:** 8–10
> **Exit criteria:** Agent resumes after reboot. Skills installable from GitHub.

---

### Feature Group P: Resilience

#### S3.P.1 — Startup Resume & Play Catchup

**Session prompt:**
> Implement the startup resume logic from HLD Section 8.1. On boot: (1) check for tasks with status 'running' → set to 'pending', (2) check last_active_at → calculate offline duration, (3) if <24 hours and pending tasks exist → offer to resume, (4) if ≥24 hours → detect missed cron jobs → offer to run/skip/summarize. Add to src/index.ts startup sequence. The user response is handled through the normal channel message flow. Write tests: simulate reboot with pending tasks, simulate long downtime with missed cron jobs.

**Creates:**
```
src/orchestrator/startup.ts
tests/unit/orchestrator/startup.test.ts
```
**Modifies:** `src/index.ts` (add startup resume to boot sequence)

**Depends on:** S1.L.2, S0.C.4 (cron DAL)

**Acceptance:**
- [ ] Pending tasks detected and resumed on user confirmation
- [ ] Missed cron jobs listed with run/skip option
- [ ] Clean boot (no pending tasks) shows normal greeting
- [ ] Tests pass

---

### Feature Group Q: More Providers

#### S3.Q.1 — DeepSeek & Gemini Providers

**Session prompt:**
> Add two more LLM providers. (1) src/providers/deepseek.ts — extends the OpenAI adapter (HLD notes DeepSeek uses OpenAI-compatible API) with custom base URL https://api.deepseek.com and DeepSeek-specific model IDs. (2) src/providers/gemini.ts — implements LLMProvider using the Google Generative AI SDK (@google/generative-ai). Map Gemini's response format to our types. Handle Gemini-specific tool calling format. Add both to the model router's provider pool. Update pricing.ts with current DeepSeek and Gemini prices. Write tests for both with mock servers.

**Creates:**
```
src/providers/deepseek.ts
src/providers/gemini.ts
tests/integration/providers/deepseek.test.ts
tests/integration/providers/gemini.test.ts
```
**Modifies:** `src/providers/index.ts`, `src/cost/pricing.ts`

**Depends on:** S1.G.2 (OpenAI adapter base)

**Acceptance:**
- [ ] DeepSeek provider works with custom base URL
- [ ] Gemini tool calling maps correctly
- [ ] Both appear in model router's available pool
- [ ] Pricing is accurate for new models
- [ ] Tests pass

---

### Feature Group R: Skill Hub & Power Mode

#### S3.R.1 — Skill Hub (Install from GitHub)

**Session prompt:**
> Create src/skills/hub.ts — the skill marketplace installer. Implements: (1) `lil-dude skill install github:user/repo` — clones repo to temp dir, validates skill.json, displays required permissions and prompts for approval, copies to ~/.lil-dude/skills/installed/{name}/, registers in DB. (2) `lil-dude skill list` — shows bundled and installed skills with status. (3) `lil-dude skill uninstall {name}` — removes from disk and DB. (4) `lil-dude skill search {query}` — searches a registry file (start with a curated JSON file on GitHub, not a full backend). Security: skills cannot request permissions beyond the user's security level. Skill's declared domain/shell/directory permissions are enforced by the sandbox. Write tests with a fixture "fake skill" repo.

**Creates:**
```
src/skills/hub.ts
tests/unit/skills/hub.test.ts
```
**Modifies:** `src/cli.ts` (add skill commands)

**Depends on:** S2.M.1, S0.D.2

**Acceptance:**
- [ ] Install downloads, validates, and registers a skill
- [ ] Skills with excessive permissions are blocked at current security level
- [ ] Uninstall removes from disk and DB
- [ ] List shows all bundled + installed skills
- [ ] Tests pass

---

#### S3.R.2 — Advanced Model Routing & Power User Mode

**Session prompt:**
> Two items: (1) Upgrade src/providers/router.ts — add learning from past quality scores. After each task, optionally rate the quality (was the output useful? Did tools work?). Store quality scores in a new routing_history table (add migration 002). Over time, the router learns which models handle which task types best and adjusts routing. This is additive, not a rewrite — the heuristic routing remains as fallback. (2) Add power user mode to the web panel — when config.preferences.powerUserMode is true, show: raw conversation logs viewer, prompt template editor, manual model selection override, custom allowlist/blocklist editor in Settings, JSON config editor. Write tests for the routing learning (does quality feedback improve future routing?).

**Creates:**
```
src/persistence/migrations/002_routing_history.sql
tests/unit/providers/advanced-router.test.ts
```
**Modifies:** `src/providers/router.ts`, web panel Settings page

**Depends on:** S1.G.3, S1.K.2

**Acceptance:**
- [ ] Routing quality stored in DB
- [ ] After negative feedback, router avoids that model for similar tasks
- [ ] Power user mode shows advanced settings
- [ ] Regular mode hides advanced settings
- [ ] Tests pass

---

### Feature Group S: Multi-task & Concurrency

#### S3.S.1 — Task Pool & Concurrent Execution

**Session prompt:**
> Create src/orchestrator/task-pool.ts — manages concurrent task execution. Implements: configurable maxConcurrent (based on hardware detection), task queue (pending tasks wait when pool is full), submit(task) returns a Promise, kill(taskId) stops a running task, getRunning() lists active tasks. Each task runs in its own async context so they don't block each other. The agent can handle a new chat message while a previous browser automation task is running. Important: SQLite is the bottleneck for concurrency — use a mutex/queue for write operations to prevent WAL contention. Wire into the agent loop so incoming messages create tasks in the pool rather than executing synchronously. Write tests: two concurrent tasks execute, pool respects max limit, kill stops a running task.

**Creates:**
```
src/orchestrator/task-pool.ts
tests/unit/orchestrator/task-pool.test.ts
```
**Modifies:** `src/orchestrator/agent-loop.ts` (route through task pool)

**Depends on:** S1.I.4

**Acceptance:**
- [ ] Two tasks execute concurrently
- [ ] Third task waits when max=2
- [ ] Kill terminates a running task
- [ ] SQLite writes don't deadlock
- [ ] Tests pass

---

### 🏁 Sprint 3 Checkpoint

- [ ] Agent resumes after reboot and offers to continue
- [ ] 4 providers available (Anthropic, OpenAI, DeepSeek, Gemini)
- [ ] Community skills installable from GitHub
- [ ] Concurrent tasks execute without blocking
- [ ] All tests pass

---

## Sprint 4 — Polish & Stretch Goals

> **Goal:** Production-readiness, stretch features for those who want them.
> **Estimated sessions:** Open-ended, pick what interests you.
> **No exit criteria** — this is the ongoing improvement sprint.

---

### Feature Group T: Stretch Goals (Pick & Choose)

#### S4.T.1 — Ollama Local Model Support

**Session prompt:**
> Create src/providers/ollama.ts implementing LLMProvider. Connects to Ollama's local API at the configured base URL (default http://localhost:11434). List available models, chat, stream. Zero cost (all local). Add to model router as the cheapest tier — route simple tasks to Ollama when available. Gate behind 16GB+ RAM hardware check. Include setup instructions in the onboarding wizard (optional step). Write tests with mock Ollama API.

---

#### S4.T.2 — Voice Input/Output

**Session prompt:**
> Add voice support. (1) Voice input: accept audio attachments on channels, transcribe using Whisper (Groq API for cloud, or local whisper.cpp for 16GB+ systems). (2) Voice output: generate TTS audio responses using a configurable TTS provider (ElevenLabs API or local qwen3-tts). Add as a toggle in settings. Gate behind hardware requirements. This is a new tool, not a channel — it augments existing channels with audio capability.

---

#### S4.T.3 — Agent Hierarchy (Multi-Agent Rating)

**Session prompt:**
> Implement the agent rating system. After a task executed by a small/local model, optionally have a medium model rate the output quality (0-1 score + feedback). If quality < threshold, automatically retry with a better model. Store ratings to improve future routing. This builds on S3.R.2's routing history. Add a new config option: `preferences.enableQualityChecks: boolean`.

---

#### S4.T.4 — More Channels (Slack, WhatsApp, Signal)

**Session prompt:**
> Each channel is a separate WI. They all follow the ChannelAdapter interface. (1) Slack: use @slack/bolt, Socket Mode (no public URL needed). (2) WhatsApp: use whatsapp-web.js or Baileys. (3) Signal: use signal-cli or libsignal. Each needs: connect, message normalization, response sending, allowFrom filtering, graceful disconnect.

---

#### S4.T.5 — Install Script & Documentation

**Session prompt:**
> Create: (1) scripts/install.sh — curl-pipeable installer that checks for Node.js 20+, installs lil-dude globally, runs onboarding. (2) scripts/install.ps1 — Windows equivalent. (3) Comprehensive README.md with: hero image, elevator pitch, feature list, quick start, configuration reference, skill development guide, security model explanation, contributing guide. (4) docs/ directory with detailed guides. Target audience: someone watching a YouTube tutorial.

---

---

## Session Workflow Cheat Sheet

**Starting a session:**
```
1. Open Claude Code in the lil-dude project directory
2. Say: "I'm working on work item [S0.D.1]. Here are the details: [paste WI]"
3. Say: "The project has CLAUDE.md with full conventions. Read it first."
4. Let Claude Code implement, then verify the acceptance criteria.
```

**Ending a session:**
```
1. Run: npm run typecheck
2. Run: npm test (or the specific test for this WI)
3. Run: git add -A && git commit -m "[S0.D.1] Command parser & dangerous patterns"
4. Verify no new any types: grep -r ": any" src/ (should be minimal)
```

**If a WI takes more than one session:**
Split it at a natural boundary and commit the partial work. Start the next session with "I'm continuing [S0.D.1]. Here's what's done so far: [files created]. Here's what remains: [remaining items]."

---

## Dependency Graph (Visual)

```
Sprint 0: Foundation
  A.1 (scaffold) ──→ A.2 (types/errors) ──→ B.2 (config)
       │                                        │
       └──→ B.1 (logger) ──→ B.3 (hw/shutdown) │
                                                 │
                              B.2 ──→ C.1 (db) ─┤
                                       │         │
                              C.1 ──→ C.2 (dal: config, tasks)
                              C.1 ──→ C.3 (dal: convos, knowledge)
                              C.1 ──→ C.4 (dal: tokens, cron, security, approvals)
                                                 │
       A.2 ──→ D.1 (cmd parser) ──→ D.2 (permissions, sandbox)
       A.2 ──→ D.3 (injection, spotlighting)     │
                                                  │
       A.2 + C.4 ──→ E.1 (cost engine)          │
                                                  │
       All above ──→ F.1 (CLI doctor)            │

Sprint 1: MVP Agent
       E.1 ──→ G.1 (anthropic) ──→ G.3 (mock + router)
       E.1 ──→ G.2 (openai)    ──→ G.3
                                     │
       D.2 ──→ H.1 (tools: shell, fs, http)
       H.1 ──→ H.2 (tools: knowledge, scheduler, executor)
                                     │
       E.1 + C.3 ──→ I.1 (system prompt, context builder)
       I.1 + G.3 ──→ I.2 (summarizer)
       C.4 ──→ I.3 (approval queue)
       All I + H ──→ I.4 (agent loop) ← CENTRAL
                                     │
       A.2 ──→ J.1 (webchat) ──→ J.2 (discord) ──→ J.3 (telegram)
                                     │
       C.* ──→ K.1 (gateway/api) ──→ K.2 (react panel)
                                     │
       All ──→ L.1 (onboarding) ──→ L.2 (main wiring)

Sprint 2: Skills & Automation
       L.2 ──→ M.1 (skill loader) ──→ M.2 (deterministic executor)
                                        │
       M.2 ──→ N.1 (reminders) ──→ N.2 (web-search) ──→ N.3 (stocks)
       M.2 ──→ N.4 (flights, browser) ──→ N.5 (calendar, oauth)
                                        │
       N.* ──→ O.1 (briefing) ──→ O.2 (auto-summarize, imessage)

Sprint 3: Power Features
       L.2 ──→ P.1 (startup resume)
       G.2 ──→ Q.1 (deepseek, gemini)
       M.1 ──→ R.1 (skill hub)
       G.3 ──→ R.2 (advanced routing)
       I.4 ──→ S.1 (task pool)
```

---

*Total work items: 38 (Sprint 0: 12, Sprint 1: 14, Sprint 2: 9, Sprint 3: 5, Sprint 4: 5 optional)*
*Estimated sessions: 42-50 for Sprints 0-3, open-ended for Sprint 4*
