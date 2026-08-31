# Quiesce deleted hosted runtimes

Status: active
Created: 2026-08-30
Updated: 2026-08-31

## Goal

- Stop deleted hosted accounts from retaining self-retrying Temporal runtimes,
  and make failed workflow termination a durable part of canonical account
  deletion cleanup.

## Success criteria

- A runtime whose reconciliation facts prove `user_not_active` with no
  canonical workspace performs no external processing and schedules no retry
  timer while remaining signal-wakeable.
- Existing Temporal histories replay across the behavior change.
- Account-deletion cleanup cannot be declared complete until every captured
  runtime workflow has been terminated or confirmed absent.
- Maximum-cardinality cleanup resumes at its durable contiguous cursor and
  converges without repeatedly issuing an already-confirmed prefix.
- Focused private and public tests, typechecks, required exact-head CI, and
  completion review gates pass.
- The private worker is deployed before the public cleanup contract, and live
  aggregate traffic confirms the retrying cohort becomes quiet.

## Scope

- In scope:
  - Replay-safe private Temporal workflow quiescence.
  - Durable public Temporal termination cleanup receipt state and migration.
  - Focused regression, migration, timeout, and rolling-deploy proof.
  - Cross-repository PR, review, CI, and deployment sequencing.
- Out of scope:
  - Reworking general runtime admission/backoff policy.
  - Mass production workflow mutation outside the normal deploy path.
  - Canary-specific identifiers or cleanup behavior.

## Constraints

- Technical constraints:
  - Web remains the canonical account/workspace state owner; Temporal only
    consumes the existing reconciliation facts.
  - Workflow command ordering changes require a patch marker and replay proof.
  - External termination calls stay outside short database transactions and
    remain bounded by the cleanup attempt deadline.
- Product/process constraints:
  - Account deletion must remain available when a provider is temporarily
    unavailable; the encrypted cleanup receipt owns durable retries.
  - Existing inactive accounts with a retained workspace must keep scheduled
    retention behavior.
  - Existing unrelated PR work and checkout changes remain untouched.

## Risks and mitigations

1. Risk: A broad inactive-user check could suppress legitimate retention work.
   Mitigation: Quiesce only when both `user_not_active` and `workspace: null`
   are authoritative, with a regression for inactive accounts that still own a
   workspace.
2. Risk: New workflow branching could make old histories nondeterministic.
   Mitigation: Gate the branch with `patched()` and run replay fixtures plus
   legacy-path machine tests.
3. Risk: Rolling migration could let old Web code delete an incomplete receipt.
   Mitigation: Add a database deletion guard for the new nullable completion
   column and test old-code/new-schema behavior.
4. Risk: A large account could exhaust the cleanup attempt window.
   Mitigation: Process deterministic batches of four under the shared deadline,
   persist the first unconfirmed runtime index once per attempt, continue
   immediately after progress, and back off only after no progress.

## Tasks

1. Add and verify replay-safe signal-only quiescence in the private workflow.
2. Extend the public durable cleanup receipt and runner with Temporal
   termination completion state and one monotonic next-runtime cursor.
3. Add the additive migration, Prisma mapping, deletion guard, and tests.
4. Run focused verification, typechecks, exact-head reviews, and CI.
5. Deploy the private worker first, then the public migration/Web change, and
   verify aggregate request and processing volume.

## Decisions

- Treat the canary as one caller of a generic account-deletion lifecycle gap;
  fix the canonical lifecycle and runtime boundary instead of adding a
  canary-only exception.
- Preserve the retained pointer while quiescent so a legitimate later signal
  can re-read canonical facts without inventing another state owner.
- Keep deletion fail-open for the member interaction but fail-closed for
  cleanup-receipt completion.
- Keep the encrypted cleanup receipt as the sole retry owner: one integer cursor
  is sufficient, so no bitmap, queue, payload rewrite, or second state owner is
  introduced.

## Verification

- Commands to run:
  - Private focused workflow machine tests and replay test.
  - Private package typecheck and repository `pnpm verify`.
  - Public account-deletion cleanup, workflow-termination, and migration tests.
  - Public affected package typecheck and required scoped checks.
  - Exact-head GitHub checks and required ReviewGPT completion gates in both
    repositories.
- Expected outcomes:
  - Deleted canonical state produces signal-only waiting with zero processing
    effects or retry timers.
  - Pre-patch histories retain their original command path.
  - Incomplete Temporal cleanup remains durable and retryable through rolling
    deployment; a 1,024-runtime receipt advances across bounded attempts, and
    successful/not-found cleanup releases the receipt.
