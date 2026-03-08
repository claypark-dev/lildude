# Changelog

All notable changes to Lil Dude will be documented in this file.

## [1.1.0] - 2026-03-08

### Added
- **Artifacts system** - Rich rendering of HTML, SVG, Mermaid diagrams, code (40+ languages), and tables inline in chat. Sandboxed iframes for HTML, DOMPurify sanitization for SVG.
- **Heartbeat proactive agent** - Configurable interval-based background automation that reads standing instructions from `~/.lil-dude/heartbeat.md` and surfaces actionable items. Daily budget cap ($0.50 default), cheapest model selection. Dashboard status widget.
- **4 new messaging channels** - Matrix (E2E encrypted), Microsoft Teams (Bot Framework), LINE (Messaging API), Google Chat (Workspace API). Total: 12 channels.
- **MCP Protocol support** - Connect any Model Context Protocol server as a tool provider. Namespaced tools (`mcp_server_tool`), parallel connection, dynamic add/remove, status monitoring. Full security gate with level-based blocking and path/domain validation.
- **Adaptive memory system** - Zero-cost LLM memory pipeline:
  - Inline fact extraction (regex-based, real-time)
  - Contradiction detection (supersedes stale facts)
  - Entity linking (connects facts across conversations)
  - Behavioral analysis (infers active hours, preferences from SQL)
  - Knowledge lifecycle (auto-eviction, confidence decay, deduplication)
- **Agent naming** - Custom assistant name and persona via `agent.name` and `agent.persona` config. Injected into system prompt.
- **Config template** - `lildude.config.example.json` with all settings documented.
- **Shorebreak marketplace** - Redesigned wave registry as a searchable marketplace with category filters, safety tier badges, install commands, and responsive layout.

### Changed
- Upgraded fastify to 5.8.2 (fixes high-severity DoS vulnerability)
- Landing page redesigned with surfing identity, foundational principles, and manifesto
- Wave registry renamed from "Wave Hub" to "Shorebreak"
- System prompt now supports custom agent identity
- Budget guardrails now include heartbeat daily cap

### Fixed
- npm audit vulnerabilities: ajv ReDoS, minimatch ReDoS, rollup path traversal
- MCP tool execution now passes through security pipeline (was bypassing)
- Heartbeat output now sanitized through output filter before broadcast
- Heartbeat instructions checked for injection before processing

### Security
- MCP tools blocked at security levels 1-2, require approval at level 3
- MCP filesystem tools validated via `checkFilePath()` at all levels
- MCP network tools validated via `checkDomain()` at all levels
- Heartbeat standing instructions scanned for prompt injection
- Heartbeat output filtered for API keys, secrets, and sensitive data
- All MCP security decisions logged to audit trail

## [1.0.0] - 2026-03-01

### Added
- Initial release with 8 messaging channels, 5 LLM providers, wave system, 5-level security sandbox, contact management, self-improvement loop, voice I/O, daily briefings, and web dashboard.
