# Coordination Ledger

Active coding work must register here before code changes begin.
Rows are active-work notices by default, not hard file locks.
Use `Notes` to mark a lane as exclusive when overlap is unsafe, such as a large refactor or delicate cross-cutting rewrite.

| Agent | Scope | Plan | Files | Symbols | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Codex | Decouple hosted Privy layout boot from contact-privacy env |  | `apps/web/app/layout.tsx`, `apps/web/src/lib/hosted-onboarding/landing.ts`, `apps/web/test/layout.test.ts`, `apps/web/test/hosted-onboarding-landing.test.ts` | `requireHostedPrivyClientAppId`, root layout Privy bootstrap | in_progress | Narrow apps/web patch to unblock prerender without weakening hosted contact-privacy enforcement; avoid overlapping device-sync files already in flight. |
| Codex | land hosted-execution outbox, assistant retry-policy, and hosted-email route patch |  | `packages/hosted-execution/**`, `packages/assistant-engine/src/assistant/outbox/retry-policy.ts`, `packages/assistant-engine/test/assistant/outbox/retry-policy.test.ts`, `apps/cloudflare/src/hosted-email/routes.ts`, `apps/cloudflare/test/hosted-email/routes.test.ts` | `buildHostedExecutionOutboxPayload`, `normalizeAssistantDeliveryError`, hosted verified-sender route state | in_progress | Narrow patch landing. Preserve unrelated in-flight edits in assistant-engine, cloudflare, and root manifests. |
