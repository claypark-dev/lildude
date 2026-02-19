# CLAUDE.md — Lil Dude Development Instructions

## What Is This Project
Lil Dude is an open-source, self-hosted personal AI executive assistant.
TypeScript/Node.js application. Runs on user's local machine. Connects to
messaging platforms. Automates tasks. Keeps costs low and systems safe.

## Guiding Principles (in priority order — NEVER violate)
1. SECURITY: Every feature passes through the security layer. No shortcuts.
2. COST: Minimize token usage in every decision. Deterministic > AI.
3. PERFORMANCE: Fast, low memory, responsive.
4. APPROACHABILITY: Non-developers can set this up.

## Tech Stack
- Node.js 20+, TypeScript (strict mode, ESM)
- Fastify (HTTP), ws (WebSocket)
- better-sqlite3 (database)
- React 18 + Vite + Tailwind CSS (web panel)
- Vitest (testing)
- pino (logging)
- zod (validation)
- tsup (build)

## HARD RULES — Claude Code MUST follow these

### Never Do:
- NEVER make an LLM call without checking the cost engine (canAfford) first
- NEVER execute a shell command without the security sandbox
- NEVER process external content without wrapUntrustedContent()
- NEVER log API keys, tokens, or secrets (redact with pino redaction)
- NEVER use `any` type — use explicit types or `unknown` with type guards
- NEVER put business logic in channel adapters — they only normalize in/out
- NEVER access SQLite directly — always go through src/persistence/
- NEVER string-match for security — always parse commands
- NEVER skip error handling — every async function needs try/catch
- NEVER commit node_modules, .env files, or user config

### Always Do:
- ALWAYS log security-relevant actions to security_log
- ALWAYS track token usage for every LLM call
- ALWAYS validate external input with Zod schemas
- ALWAYS use `nanoid()` for generating IDs
- ALWAYS handle graceful shutdown (SIGINT/SIGTERM)
- ALWAYS test security functions with bypass attempts
- ALWAYS prefer deterministic execution over LLM calls
- ALWAYS include JSDoc on public functions
- ALWAYS use dependency injection for testability

### Code Style:
- Files under 300 lines (split if larger)
- One module = one responsibility
- async/await everywhere, never raw .then()
- Named exports, not default exports
- Descriptive variable names (not `x`, `data`, `result`)
- Error classes extend LilDudeError
