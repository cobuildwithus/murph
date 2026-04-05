# Coordination Ledger

Active coding work must register here before code changes begin.
Rows are active-work notices by default, not hard file locks.
Use `Notes` to mark a lane as exclusive when overlap is unsafe, such as a large refactor or delicate cross-cutting rewrite.

| Agent | Scope | Files | Symbols | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| Codex | Deterministic inbound document auto-preservation for assistant automation | `agent-docs/exec-plans/active/{COORDINATION_LEDGER.md,2026-04-05-assistant-inbox-document-preservation.md}`, `packages/assistant-core/src/{inbox-cli-contracts.ts,inbox-app/types.ts,inbox-app/promotions.ts,assistant/automation/scanner.ts,assistant/system-prompt.ts}`, `packages/cli/test/{assistant-runtime.test.ts,inbox-cli.test.ts}`, `ARCHITECTURE.md`, `docs/contracts/01-vault-layout.md` | inbox document preservation, assistant automation scan invariant, prompt guidance | in_progress | Shared live worktree. Keep the change narrow to accepted inbox document attachments and preserve unrelated dirty edits. |
