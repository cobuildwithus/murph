# Port returned hosted onboarding fixes patch onto current hosted tree

Status: completed
Created: 2026-04-04
Updated: 2026-04-04

## Goal

- Port the returned Pro patch onto the current hosted onboarding/runtime tree so `member.activated` dispatches carry only sparse outbox references, hosted hydration rebuilds first-contact targeting from durable member state, hosted runtime queues the assistant welcome through the normal outbox path, and the old onboarding welcome bookkeeping columns are removed.

## Success criteria

- `member.activated` dispatch creation no longer requires inline first-contact payloads.
- Hosted execution hydration rebuilds first-contact routing from `hosted_member` state for referenced activation events.
- Hosted runtime queues activation welcomes through assistant outbox intents instead of sending inline during the event handler.
- Stripe webhook recovery code uses the reconciliation naming/path consistently.
- Obsolete hosted onboarding schema columns and invite-service writes are removed without regressing current hosted onboarding behavior.
- Required verification and final audit pass complete, or any unrelated blocker is documented precisely.

## Scope

- In scope:
- `apps/web` hosted onboarding, Stripe reconciliation, hydration, schema, and focused tests/docs touched by the returned patch
- `packages/assistant-core`, `packages/assistant-runtime`, and `packages/hosted-execution` changes needed for queued first-contact welcome delivery and sparse activation payloads
- Out of scope:
- unrelated active hosted/runtime lanes already in the worktree
- new product behavior beyond the returned patch’s hosted onboarding intent

## Constraints

- Technical constraints:
- Preserve overlapping dirty-tree work and port intent onto the live files instead of applying stale hunks verbatim.
- Treat this as a hosted trust-boundary/runtime change: keep docs and tests aligned with the behavior.
- Product/process constraints:
- Use the repo completion workflow, including the required final review audit and scoped commit helper.

## Risks and mitigations

1. Risk: The returned patch overlaps active hosted onboarding and assistant-runtime work.
   Mitigation: Compare the patch against current files, keep the delta minimal, and avoid overwriting adjacent in-flight edits.
2. Risk: Schema cleanup can break Prisma-generated types and test fixtures broadly.
   Mitigation: Remove only fields proven unused in runtime code, then update the affected typed fixtures/tests together with the migration.
3. Risk: Changing welcome delivery from send-now to queue-only could alter retry behavior.
   Mitigation: Keep the existing assistant outbox/receipt flow intact and add focused tests for the queued path and sparse activation hydration.

## Tasks

1. Port sparse `member.activated` dispatch creation plus hydration-derived first-contact reconstruction in `apps/web` and `packages/hosted-execution`.
2. Port queued hosted first-contact welcome delivery in `packages/assistant-core` and `packages/assistant-runtime`.
3. Rename the hosted Stripe queue surface to reconciliation, update callers/tests, and keep the behavior identical aside from the already-active-member guard.
4. Remove obsolete hosted onboarding Prisma fields plus the cleanup migration and repair typed fixtures/tests/docs.
5. Run required verification, complete the final audit pass, then finish with the scoped commit helper.

## Decisions

- Use a dedicated execution plan because the returned patch is multi-file, high-risk, and does not apply cleanly on the current dirty tree.
- Port only the still-missing intent from the returned patch; do not blindly mirror the snapshot when current files already contain overlapping hosted changes.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- focused hosted/assistant package tests as needed during implementation
- Expected outcomes:
- Required repo checks pass, or any unrelated pre-existing failure is captured with exact commands and rationale.
Completed: 2026-04-04
