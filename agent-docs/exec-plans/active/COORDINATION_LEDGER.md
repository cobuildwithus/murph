# Coordination Ledger

Active coding work must register here before code changes begin.
Rows are active-work notices by default, not hard file locks.
Use `Notes` to mark a lane as exclusive when overlap is unsafe, such as a large refactor or delicate cross-cutting rewrite.

| Agent | Scope | Files | Symbols | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| Codex | Reduce hosted UX latency in webhook, share-acceptance, and device-sync wake paths | `agent-docs/exec-plans/active/{COORDINATION_LEDGER.md,2026-04-08-hosted-latency-followups.md}`, `apps/web/{app/api/internal/hosted-onboarding/webhook-receipts/cron/route.ts,app/api/hosted-onboarding/linq/webhook/route.ts,vercel.json,README.md,src/lib/{hosted-onboarding/{webhook-service.ts,webhook-receipt-engine.ts,webhook-receipt-store.ts,webhook-receipts.ts},hosted-share/acceptance-service.ts,device-sync/wake-service.ts,hosted-execution/outbox.ts},test/{hosted-onboarding-linq-dispatch.test.ts,hosted-onboarding-linq-route.test.ts,hosted-onboarding-webhook-idempotency.test.ts,hosted-onboarding-webhook-receipt-cron.test.ts,device-sync-hosted-wake-dispatch.test.ts,hosted-share-acceptance.test.ts,hosted-execution-routes.test.ts}}` | deferred webhook receipt draining, receipt cron recovery, immediate outbox drains | in_progress | Preserve adjacent hosted-web changes; do not touch unrelated invite diagnostics work beyond shared files if conflicts appear. |
| Codex | Add Vercel Analytics and Speed Insights to the hosted web root layout | `agent-docs/exec-plans/active/{COORDINATION_LEDGER.md,2026-04-08-vercel-analytics-root-layout.md}`, `apps/web/{app/layout.tsx,package.json}`, `pnpm-lock.yaml` | `RootLayout` | in_progress | Keep scope to hosted-web analytics wiring only; preserve adjacent hosted-web edits and avoid unrelated layout or style changes. |
