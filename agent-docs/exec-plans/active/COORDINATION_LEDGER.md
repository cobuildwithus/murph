# Coordination Ledger

Active coding work must register here before code changes begin.
Rows are active-work notices by default, not hard file locks.
Use `Notes` to mark a lane as exclusive when overlap is unsafe, such as a large refactor or delicate cross-cutting rewrite.

No active work is currently registered.

| Agent | Scope | Files | Symbols | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| Codex | Event/deadline assistant scheduler patch landing | `agent-docs/exec-plans/active/2026-04-10-assistant-event-driven-scheduler-cutover.md`, `packages/assistant-engine/**`, `packages/assistant-cli/**`, `packages/inbox-services/**`, `packages/inboxd/**`, `packages/assistant-runtime/**`, `packages/assistantd/**`, `apps/cloudflare/**`, `packages/cli/**` | `runAssistantAutomation`, `runAssistantAutomationPass`, `createAssistantAutomationWakeController`, `resolveRunnerNextWakeAt`, parser drain wake flow | in_progress | Cross-cutting refactor lane from returned external patch; treat as overlap-sensitive and preserve unrelated edits, especially pre-existing `packages/cli/test/assistant-service.test.ts` changes. |
| Codex | Full iMessage decommission orchestration | `packages/inbox-services/**`, `packages/inboxd/**`, `packages/inboxd-imessage/**`, `packages/assistant-engine/**`, `packages/assistant-cli/**`, `packages/setup-cli/**`, `packages/operator-config/**`, `packages/core/**`, `packages/cli/**`, `tsconfig*.json`, `vitest.config.ts`, `scripts/**`, `README.md`, `ARCHITECTURE.md`, `apps/web/**`, `docs/contracts/03-command-surface.md`, `agent-docs/**` | inbox connector/source removal, assistant channel removal, setup channel removal, migration-safe stale-state handling, release topology cleanup, docs/legal cleanup | in_progress | Large cross-cutting removal with subagents. Overlaps existing scheduler lane in shared packages; preserve unrelated edits, integrate carefully, and do not revert scheduler changes. |
