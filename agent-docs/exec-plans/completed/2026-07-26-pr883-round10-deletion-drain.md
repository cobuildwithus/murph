# Close the PR 883 deletion-drain race

Status: completed
Created: 2026-07-26
Updated: 2026-07-26

## Goal

- Resolve the round-10 ReviewGPT finding that an account-delete request can
  pass the unset maintenance guard, remain before its admission marker while
  the maintenance deployment activates, and resume after the one post-cursor
  query.
- Preserve the one-shot migration shape and existing synchronous Web deletion
  owner without adding durable state, a queue, lease, second authority, or
  reconciliation process.

## Protected invariants

- The destination bucket is not created until every marker-bearing request
  that could have crossed the pre-maintenance boundary has an exact safe
  terminal disposition.
- A request that begins destructive deletion emits terminal proof only after
  the existing aggregate Cloudflare result confirms all R2 and Durable Object
  cleanup.
- Authentication, validation, maintenance rejection, and other failures before
  destructive deletion are provably safe without consuming or inventing
  member identifiers in logs.
- Account deletion remains available outside the bounded maintenance window and
  remains truthfully deferred inside it.

## Evidence and retrospective decision

- Round 10 proved the split scan is racy: a request can pass the unset guard,
  pause in body/auth/challenge work, miss the post-cursor admission query, then
  enter deletion after destination creation.
- The same scan-boundary mechanism repeated the round-9 finding, so another
  cursor adjustment is not acceptable.
- The authoritative admission-closing instant is the maintenance deployment at
  100 percent traffic with Vercel's Skew Protection Threshold advanced to that
  exact deployment. The traffic percentage alone does not retire skew-pinned
  predecessors.
- The existing request owner can provide complete proof by emitting one
  identifier-free entry marker before guards or awaits and a paired safe
  terminal marker on every pre-effect exit or only after aggregate deletion
  success.
- A marker-bearing preparatory deployment gets the same threshold treatment
  after one full function lifetime of observable quiet. The current Vercel
  project has Skew Protection enabled, and current CLI JSON exposes one request
  event with `id`, `deploymentId`, `requestPath`, `requestMethod`, and nested
  `logs`, so the runbook validates the actual correlation surface rather than a
  presumed `requestId` field.
- The runbook drains that one request-owned pair after activation. New
  maintenance-version requests are harmless rejections; every older invocation
  capable of deletion is already represented by the entry marker.

## Tasks

1. Replace the late admission marker with request-entry and safe-terminal
   semantics at the existing delete route.
2. Add a focused held-pre-effect regression for both aggregate-success and
   aggregate-false outcomes.
3. Delete the split historical/post-cursor scan from the runbook and document
   one activation-and-drain sequence with explicit predecessor retirement.
4. Run focused route tests, Web typecheck, runbook shell syntax checks,
   canonical diff and acceptance verification, parent final review, CI, and the
   next exact-head ReviewGPT round.
5. Close this plan through the normal scoped final commit path and leave PR 883
   open and unmerged.
Completed: 2026-07-26
