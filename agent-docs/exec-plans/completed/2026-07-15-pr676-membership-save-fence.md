# PR 676 stale membership-save fence

Status: completed
Created: 2026-07-15
Updated: 2026-07-15

## Goal

- Prevent an older existing-member sharing save from recreating membership or
  grants after a later self-leave commits.

## Success criteria

- The join page returns the viewer's current opaque membership id and every
  join-page accept request carries the rendered membership state: that id for
  an update or `null` for an initial join.
- Under the existing group/member locks, the accept transaction rejects a
  missing, replaced, or unexpectedly present membership before it creates a
  row or changes grants.
- A matching existing membership still updates sharing, leave after save still
  ends in the left state, and a reloaded nonmember can explicitly rejoin with a
  fresh membership id.
- Focused race, route, page, client, and store tests pass; exact-head CI and
  ReviewGPT correction verification return clean.

## Scope and constraints

- Reuse membership row identity as the compare-and-set fence and keep row
  presence as membership truth.
- Keep group-reaction joins unchanged; this precondition belongs only to the
  first-party join page that rendered the membership state.
- Do not add a tombstone, epoch, lifecycle state, queue, cross-button manager,
  or client-only race fix.

## Tasks

1. Thread the rendered membership id through join view, page, client, and route.
2. Enforce the locked membership-state precondition before accept effects.
3. Add deterministic serialization and boundary tests.
4. Run focused verification, finish the remediation commit, push, and run
   ReviewGPT round 2 with exact-head CI.
Completed: 2026-07-15
