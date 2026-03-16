# Coordination Ledger

Active coding work must register here before code changes begin.
Rows are active-work notices by default, not hard file locks.
Use `Notes` to mark a lane as exclusive when overlap is unsafe, such as a large refactor or delicate cross-cutting rewrite.

| Agent | Scope | Files | Symbols | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| Codex | Port assistant runtime CLI slice from provided archive into current tree | `packages/cli/src/assistant-*`, `packages/cli/src/commands/assistant.ts`, `packages/cli/src/vault-cli.ts`, `packages/cli/src/index.ts`, `packages/cli/src/incur.generated.ts`, assistant-related `packages/cli/test/*`, `ARCHITECTURE.md`, `docs/contracts/03-command-surface.md`, `agent-docs/operations/verification-and-runtime.md`, `README.md` | add `createAssistantCli`, `registerAssistantCommands`, assistant state/provider/runtime symbols, assistant session inspection/output contracts | in_progress | Non-exclusive lane. Preserve unrelated dirty edits in overlapping CLI/docs files and merge on top of current inbox/model changes. |
