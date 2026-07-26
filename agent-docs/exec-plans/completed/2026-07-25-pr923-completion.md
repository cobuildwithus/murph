# PR 923 completion: stable workout-day closure

Status: completed
Created: 2026-07-25
PR: `#923`
Branch: `agent/challenge-sleep-stage-workout-times`

## Outcome

Land the existing group challenge share PR with:

1. Exact-grant deep-sleep, REM-sleep, workout-session, and member-time-zone
   projections.
2. A compact bounded `read_shared` model result that omits whole members
   explicitly instead of refusing the full standings read.
3. Workout dates that become scoreable only from a producer-owned monotone
   closure fact, so mutable profile time zones or newly imported workouts
   cannot reopen an already closed calendar date.
4. Green canonical verification, a terminal ReviewGPT `PASS`, green PR checks,
   and a conflict-free merge into `main`.

## Protected invariants

- Consent remains exact-scope; existing grants never widen implicitly.
- Canonical event time zone (with validated vault fallback) determines each
  workout's date and local start clock, but mutable profile metadata does not
  own irreversible challenge closure.
- `workouts.v0` keeps a dense seven-date window so a settled empty array remains
  an observed zero. A missing date remains unobserved.
- A stale snapshot may remain pending until the existing ordinary projection
  wake refreshes it, but a reader never advances closure from its own clock.
- Event-local dates beyond the producer's current window are deferred rather
  than erasing unrelated valid dates. Malformed workout data still fails the
  whole projection closed.
- The durable challenge page's dated settled snapshot is not silently rewritten
  by later-arriving health data.
- No new scheduler, queue, database table, persisted-state owner, or provider
  dependency is introduced.

## Smallest owner-aligned correction

1. Keep `time-zone.v0` as human-readable member context only; remove claims that
   it is settlement authority.
2. Anchor `workouts.v0` closure to the fixed `Etc/GMT+12` calendar, the last
   civil time zone to leave a date. Emit the seven dates ending on that
   producer date.
3. Replace transient per-record workout `provisional` flags with one
   `calendarClosedThroughDate` watermark carried by the producer and hoisted
   once in the model-facing `workouts.v0` view.
4. Teach the challenge skill to score a target only when it is at or before the
   producer watermark and to keep stale snapshots pending. Preserve existing
   date behavior for every other scope.
5. Add focused producer, parser, model-view, and challenge-journey regressions
   for timezone mutation, date-line travel, stale snapshots, settled empty
   arrays, and unchanged non-workout scopes.

## Recovered context

- The stopped Claude session is the owner session for PR `#923`.
- Pushed head `26e3dfb78e` contained the completed model compaction work before
  the final settlement correction.
- ReviewGPT round 10 accepted two live blockers:
  mutable declared-time-zone settlement can reopen a date, and a valid
  date-line-crossing workout can currently erase the full seven-day projection.
- The branch has since merged current `main` normally and resolved the
  overlapping protein-day registry additions additively.

## Local completion evidence

- Required local `product-experience-review`: final re-review returned no
  findings after the typed partial-result contract, refresh-timing language,
  exact consent copy, and design study were corrected.
- Preliminary `completion-specialists` ReviewGPT pass: both findings were
  accepted, fixed, and covered without rerunning the one-shot specialist pass.
- Parent final diff and call-path review: complete, including the additive
  protein-day merge resolution and unchanged non-workout projection shapes.
- Canonical
  `pnpm test:diff packages/hosted-execution packages/assistant-runtime packages/assistant-engine apps/web`
  passed guards, affected typechecks, assistant-engine (2,671 tests),
  assistant-runtime (1,871 tests), and earlier reverse dependents before stopping
  on an `origin/main` ReviewGPT-preset audit mismatch outside this PR. The exact
  mismatched files were identical to `origin/main`; upstream fixed that mismatch,
  and its merged focused audit now passes 40 tests with one expected skip.
- Exact final merged owner proof:
  - hosted-execution: 416 tests;
  - assistant-engine: 2,674 tests with the repository-prescribed 6 GiB heap;
  - assistant-runtime: 1,884 tests;
  - Web: 6,554 tests, lint with warnings only, cold dev smoke, and production
    build;
  - merge-overlap Web matrix/tool/registry proof: 101 tests;
  - all four owner typechecks passed.
- Rendered design proof covers desktop and mobile group-join permission states
  with synthetic props and no live requests.

## Remaining PR gates

1. Close this plan with `scripts/finish-task` and push the exact head.
2. Continue the existing final ReviewGPT loop from its immutable baseline until
   `ROUND_OUTCOME: PASS`, concurrently with PR CI.
3. Merge only after green required checks and confirmed clean mergeability, then
   retire the task worktree.
Updated: 2026-07-25
Completed: 2026-07-25
