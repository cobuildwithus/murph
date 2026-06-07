# Coordination Ledger

Active coding work must register here before code changes begin.
Rows are active-work notices by default, not hard file locks.
Use `Notes` to mark a lane as exclusive when overlap is unsafe, such as a large refactor or delicate cross-cutting rewrite.

| Agent | Scope | Plan | Files | Symbols | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Codex | Assistant response media and Linq delivery | `agent-docs/exec-plans/active/assistant-response-media.md` | `packages/operator-config/src/assistant-cli-contracts.ts`, `packages/operator-config/src/linq-runtime.ts`, `packages/assistant-engine/src/**`, `packages/assistant-cli/src/commands/assistant.ts`, `apps/web/public/assistant-media/catalog.json` | `AssistantResponseMedia`, assistant media commands, outbox media, Linq message parts | In progress | Isolated worktree task. |
