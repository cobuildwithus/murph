# Junction temporal parent continuation recovery

Status: completed
Created: 2026-08-12
Updated: 2026-08-12

## Goal

- Preserve bounded eventual Junction blood-oxygen and stress history when the
  scheduled reconcile's immediate newest-day work fails or yields.

## Success criteria

- A retryable newest-day failure does not block a healthy temporal sibling.
- Failed, unavailable, and yielded newest-day coordinates become stable jobs on
  the existing device-job queue before the parent reconcile completes.
- Every older resource/day coordinate remains scheduled newest-first.
- Successful work alone carries complete-source-day authority; no samples or
  timeline state are retained.
- Focused tests, package typecheck/coverage, and privacy/diff checks pass.

## Scope

- In scope: Junction reconcile continuation assembly, focused provider tests,
  and the live device-ingestion owner contract.
- Out of scope: a new queue, cursor, lifecycle owner, temporal state table,
  provider sample retention, stack-base integration, ReviewGPT, or merge.

## Constraints

- Technical constraints: reuse stable resource/day jobs and their succeeded/dead
  history; preserve one-running-job-per-account and canonical import ownership.
- Product/process constraints: completed plans remain immutable; ReviewGPT and
  stack integration stay held until the assigned coordination lane opens.

## Risks and mitigations

1. Risk: converting an immediate failure into continuation work could silently
   grant day authority or hide a healthy resource.
   Mitigation: enqueue only the failed/yielded coordinate, continue independent
   resources, and let only a successful child import carry authority.
2. Risk: recovery work could exceed its documented bound.
   Mitigation: retain the 14-day horizon and two resources, for at most two
   immediate collections plus 28 resource/day jobs when both newest resources
   require continuation.

## Tasks

1. [x] Reproduce parent failure and yield starvation with focused regressions.
2. [x] Assemble failed/yielded newest-day jobs with the existing older backlog.
3. [x] Update the live ingestion contract and run focused verification.
4. [x] Prepare the exact remediation head and next-round ledger for scoped
   commit and push.

## Decisions

- Continue with the existing stable per-resource/day job identity. Do not add a
  cursor, table, queue, or generic reconcile state owner.
- A successful newest resource stays immediate. A failed, unavailable, or
  yielded newest resource is queued ahead of older resource/day jobs; unrelated
  temporal siblings continue when the failure is retryable.

## Verification

- Focused regressions passed for retryable newest failure, healthy sibling
  continuation, yielded newest continuation, older backlog preservation, stable
  dedupe, and the three-attempt immediate provider ceiling.
- The full Junction provider file passed: 238 tests.
- `pnpm --dir packages/device-syncd test:coverage` passed: 47 files and 1,001
  tests, with 91.1% statement and 82.73% branch coverage.
- `pnpm --dir packages/device-syncd typecheck`, `pnpm docs:drift`,
  `git diff --check`, and the scoped identifier/privacy scan passed.
- Exact-head ancestry/status and clean-worktree proof remain after commit/push.
Completed: 2026-08-12
