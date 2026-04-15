# Coordination Ledger

Active coding work must register here before code changes begin.
Rows are active-work notices by default, not hard file locks.
Use `Notes` to mark a lane as exclusive when overlap is unsafe, such as a large refactor or delicate cross-cutting rewrite.

| Agent | Scope | Plan | Files | Symbols | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Codex | Verify OpenRouter gateway-driver compatibility and update runtime resolution if supported | `agent-docs/exec-plans/active/2026-04-13-openrouter-gateway-driver.md` | `packages/operator-config/**`, `packages/assistant-engine/**` | `resolveAssistantRuntimeTarget`, `resolveOpenAiCompatibleProviderOptions` | in_progress | Narrow runtime-target change; avoid unrelated provider refactors. |
| Codex | Remove hosted Linq handoff text and let the canonical first-contact welcome materialize the home thread while preserving home-line re-homing | `agent-docs/exec-plans/active/2026-04-15-hosted-linq-first-contact-home-thread.md` | `apps/web/src/lib/hosted-onboarding/**`, `apps/web/test/**`, `packages/hosted-execution/**`, `packages/assistant-runtime/**`, `packages/assistant-engine/**` | `resolveHostedMemberActivationLinqRoute`, `buildHostedMemberActivationDispatch`, `queueAssistantFirstContactWelcome`, `sendLinqMessage` | in_progress | Cross-package contract change. Preserve dirty `apps/web/src/components/hosted-onboarding/join-invite-copy.ts`. |
| Codex | Cleanup the new runtime-state SQLite warning filter without changing behavior | - | `packages/runtime-state/**` | `installSqliteExperimentalWarningFilter`, `isSqliteExperimentalWarning` | in_progress | Keep scope to runtime-state; avoid app/web overlap while concurrent hosted onboarding edits are in flight. |
