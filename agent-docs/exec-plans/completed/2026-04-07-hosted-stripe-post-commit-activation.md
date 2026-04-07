## Goal (incl. success criteria):
- Remove Cloudflare-facing side effects from the open Stripe reconciliation transaction in the hosted billing activation lane.
- Success means Stripe event processing commits only local DB facts while the transaction is open, activation provisioning happens after commit, and activation retries remain idempotent and safe.

## Constraints/Assumptions:
- Preserve unrelated dirty-tree edits, especially active hosted webhook/device-sync/share lanes.
- Keep the fix narrow to the live hosted Stripe activation path; RevNet remains runtime-disabled.
- Do not reintroduce durable Stripe payload/archive state while fixing the transaction boundary.

## Key decisions:
- Keep `member.activated` outbox persistence as a local transactional fact by forcing inline outbox enqueue in the activation path.
- Move managed-user crypto provisioning to an explicit post-commit step in Stripe reconciliation.
- Use the deterministic activation outbox event id as the retry anchor so a failed post-commit provision can retry safely without duplicating local facts.

## State:
- in_progress

## Done:
- Re-read the repo workflow, security, reliability, and verification docs for this high-risk hosted billing change.
- Re-read the Stripe reconciliation, activation helper, Cloudflare control, and hosted execution outbox code paths.
- Confirmed the current bug: Stripe reconciliation still performs Cloudflare provisioning and reference-payload staging while the Prisma transaction is open.
- Refactored the live Stripe activation helper to write billing state plus an inline `member.activated` outbox row inside the transaction without provisioning Cloudflare there.
- Moved Stripe receipt completion to a post-commit phase that provisions managed user crypto first and retries the receipt if that provisioning fails.
- Added focused regression coverage for post-commit provisioning failures and inline outbox enqueue semantics.
- Adjusted the shared hosted-execution payload contract so `member.activated` is inline-only, matching the new transactional Stripe activation path.
- Updated `ARCHITECTURE.md` and `apps/web/README.md` to document the post-commit Stripe activation contract.

## Now:
- Run the required audit pass, then finish the scoped commit/handoff flow.

## Next:
- Close the plan and create the scoped commit if the audit does not find a blocking regression.

## Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: whether any non-Stripe activation lane still needs the same post-commit split once RevNet is re-enabled.

## Working set (files/ids/commands):
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `agent-docs/exec-plans/active/2026-04-07-hosted-stripe-post-commit-activation.md`
- `apps/web/src/lib/hosted-onboarding/stripe-billing-policy.ts`
- `apps/web/src/lib/hosted-onboarding/stripe-event-reconciliation.ts`
- `apps/web/src/lib/hosted-execution/outbox.ts`
- `apps/web/test/hosted-onboarding-stripe-event-reconciliation.test.ts`
- `apps/web/test/hosted-execution-outbox.test.ts`
- `ARCHITECTURE.md`
- `apps/web/README.md`
- `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/hosted-onboarding-stripe-event-reconciliation.test.ts apps/web/test/hosted-execution-outbox.test.ts`
- `pnpm --dir apps/web typecheck`
- `pnpm --dir apps/web lint`
Status: completed
Updated: 2026-04-07
Completed: 2026-04-07
