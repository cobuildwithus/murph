## Goal

Finish the hosted Linq active-member cutover in `apps/web` so active-member Linq webhook handling no longer falls back through `HostedWebhookReceipt` lifecycle ownership.

## Scope

- `apps/web/src/lib/hosted-onboarding/webhook-service.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts`
- focused `apps/web/src/lib/hosted-onboarding/webhook-transport.ts` helpers only if needed for direct draining
- focused `apps/web/test/**` coverage for hosted Linq active-member webhook dispatch/idempotency

## Constraints

- Keep pending-member, invite, and onboarding receipt-backed behavior intact.
- Do not touch `packages/assistant-runtime` or broaden the architecture beyond `apps/web`.
- Preserve deterministic Linq effect ids / idempotency keys for direct side effects.
- Preserve the active-member wake handoff path for `wake-appended-active-member`.

## Verification

- Narrow truthful `apps/web` diff-aware verification if it covers the touched slice; otherwise `apps/web` scoped verify/lint lane per repo policy
- Focused hosted Linq webhook tests covering active-member direct dispatch and receipt avoidance
Status: completed
Updated: 2026-04-18
Completed: 2026-04-18
