# Coordination Ledger

Active coding work must register here before code changes begin.
Rows are active-work notices by default, not hard file locks.
Use `Notes` to mark a lane as exclusive when overlap is unsafe, such as a large refactor or delicate cross-cutting rewrite.

| Agent | Scope | Plan | Files | Symbols | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Codex | Verify OpenRouter gateway-driver compatibility and update runtime resolution if supported | `agent-docs/exec-plans/active/2026-04-13-openrouter-gateway-driver.md` | `packages/operator-config/**`, `packages/assistant-engine/**` | `resolveAssistantRuntimeTarget`, `resolveOpenAiCompatibleProviderOptions` | in_progress | Narrow runtime-target change; avoid unrelated provider refactors. |
| Codex | Land returned hosted auth/onboarding wake patch for phone, Telegram, and email messaging-state handling | `agent-docs/exec-plans/active/2026-04-15-telegram-email-phone-auth-wake.md` | `apps/web/**`, `packages/hosted-execution/**` | `completeHostedAuth`, `buildHostedInvitePageData`, `resolveHostedMessagingState`, `resolveHostedFirstContact` | in_progress | Supplied patch landing from ChatGPT wake flow; keep scope to downloaded artifact and avoid unrelated hosted auth refactors. |
