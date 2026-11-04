# Meal photo retention retry after failed publication

Status: completed
Created: 2026-11-04
Updated: 2026-11-04

## Outcome and protected invariants

Restore meal photo maintenance after a failed canonical receipt upload. Preserve
canonical rollback, exact full-photo expiry, terminal hosted-media retirement,
and deletion of thumbnails with their meal. No production mutation is authorized.

Outcome: failed thumbnail publication remains retryable after snapshot cleanup.
Reaches: warm and cold-restored workspaces, including other expired meals.
Proof: synthetic upload success, receipt failure, rollback, terminal cleanup,
retry, full-photo tombstones, idempotence, and final thumbnail deletion.

## Cause and smallest correction

Media publication precedes canonical receipt acknowledgement. A failed receipt
rolls back the meal, and snapshot reconciliation correctly retires the uncommitted
thumbnail. Its original photo-hash filename deterministically recreates the same
terminally retired hosted media identity on every attempt.

Use the existing canonical write batch operation ID in newly generated thumbnail
paths. Successful writes and receipt replay retain their recorded paths. Retry
after rollback gets a fresh identity; no retired object is revived and no new
state owner, quarantine, scheduler, or production data repair is required.

## Tasks

1. Add the composed rollback/cleanup/retry regression and prove it fails on base.
2. Change thumbnail naming at its core owner and update the durable contract.
3. Run focused core/runtime tests and both package typechecks; inspect the diff.
4. Measure startup/restore break-even and leave the wait unchanged unless the
   available evidence proves a net saving while preserving expiry deadlines.

## Risks and deployment

Runner release only; Web keeps terminal retirement enforcement. Old readers use
recorded attachment paths. Older writers can still fail until the runner rolls
forward. Public release review and deployment belong to the parent; no commit,
push, PR, or production mutation in this task.

## Verification

- Before the source fix, both warm and cold-restored regression cases failed
  with the terminal media admission error on the supplied base commit.
- After the fix, the full runtime artifact suite passed (24 tests); the core
  meal-photo maintenance suite passed (4 tests).
- Core and assistant-runtime package typechecks passed.
- Changelog generation, the archive page suite (4 tests), and Web typecheck passed.
- `pnpm complexity:diff` and `git diff --check` passed. Candidate review found
  no new state owner or deletion exception. The existing thumbnail readers use
  stored paths; no filename parser requires the old naming convention.
- Product UX: Ready for parent release review. Both recovery paths preserve
  original bytes after failed acknowledgement, retire expired originals on
  retry, keep thumbnails available, do no repeated work, and delete thumbnails
  with their meals. Production convergence awaits an authorized runner deploy.

## Retention wait decision

Leave the existing nearby-expiry wait unchanged. Logged readiness and restore
provide wall-time estimates, but not the incremental boot/restore CPU or the
number of extra starts for each unlogged expiry. The potential saving is small
and does not establish a reliable net-cost benefit. Exact expiry projections
remain untouched. Private measured values are in the task handoff only.

## Changelog and handoff

Added the public-safe `meal-photo-cleanup-recovery` fragment. The parent should
add its source PR number when creating the release PR; none exists in this task.
The public entry can ship with the runner release. Web is otherwise unchanged;
no Temporal deployment, schema migration, or operator data repair is required.

No commit, push, PR, or production mutation was performed, as requested.
Required PR CI and external completion review belong to the parent's shipping
workflow. Local tools were sufficient after the standard dependency install;
no repository-actionable Frog entry was needed.
Private production evidence stays out of repository artifacts.
Completed: 2026-11-04
