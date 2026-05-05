# Simple Linq webhook idempotency and notice retry fix

Status: completed
Created: 2026-05-06
Updated: 2026-05-06

## Goal

- Fix Linq webhook duplicate/retry bugs with the smallest durable change: active-member duplicates must not inflate daily inbound counts, and signup/quota notice markers must represent confirmed delivery rather than planned delivery.

## Success criteria

- Duplicate active-member Linq provider deliveries deduped by mailbox append do not increment `HostedLinqDailyState.inboundCount` or start another wake.
- Failed Linq signup/quota direct replies do not populate `onboardingLinkSentAt` or `quotaReplySentAt`; a provider retry can attempt delivery again.
- No new ingress/outbox tables or broad orchestration abstractions are introduced.
- Focused hosted-web Linq tests and required repo verification/audits pass or have documented unrelated blockers.

## Scope

- In scope: Linq hosted onboarding planning/transport, daily notice marker timing, focused Linq webhook tests.
- Out of scope: new provider-neutral ingress receipt tables, broad webhook receipt migrations, live Linq endpoint verification.

## Constraints

- Technical constraints: preserve existing mailbox dedupe ownership; keep `HostedLinqDailyState` as an aggregate/marker store; do not add new persisted state.
- Product/process constraints: preserve privacy guardrails and avoid logging message bodies or contact identifiers.

## Risks and mitigations

1. Risk: sending before marking can allow rare duplicate notices under concurrent distinct over-limit events.
   Mitigation: accept this simpler at-least-once tradeoff over losing notices; keep provider idempotency keys for same-event retries.
2. Risk: reordering active-member logic could skip needed binding updates on duplicates.
   Mitigation: only skip binding/counting/wake for mailbox duplicates; first inserted event still performs normal binding/counting.

## Tasks

1. Reorder active-member Linq mailbox append ahead of binding/quota counting and return duplicate safely.
2. Move signup/quota notice marker writes to post-send success.
3. Add focused regressions for duplicate active-member events and failed notice sends.
4. Run targeted verification, required audits, and commit through `scripts/finish-task`.

## Decisions

- Use the existing mailbox append dedupe as the active-member event idempotency gate.
- Do not introduce a new ingress receipt or side-effect table for this narrow bug fix.

## Verification

- PASS: `pnpm --dir apps/web test -- hosted-onboarding-webhook-idempotency.test.ts hosted-onboarding-linq-transport.test.ts hosted-onboarding-linq-dispatch.test.ts` after implementation and after the simplify follow-up. The app test lane ran 225 files and 1610 tests.
- PASS: `bash scripts/workspace-verify.sh test:diff apps/web/src/lib/hosted-onboarding/linq-daily-state.ts apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts apps/web/src/lib/hosted-onboarding/webhook-provider-linq-shared.ts apps/web/src/lib/hosted-onboarding/webhook-transport.ts apps/web/test/hosted-onboarding-webhook-idempotency.test.ts apps/web/test/hosted-onboarding-linq-dispatch.test.ts apps/web/test/hosted-onboarding-linq-transport.test.ts` before and after the simplify follow-up. This covered dependency policy, workspace boundary checks, stale-name guard, raw payload guard, Prisma generate, generated catalog, dev smoke, lint, app tests, TypeScript, and Next build.
- PASS: `git diff --check -- apps/web/src/lib/hosted-onboarding/linq-daily-state.ts apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts apps/web/src/lib/hosted-onboarding/webhook-provider-linq-shared.ts apps/web/src/lib/hosted-onboarding/webhook-transport.ts apps/web/test/hosted-onboarding-webhook-idempotency.test.ts apps/web/test/hosted-onboarding-linq-dispatch.test.ts apps/web/test/hosted-onboarding-linq-transport.test.ts`.

## Audits

- `simplify`: one low finding; applied by keeping legacy `invite_signin` delivery-only and limiting onboarding notice marking to current `invite_signup`.
- `security-privacy-review`: no findings; noted accepted residual race/idempotency tradeoffs for the simple no-new-table fix.
- `coverage-write`: no edits needed.
- `task-finish-review`: no findings.
Completed: 2026-05-06
