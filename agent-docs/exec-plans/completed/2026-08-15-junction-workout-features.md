# Preserve richer bounded Junction workout context

Status: completed
Created: 2026-08-15
Updated: 2026-08-15

## Goal

- Preserve compact heart-rate, cadence, power, speed, and fixed-distance split
  context from supported Junction workouts without retaining raw stream arrays
  or coordinates.

## Success criteria

- The existing admitted workout-stream owner remains the only fetch and resume
  path, with its bounded workout and sample cardinalities intact.
- Exact workout streams reduce to a validated compact v2 feature with bounded
  splits, stable correction identity, and authoritative withdrawal of omitted
  split facets.
- Workout-stream responses use a narrower route-specific byte limit while
  other SDK requests retain their existing compatibility limit.
- Focused tests, affected typechecks, ReviewGPT, required CI, and current-base
  merge proof pass before merge.

## Scope

- In scope: Junction workout-stream reduction and normalization, route-specific
  response bounds, focused provider/importer coverage, owning documentation,
  and the public changelog item.
- Out of scope: a second workout fetch owner, raw stream persistence, coordinate
  retention, new queueing, or changes to workout admission cardinality.

## Constraints

- Keep the current serial SDK fetch, retry, resume, and compact persistence
  architecture from the stacked base.
- Preserve privacy by allowing only explicitly validated aggregate scalars and
  at most 64 compact fixed-distance split records.
- Corrections must reuse stable provider workout identity and withdraw split
  facets that are absent from a newer version.

## Tasks

1. Reconcile the obsolete stacked implementation with the current base owner.
2. Forward-port only the missing bounded workout feature behavior and tests.
3. Run focused importer, provider, changelog, typecheck, and static proof.
4. Commit and push the exact candidate, then run specialist and final
   ReviewGPT concurrently with required CI.
5. Resolve findings, prove the current-base merge, merge the PR, and retire the
   inactive worktree.

## Decisions

- Drop the obsolete replayed fetch/config architecture because the current base
  already owns admitted workout collection, retries, resume, and persistence.
- Extend that single owner with a v2 compact feature instead of creating a new
  job or durable state owner.
- Use one-kilometer splits for ordinary distance sports and 100-meter splits
  for swimming, omitting a leading partial split and capping output at 64.
- Publish a priority-4 changelog improvement without a visual because the
  change improves retained workout context but adds no new member interaction.

## Verification

- Green: Junction provider suite (259 tests), bounded feature suite (10 tests),
  real-vault workout correction proof, changelog fragments (7 tests), importer,
  device-syncd, and Web typechecks, docs whitespace, and provider request guard.
- The full selected importer rerun hit two unrelated 60-second tests under
  concurrent load; both passed immediately when rerun alone. The affected
  workout tests and corrected v2 real-vault fixture passed.
- Pending: docs drift with this active plan, exact-head ReviewGPT and required
  GitHub checks, parent final diff review, current-base merge-tree proof, merge,
  and worktree retirement.
Completed: 2026-08-15
