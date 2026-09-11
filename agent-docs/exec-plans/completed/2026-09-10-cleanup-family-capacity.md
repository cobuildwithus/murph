# Retire legacy Family capacity readers

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Goal

Use the existing Stripe-reconciled per-tier capacity rows for every Family capacity read. Preserve paid access, mixed-tier limits, growth metrics, and genuine draft billing authority while retiring the obsolete Pulse-total fallback.

## Success criteria

- Family settings, capacity checks, growth counts and MRR derive from per-tier rows.
- Stripe continues atomically dual-writing the aggregate total for older readers.
- Focused Family and growth proof, Web typecheck and complexity guard pass.
- Phase A is a standalone draft PR; later producer and schema cleanup remain separately gated.

## Scope

- In scope: capacity readers, growth predicates, draft classification, relevant tests, owner rollout documentation.
- Out of scope: removing aggregate writes or the Prisma/database column, payment behavior, checkout intent, Stripe identity fields, production mutation.

## Constraints

- Stripe owns paid quantities; its existing transaction owns the tier projection.
- Preserve locks, freshness checks, checkout intent, effect claims, and real Stripe billing history.
- No new tables, queues, provider calls or compatibility infrastructure.
- Keep production evidence and direct identifiers out of repository artifacts.

## Risks and mitigations

1. Unconverged legacy-only groups would lose capacity. Require bounded aggregate convergence proof before deploying the new reader floor.
2. Older growth readers require the aggregate on new paid groups. Keep dual writes through Phase A and drain old readers before Phase B.
3. A pinned Stripe Workflow can outlive an ordinary Web request. Phase C must wait for all pre-Phase-B Workflow executions as well as ordinary functions to settle; the default contract-migration wait is insufficient.

## Tasks

1. Remove aggregate reader dependencies and update the capacity owner contract.
2. Prove exact-tier settings/capacity, growth eligibility and MRR, and draft-history preservation.
3. Run focused checks and inspect the full diff; close this plan in the scoped commit and open a draft PR.

## Decisions

- Phase A retains aggregate dual writes and both Prisma and physical column.
- Phase B removes writes and Prisma field after the reader floor is established.
- Phase C is a separately held contraction after pre-Phase-B durable and request drain.
- Internal implementation cleanup: no member-facing changelog or presentation change.

## Verification

- Passed: focused Family capacity, reconciliation, owner snapshot and growth suites (355 tests). Existing Stripe reconciliation assertions retain aggregate dual-write proof.
- Passed: Web typecheck; complexity:diff against origin/main (three source files; complexity debt decreases by one). Final checks repeated after an indentation-only correction.
- Parent candidate review found no behavior issue; draft capacity and Stripe-history guards remain intact.
Completed: 2026-09-10
