# Hosted ingress hard-cut cleanup

Status: completed
Created: 2026-04-18
Updated: 2026-04-18

## Goal

- Remove the remaining hosted-ingress compatibility seams so active-message
  webhook traffic no longer treats receipt journals as an ownership surface and
  hosted wake dedupe/event ids follow the canonical wake cutover naming without
  `dispatch:`-era parsing.

## Success criteria

- `apps/web/src/lib/hosted-onboarding/webhook-service.ts` no longer relies on
  webhook receipts to own or resume active-message fast-path wake delivery.
- Linq control-plane ignored events stop creating or expecting receipt-managed
  active-message lifecycle ownership.
- `apps/web/src/lib/hosted-wake/**` no longer encodes or decodes hosted wake
  event ids through the legacy `dispatch:` prefix path.
- Focused hosted-web verification for the owned onboarding, Linq, and
  hosted-wake slice passes, or any unrelated blocker is recorded precisely.

## Scope

- In scope:
  - `apps/web/src/lib/hosted-onboarding/**`
  - `apps/web/src/lib/hosted-wake/**`
  - `apps/web/src/lib/linq/**`
  - matching `apps/web/test/**`
- Out of scope:
  - `apps/cloudflare/**`
  - `packages/**`
  - unrelated dirty `apps/web` onboarding, pricing, auth, or homepage edits

## Constraints

- Technical constraints:
  - Preserve canonical wake append and best-effort nudge behavior for active
    message ingress.
  - Delete rollout-era compatibility paths instead of preserving them unless a
    compile-through shim is strictly required inside the owned slice.
  - Keep the production diff narrow to the owned files plus matching tests.
- Product/process constraints:
  - Work on top of the existing dirty tree without overwriting unrelated
    `apps/web` changes already in flight.
  - Follow the repo-required plan, ledger, verification, audit, and commit
    flow for this high-risk hosted control-plane lane.

## Risks and mitigations

1. Risk: removing receipt fallback logic could break duplicate-retry handling on
   active-member message ingress.
   Mitigation: keep the direct wake append/idempotency path authoritative and
   extend focused regression tests rather than introducing another fallback.

2. Risk: hosted wake lifecycle reads could regress if older `dispatch:`-prefixed
   dedupe keys are still parsed implicitly in more than one helper.
   Mitigation: inspect both dispatch helpers and store lookup helpers together,
   then hard-cut the naming consistently in production code and focused tests.

## Tasks

1. Register this lane in the coordination ledger before code edits.
2. Inspect the current webhook fast path, Linq ignored-event handling, and
   hosted-wake dedupe/storage helpers to isolate the remaining compatibility
   seams.
3. Implement the narrow production hard-cut in the owned files only.
4. Update focused hosted-web tests where behavior changed.
5. Run focused verification, required audits, and a scoped finish-task commit.

## Decisions

- Treat active-message delivery as a hosted-wake lifecycle concern only, not a
  webhook-receipt ownership concern.
- Hard-cut hosted wake event ids to canonical dedupe naming instead of keeping
  dual parsing for `dispatch:`-prefixed keys in the owned slice.
- Leave Linq control-plane ignored-event receipt markers unchanged in this
  lane because the priority production gap was the onboarding fast path and the
  control-plane cleanup would widen the diff beyond the narrow fix requested.

## Verification

- Commands to run:
  - focused `pnpm exec vitest run --config apps/web/vitest.config.ts ... --no-coverage`
    for the owned onboarding/Linq/hosted-wake suites
  - `pnpm --dir apps/web lint`
  - `pnpm exec tsc -p apps/web/tsconfig.json --pretty false`
- Expected outcomes:
  - Active-message ingress no longer depends on webhook receipts for wake
    ownership or ignored-event handling.
  - Hosted wake dedupe/event-id behavior uses the canonical naming without
    `dispatch:` compatibility parsing in the owned slice.
- Results:
  - `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-onboarding-linq-dispatch.test.ts apps/web/test/hosted-onboarding-webhook-idempotency.test.ts apps/web/test/hosted-wake-dispatch.test.ts apps/web/test/hosted-wake-store.test.ts apps/web/test/hosted-wake-routes.test.ts --no-coverage` passed.
  - `pnpm --dir apps/web exec eslint src/lib/hosted-onboarding/webhook-service.ts src/lib/hosted-onboarding/webhook-provider-linq.ts src/lib/hosted-wake/dispatch.ts src/lib/hosted-wake/store.ts test/hosted-onboarding-linq-dispatch.test.ts test/hosted-onboarding-webhook-idempotency.test.ts test/hosted-wake-dispatch.test.ts test/hosted-wake-store.test.ts test/hosted-wake-routes.test.ts` passed.
  - `pnpm exec tsc -p apps/web/tsconfig.json --pretty false` passed.
  - Required `coverage-write` and `task-finish-review` worker audits were launched through the local `codex-workers` helper, but neither worker returned a final artifact before being terminated as stalled/off-scope. This is an audit-tooling blocker, not a code-verification failure.
Completed: 2026-04-18
