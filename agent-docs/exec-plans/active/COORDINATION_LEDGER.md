# Coordination Ledger

Active coding work must register here before code changes begin.
Rows are active-work notices by default, not hard file locks.
Use `Notes` to mark a lane as exclusive when overlap is unsafe, such as a large refactor or delicate cross-cutting rewrite.

| Agent | Scope | Plan | Files | Symbols | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Codex | Verify OpenRouter gateway-driver compatibility and update runtime resolution if supported | `agent-docs/exec-plans/active/2026-04-13-openrouter-gateway-driver.md` | `packages/operator-config/**`, `packages/assistant-engine/**` | `resolveAssistantRuntimeTarget`, `resolveOpenAiCompatibleProviderOptions` | in_progress | Narrow runtime-target change; avoid unrelated provider refactors. |
| Codex | Cleanup the new runtime-state SQLite warning filter without changing behavior | - | `packages/runtime-state/**` | `installSqliteExperimentalWarningFilter`, `isSqliteExperimentalWarning` | in_progress | Keep scope to runtime-state; avoid app/web overlap while concurrent hosted onboarding edits are in flight. |
| Codex | Review and simplify the new Linq observability slice for shared composition without widening the active first-contact lane | `agent-docs/exec-plans/active/2026-04-15-linq-observability-followup.md` | `packages/operator-config/**`, `packages/assistant-runtime/**`, `apps/web/src/lib/hosted-onboarding/**`, `apps/web/test/**` | `requestLinqJson`, `requestLinqNoContent`, `createHostedAssistantDeliveryJournalError`, `buildHostedLinqSideEffectLogDetails` | in_progress | Restrict edits to the new observability helpers and avoid active first-contact routing/runtime files outside these seams. |
