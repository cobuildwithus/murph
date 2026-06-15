# PR 144 ReviewGPT Round 5 Fixes

## Goal

Resolve the two accepted ReviewGPT findings for PR 144:

1. Claimed inline Linq AI usage-limit replies must use a period-scoped idempotency key instead of an inbound-event-scoped key.
2. Usage-limit notice claims must atomically verify that the stored allowance period still contains the claim timestamp.

## Constraints

- Keep the fix scoped to hosted AI usage-limit notice and Linq webhook side-effect behavior.
- Preserve retryability for real failed sends without allowing duplicate once-per-period notices after ambiguous provider outcomes.
- Preserve trial-conversion/no-claim inline replies as event-scoped.
- Do not weaken hosted ingress, billing, or usage gating invariants.

## Working Set

- `apps/web/src/lib/hosted-execution/usage-allowance.ts`
- `apps/web/src/lib/hosted-execution/usage-gate-notice.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-transport.ts`
- `apps/web/test/hosted-execution-usage-allowance.test.ts`
- `apps/web/test/hosted-onboarding-linq-transport.test.ts`

## Verification Plan

- Focused Vitest for allowance claim behavior and Linq transport idempotency behavior.
- Scoped `pnpm test:diff` over the changed hosted usage and Linq webhook files.
- Required completion audits for hosted external delivery/retry behavior.
- Rerun ReviewGPT on the pushed PR head and continue until zero accepted findings.
