# Coordination Ledger

Active coding work must register here before code changes begin.
Rows are active-work notices by default, not hard file locks.
Use `Notes` to mark a lane as exclusive when overlap is unsafe, such as a large refactor or delicate cross-cutting rewrite.

| Agent | Scope | Plan | Files | Symbols | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Codex | Verify OpenRouter gateway-driver compatibility and update runtime resolution if supported | `agent-docs/exec-plans/active/2026-04-13-openrouter-gateway-driver.md` | `packages/operator-config/**`, `packages/assistant-engine/**` | `resolveAssistantRuntimeTarget`, `resolveOpenAiCompatibleProviderOptions` | in_progress | Narrow runtime-target change; avoid unrelated provider refactors. |
| Codex | Refactor public core canonical writes onto one audited mutation seam and migrate remaining unaudited write surfaces | `agent-docs/exec-plans/active/2026-04-14-audit-write-seam.md` | `packages/core/**`, `packages/contracts/src/constants.ts`, `agent-docs/exec-plans/active/**` | `applyCanonicalWriteBatch`, `writeCanonicalMarkdownDocument`, `deleteCanonicalMarkdownDocument`, `appendJournal`, `updateExperiment` | in_progress | Cross-cutting core refactor lane; avoid overlapping `packages/core` mutation rewrites while this is active. |
| Codex | Add homepage email auth beside Telegram and reuse hosted onboarding completion paths | `agent-docs/exec-plans/active/2026-04-14-homepage-email-auth.md` | `apps/web/src/components/homepage/**`, `apps/web/src/components/hosted-onboarding/**`, `apps/web/test/**`, `agent-docs/exec-plans/active/**` | `HomepageAuthPanel`, `HomepageTelegramAuthButton`, `HomepageEmailAuthButton`, `requestHostedPrivyCompletionWithRetry` | in_progress | Narrow hosted-web auth lane; avoid unrelated settings/auth refactors outside the homepage path. |
| Codex | Move homepage signup legal copy directly below the Telegram option | `-` | `apps/web/src/components/homepage/homepage-auth-panel.tsx`, `apps/web/test/page.test.ts`, `agent-docs/exec-plans/active/COORDINATION_LEDGER.md` | `HomepageAuthPanel` | in_progress | Narrow homepage layout tweak only; avoid overlapping the broader homepage auth lane beyond copy placement. |
