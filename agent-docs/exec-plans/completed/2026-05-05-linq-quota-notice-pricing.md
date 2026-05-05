# Linq Quota Notice And Pricing Follow-Up

## Goal

Fix two hosted AI usage follow-up risks:

- Allow allowance pricing to fall back from an unrecognized served model decoration to a recognized requested hosted model while keeping raw model fields auditable.
- Send a deterministic Linq-only quota notice from web before runner nudge when the web-owned usage gate denies an inbound active-member Linq message.

## Scope

- `apps/web/src/lib/hosted-execution/usage-allowance.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-provider-linq-shared.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-transport.ts`
- Existing hosted onboarding/Linq tests covering these paths.

## Constraints

- Preserve overlapping Pulse Trial checkout-offer work in hosted billing and usage allowance files.
- Do not broaden this to Telegram or email quota notices.
- Prefer at most one Linq quota notice per day if an existing low-risk state seam supports it; otherwise keep a once-per-existing-state fallback.
- Cloudflare remains final enforcement backstop.

## Verification Plan

- Focused hosted web tests for usage allowance pricing and Linq webhook dispatch/handoff.
- `pnpm test:diff` or the narrowest truthful app-level verification available after edits.
- Required security/privacy, coverage-write, and final review passes per repo workflow.

## State

- Implemented allowance pricing fallback from unrecognized served model ids to recognized requested model ids, with requested/served/source fields in the pricing snapshot.
- Implemented Linq-only usage gate check before active-member mailbox append; denied decisions with notices send a deterministic Linq side effect and reuse `quotaReplySentAt` as the one-per-day quota notice cap.
- Focused Vitest passed for usage allowance, Linq dispatch, and Linq webhook idempotency tests.
- `test:diff` escalated to `apps/web verify`; lint and Next build passed, but the web test phase is red on overlapping Pulse Trial checkout/reconciliation tests unrelated to the quota/pricing follow-up.
Status: completed
Updated: 2026-05-05
Completed: 2026-05-05
