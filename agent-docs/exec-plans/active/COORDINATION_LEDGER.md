# Coordination Ledger

Active coding work must register here before code changes begin.
Rows are active-work notices by default, not hard file locks.
Use `Notes` to mark a lane as exclusive when overlap is unsafe, such as a large refactor or delicate cross-cutting rewrite.

| Agent | Scope | Plan | Files | Symbols | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Codex | Verify OpenRouter gateway-driver compatibility and update runtime resolution if supported | `agent-docs/exec-plans/active/2026-04-13-openrouter-gateway-driver.md` | `packages/operator-config/**`, `packages/assistant-engine/**` | `resolveAssistantRuntimeTarget`, `resolveOpenAiCompatibleProviderOptions` | in_progress | Narrow runtime-target change; avoid unrelated provider refactors. |
| Codex | Cleanup the new runtime-state SQLite warning filter without changing behavior | - | `packages/runtime-state/**` | `installSqliteExperimentalWarningFilter`, `isSqliteExperimentalWarning` | in_progress | Keep scope to runtime-state; avoid app/web overlap while concurrent hosted onboarding edits are in flight. |
| Codex | Hard-cut hosted-onboarding transaction ownership so workflows own tx directly and mutators require tx | `agent-docs/exec-plans/active/2026-04-15-hosted-onboarding-hard-cut-transaction-ownership.md` | `apps/web/src/lib/hosted-onboarding/**`, `apps/web/test/**` | `withHostedOnboardingTransaction`, `reconcileHostedStripeEventById`, `activateHostedMemberForPositiveSource`, `issueHostedInviteForPhone`, `ensureHostedMemberForPhone` | in_progress | Hard-cut refactor. Preserve unrelated dirty `logging.ts`, `webhook-transport.ts`, and `process-warnings.test.ts`. |
