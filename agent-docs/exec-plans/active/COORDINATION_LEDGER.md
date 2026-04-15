# Coordination Ledger

Active coding work must register here before code changes begin.
Rows are active-work notices by default, not hard file locks.
Use `Notes` to mark a lane as exclusive when overlap is unsafe, such as a large refactor or delicate cross-cutting rewrite.

| Agent | Scope | Plan | Files | Symbols | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Codex | Verify OpenRouter gateway-driver compatibility and update runtime resolution if supported | `agent-docs/exec-plans/active/2026-04-13-openrouter-gateway-driver.md` | `packages/operator-config/**`, `packages/assistant-engine/**` | `resolveAssistantRuntimeTarget`, `resolveOpenAiCompatibleProviderOptions` | in_progress | Narrow runtime-target change; avoid unrelated provider refactors. |
| Codex | Hard-cut recurring assistant scheduling to the vault timezone and unify recurring scheduler seams | `agent-docs/exec-plans/active/2026-04-15-vault-local-automation-timezones.md` | `packages/contracts/**`, `packages/core/**`, `packages/query/**`, `packages/operator-config/**`, `packages/assistant-engine/**`, `packages/vault-usecases/**`, `packages/cli/**`, `docs/**`, `ARCHITECTURE.md` | `automationScheduleSchema`, `resolveAssistantCronScheduleForVault`, `projectCanonicalAssistantCronJob`, `claimNextDueAssistantCronJob`, `finalizeAssistantCronJobAfterRun`, `createAssistantFoodAutoLogHooks` | in_progress | Cross-cutting scheduler refactor. Treat as exclusive on automation/cron/runtime-state files; preserve unrelated hosted-onboarding edits. |
| Codex | Tighten hosted onboarding copy on the join flow and signup text | `—` | `apps/web/src/lib/hosted-onboarding/linq.ts`, `apps/web/src/components/hosted-onboarding/join-invite-stage-panels.tsx`, `apps/web/test/join-invite-client.test.ts` | `buildHostedInviteReply`, `JoinInviteCheckoutButton` | in_progress | Copy-only touch in hosted onboarding. Coordinate carefully with the active transaction-ownership refactor and avoid unrelated behavioral changes. |
