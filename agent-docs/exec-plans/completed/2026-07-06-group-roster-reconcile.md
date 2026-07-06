# Group Roster Reconcile

Status: completed
Created: 2026-07-06
Updated: 2026-07-06

## Goal

- Newly provisioned hosted Linq group containers get one best-effort participant roster reconcile immediately after route creation, so access gates can recognize active participants from message one.

## Success criteria

- `planHostedLinqGroupChatWebhook` records a post-commit reconcile request only after `ensureHostedThreadContainerRouteTx` has confirmed a newly created route.
- The reconcile uses a fresh `getPrisma()` client outside any transaction-owned `input.prisma` path and never performs the Linq roster fetch inside an open DB transaction.
- Roster reconcile failure does not break group route provisioning, mailbox append, or delivery.
- Focused tests prove new-group reconcile writes rows and reconcile failure remains best-effort.

## Scope

- In scope: hosted Linq group provisioning planner and focused hosted web tests.
- Out of scope: routing keys, billing/access predicates, provisioning gates, and the existing `read_chat_participants` trigger.

## Constraints

- Technical constraints: keep the change minimal; no new persisted state; no external Linq fetch inside an open Prisma transaction.
- Product/process constraints: preserve current delivery behavior and commit through the active-plan workflow.

## Risks and mitigations

1. Risk: running roster fetch inside the webhook transaction extends locks and violates provider-call boundaries.
   Mitigation: trace the transaction boundary and call the reconcile only from a post-transaction hook with a fresh root Prisma client.
2. Risk: roster fetch failure blocks provisioning.
   Mitigation: rely on the helper's swallowed errors and keep the call in the post-transaction side-effect lane.

## Tasks

1. Trace `planHostedLinqGroupChatWebhook`, `ensureHostedThreadContainerRouteTx`, and webhook-service transaction handling.
2. Patch the group provisioning planner to enqueue a best-effort post-commit roster reconcile on newly created routes.
3. Add focused hosted web tests for success and failure.
4. Run required verification and final local review.
5. Commit with `scripts/finish-task`.

## Decisions

- Treat this as a post-transaction side effect, not a transaction-internal planner step, because the reconcile performs external Linq HTTP.
- Drain the reconcile in `handleHostedOnboardingLinqWebhook` after `runHostedOnboardingWebhookTransaction` returns, using `getPrisma()` instead of the transaction client passed into the planner.

## Verification

- Passed: `pnpm --dir apps/web prisma:generate`.
- Passed: `pnpm --dir apps/web typecheck`.
- Passed: `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-onboarding-privacy-foundation-migration.test.ts apps/web/test/hosted-onboarding-linq-thread-route.test.ts`.
- Passed: `bash scripts/workspace-verify.sh test:diff apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts apps/web/src/lib/hosted-onboarding/webhook-provider-linq-types.ts apps/web/src/lib/hosted-onboarding/webhook-service.ts apps/web/test/hosted-onboarding-linq-thread-route.test.ts apps/web/test/hosted-onboarding-privacy-foundation-migration.test.ts`.
Completed: 2026-07-06
