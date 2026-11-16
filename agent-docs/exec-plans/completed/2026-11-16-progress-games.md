# Progress games, ladders and streaks

Status: completed
Created: 2026-11-16
Updated: 2026-11-16

## Outcome and scope

Implement BE1 of the locked Progress plan: game contributions, checked height/time
banks, task inference, one streak, permanent awards, goals and the four owned API
routes. Reuse BE0 storage and wire contracts. BE2 owns health/friends; BE3 owns
routes/pictures. No merge or ReviewGPT in this lane.

## Product UX

Totals and Prizes read source entries, immediately separating typed quantities.
Untyped tasks show pending days until background classification succeeds. Past
awards survive corrections. New, mixed-unit, departed, returning and capped-history
members have distinct synthetic proof. Goals use checked facts; no-number tasks
can assign a per-day amount to their existing history. The pair board shares the
same obligation calendar as Progress. Health awards require current authority.

## Ownership and constraints

All private persistence stays in BE0's sealed four-table model. Measure changes
use patchMeasureState; effects recheck native-session authority in the transaction.
No projection, retries, flags, extra tables or speculative extension points.
Inference is the single soft failure and runs after the response. Deploy BE0's
additive migration before these routes; older clients remain compatible.

## Tasks and proof

1. Import checked banks and the supplied curated ladder; implement pure reducers.
2. Read bounded source history and typed payloads in batches; classify untyped tasks.
3. Build views and route handlers using existing authentication and error owners.
4. Prove contributions, historical terms, departure, caps, authority, permanent
   crossings and idempotence with synthetic tests; compare board fixture shapes.
5. Run focused tests, affected typecheck, diff selector and complexity check.
6. Review the candidate, update owner docs, commit, push and open the PR.

## Open evidence issue

BE0 explicitly describes its board JSON as presentation fixtures. Several contain
fractional habit days, pre-join streak days, projection dates inconsistent with
the locked formula and only a subset of earned rungs. Asked the owner whether to
preserve those examples and add scoring fixtures instead of changing the rules.
No answer arrived during implementation. Kept the locked scoring rules and the
BE0 presentation files unchanged. Source builders and an exact empty-source
response expectation cover the engine boundary; full BE0 golden equality is not
claimed. The integrator must reconcile the presentation fixtures before release.

## Delivered and integration boundaries

The four owned routes, typed contribution readers, historical terms/seat handling,
checked banks, background inference, permanent crossings, goals and shared streak
calendar are implemented. Withdrawing the final post keeps the saved ladder at
zero and its goal editable. No BE2/BE3 implementation files were changed.

`achievements.ts` separates pure scoring from BE0's server persistence so the
registry and live inference eval remain usable without importing server storage.
Public `ladderUse` metadata preserves distinct curated plank/sleep ladders for
rows 11/13. These add no table, endpoint, flag, registry or member preference.
The planned BE3 route-goal branch returns 501 with its named integration TODO.
Seen requests follow BE0's `momentIds` contract instead of the plan's timestamp
sketch, serving the show-once drawers in rows 10/13/16.

Product UX: Ready for backend integration; release holds are fixture reconciliation
and the separate client/health/friends/maps/pics lanes. Changelog: not applicable
to this backend foundation without the integrated client. No ReviewGPT or merge,
as directed. BE0 PR #5061 is still open; rebase onto main after it merges.

## Verification

- Focused Progress/board tests cover contribution tables, source builders,
  inference checks, route contracts, caps, authority, goals and never-revoke.
  All five suites passed 231 tests, exit 0. The final route rerun including a
  new future-terms obligation-label regression passed all 18 tests, exit 0.
- Isolated loopback PostgreSQL: migration deploy exit 0; 12 BE0 persistence
  invariants plus the existing Move API journey passed, exit 0. The final API
  rerun after the trusted stored-terms read passed, exit 0. No production data.
- `pnpm --dir apps/web typecheck:prepared`: exit 0. Focused `oxlint`,
  `pnpm complexity:diff`, `pnpm docs:drift`, privacy scan and diff whitespace
  checks: exit 0. Maximum authored function complexity is 17, no hotspots.
- Live eval with the Web tsconfig: exit 2, existing OPENAI_API_KEY unavailable.
  The script and 60 synthetic cases are supplied; provider accuracy is unproved.
- Remote `pnpm test:diff` could not reach the worker's SSH port. Stopped only
  this task's proven dispatcher tree; exit 1 before a static-ssh resources line
  or tests. The first local diff run passed 15,534 tests and failed the new
  future-terms label case: it loaded the older view while source was still being
  edited. A fresh targeted run passed. Rerun the selector on the frozen candidate;
  its final result and exact-head CI belong in the PR evidence and are not claimed
  passed at candidate preparation.
Completed: 2026-11-16
