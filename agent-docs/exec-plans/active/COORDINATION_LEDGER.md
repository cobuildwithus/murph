# Coordination Ledger

Active coding work must register here before code changes begin.
Rows are active-work notices by default, not hard file locks.
Use `Notes` to mark a lane as exclusive when overlap is unsafe, such as a large refactor or delicate cross-cutting rewrite.

| Agent | Scope | Files | Symbols | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| Codex | Integrate the assistant iMessage delivery and Ink chat patch onto the current assistant runtime. | `packages/cli/src/assistant-*`, `packages/cli/src/commands/assistant.ts`, `packages/cli/src/incur.generated.ts`, `packages/cli/package.json`, assistant-related `packages/cli/test/*`, `docs/contracts/03-command-surface.md`, `agent-docs/exec-plans/active/2026-03-17-assistant-imessage-ink.md`, `agent-docs/exec-plans/active/COORDINATION_LEDGER.md` | add outbound assistant channel/delivery symbols, Ink chat UI symbols, assistant deliver command/options/result metadata | in_progress | Non-exclusive lane. Preserve current inbox CLI/generated edits from the Telegram lane and merge on top of the already-landed assistant runtime slice. |
