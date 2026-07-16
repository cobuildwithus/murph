# Delete usage-notice compatibility fence

Status: completed
Created: 2026-07-15
Updated: 2026-07-15

## Goal

- Convert persisted legacy usage-limit notice delivery keys to the current
  period key, then delete the legacy-key reader and allowance-period marker
  fence so the delivery row is the only durable dispatch owner.

## Success criteria

- A one-time production operator transaction promotes one delivery owner for
  each of the four affected periods before the current-only build is deployed.
- Runtime code reads and claims only the current period-scoped delivery key and
  no longer writes or resets `limit_notice_sent_at`.
- The post-deploy contract lane removes the obsolete marker column and index
  after old Vercel functions drain.
- Compatibility-only tests and documentation are deleted while current-key
  duplicate-send, in-flight, stale-retry, and provider-uncertainty coverage
  remains.

## Scope

- In scope: one operator-only production data correction, the hosted web Prisma
  schema and post-deploy column drop, usage-limit notice delivery ownership,
  focused tests, and current security documentation.
- Out of scope: notice copy, allowance calculation, provider transport,
  historical completed plans, and unrelated delivery types.

## Constraints

- Preserve the one-delivery-row-per-member-period invariant without adding a
  replacement state owner, queue, service, feature flag, or runtime fallback.
- Do not add a checked-in data migration, backfill framework, runtime fallback,
  service, or other recovery machinery for four known periods.
- Treat the first current-only deployment as the rollback floor for application
  behavior; after contract cleanup drops the marker, older schema readers are
  unsafe without re-expansion.
- Keep migration and test output count-only; never emit member ids, delivery
  ids, raw keys, or persisted message data.

## Risks and mitigations

1. Risk: deleting the legacy reader while a legacy row remains can send a
   second notice for an active period.
   Mitigation: run and verify the bounded operator transaction before deploying
   the current-only reader.
2. Risk: a current and legacy row may already coexist.
   Mitigation: preserve the current row as the sole readable owner and leave
   the legacy row as inert history; the migration does not delete delivery
   evidence or mutate provider lifecycle state.
3. Risk: warm Vercel functions may still access the marker during deployment.
   Mitigation: remove marker access from the new build, then use the guarded
   post-deploy contract lane only after the prior-function drain and production
   alias recheck.

## Tasks

1. Inventory the production compatibility rows with count-only evidence and
   prepare the exact one-time operator transaction.
2. Delete legacy-key and marker runtime code, tests, and current docs; retain
   only the two-line post-deploy marker column/index cleanup.
3. Run focused tests, Prisma validation/generation checks, required web
   verification, the coverage audit, and the parent review.
4. Close the plan with a scoped commit, push, open the intent-complete PR, and
   run CI plus exact-head ReviewGPT concurrently.

## Decisions

- A database rewrite is necessary because production contains legacy delivery
  rows whose periods have not all drained; time-based deletion alone would
  violate once-per-period delivery ownership.
- Keep the four-period rewrite out of repository architecture. It is a bounded
  operator action against known rows, and PR #465 already recognizes the
  rewritten current keys.
- Keep current-plus-legacy coexistence rows intact as historical evidence. The
  current row already owns dispatch, and deleting the unused legacy row is not
  required for correctness.

## Verification

- Commands to run: count-only production preflight/postflight queries; focused
  Vitest for delivery ownership; Prisma validate and generate; required web typecheck/test/build or
  repository-routed equivalents; `git diff --check`; stale compatibility
  reference scan; required coverage-write and security/privacy review; exact-
  head PR preflight, ReviewGPT, CI, and merge-tree proof.
- Expected outcomes: the operator postflight proves one current-key owner for
  all four affected periods; all checks pass; no live marker or legacy
  usage-notice reader remains.

## Completion evidence

- The guarded production operator transaction promoted four period owners.
  Read-only postflight found five current-key rows globally, one intentionally
  retained legacy history row, and zero legacy periods without a current owner.
- Focused usage/Linq verification passed with 201 tests and four opt-in skips;
  the production migration guard passed all 33 tests; Prisma validation,
  generation, and the web typecheck passed.
- The repository acceptance lane completed the workspace typechecks, web
  build/lint/test suite, and Cloudflare verification. Its concurrent package-
  coverage tail hit resource-pressure failures in untouched packages; each
  named timeout or preemption test passed when rerun alone.
- The required coverage-write audit found the surviving current-key duplicate,
  in-flight, stale-reclaim, provider-uncertainty, cross-source, retry-generation,
  and ambiguous-send proofs sufficient and made no edits.
Completed: 2026-07-15
