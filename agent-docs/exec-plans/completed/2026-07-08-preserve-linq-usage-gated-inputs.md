# Preserve Linq Usage-Gated Inputs

## Goal

Preserve user-authored Linq conversation messages that arrive while hosted AI usage is exhausted so they can be processed after an upgrade or reset, instead of being stopped before mailbox append.

## Scope

- Trace current hosted subscription/AI-usage gate behavior for conversation ingress.
- Keep user conversation input as durable mailbox work before usage denial.
- Preserve existing one-per-period usage-limit notice behavior through runtime reconciliation.
- Add focused regressions for active-member and thread-route Linq ingress.

## Constraints

- Do not change daily Linq text quota behavior.
- Do not add new persisted state or a second queue.
- Keep usage/model spend gated at runtime reconciliation and mailbox consumption.
- Preserve user-facing reply safety and no duplicate usage-limit notices.
- Fit with PR #465 by leaving durable usage-limit notice send/idempotency owned by runtime reconciliation and Linq transport, not by webhook ingress.

## Working Set

- `apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts`
- `apps/web/src/lib/hosted-orchestration/runtime-reconciliation-facts.ts`
- `apps/web/src/lib/hosted-execution/usage-limit-notice.ts`
- `apps/web/test/hosted-onboarding-linq-dispatch.test.ts`
- `apps/web/test/hosted-onboarding-linq-thread-route.test.ts`
- `apps/web/test/hosted-onboarding-linq-usage-reset-e2e.test.ts`
- `apps/web/test/hosted-orchestration-reconciliation-facts.test.ts`
- `ARCHITECTURE.md`
- `apps/web/README.md`
- `apps/cloudflare/DEPLOY.md`

## Verification Plan

- Focused affected tests for Linq usage-gated webhook behavior.
- `pnpm test:diff` scoped to touched files if practical.
- Required typecheck/test command per verification routing, or document unrelated blockers.

## Status

- Trace complete: runtime mailbox fetch already leaves denied conversation items unconsumed, but Linq webhook admission checked AI usage before appending and could return a quota reply/ignored plan without preserving the message.
- Implementation complete: Linq active-member and explicit thread ingress keep daily quota gating pre-append but remove the pre-append AI usage gate so conversation messages become durable mailbox work before runtime admission.
- PR #465 compatibility checked against `origin/pr-465`: the post-PR delta is limited to deleting webhook-time AI usage admission from `webhook-provider-linq.ts`; PR-owned durable notice delivery files are intentionally left alone.
- Review-driven runtime fixes complete: denied facts keep `retryAfter`, Linq trial-conversion notices send from runtime without a quota claim token, and runtime notice selection scans a bounded pending conversation slice so older email/WhatsApp work cannot mask the first notice-capable Linq/Telegram wake.
- Verification complete except for one final parallel `pnpm test:diff` smoke timeout under heavy verifier load: focused Linq/runtime Vitest, touched-file ESLint, `apps/web` typecheck, `git diff --check`, and prepared `apps/web dev:smoke` passed; the final diff verifier passed Cloudflare verify, web tests/lint/build, then failed only the parallel web `dev:smoke` boot timeout.
Status: completed
Updated: 2026-07-08
Completed: 2026-07-08
