# Progress friends and medals fixes

Status: completed
Created: 2026-11-16
Updated: 2026-11-16

## Outcome and scope

Restore Friends while photo tasks are pending, store the scheduled inference,
show full landmark dimensions and numbered bank names, choose reachable time
rounds, order total medals by exercise/date/amount, and remove Progress streaks.
Keep append-only non-streak awards, keyed/sealed private content, and all friend
health sharing boundaries. No iOS edits or steps/sleep Totals changes.

## Product UX

Product change. Replay a photo-only friend's first and subsequent read; blocked,
private, departed and capped audiences; short and long time totals; imperial and
metric landmarks; multiple exercises with same-day medals; no-medal and earned
medal title inputs; old awards after source corrections. Review synthetic wire
responses against the approved board. Native rendering belongs to the iOS lane.

## Owners and decisions

Use existing Progress readers, inference writer, formatters, goals, awards and
contract. Add no table, endpoint, flag or retry. Diagnose the deferred write
before changing it. Remove streak data with a migration that respects encrypted
award storage. Preserve total posted days.

The task explicitly supersedes the locked plan's streak feature and compact
place dimensions. Release requires build 112 to be uploaded before merge; no
legacy compatibility code. Integrator owns ReviewGPT and merge.

## Tasks

1. Prove and fix Friends inference and pending display, retaining commit authority.
2. Correct formatting, bank names, rounds and medal ordering.
3. Delete Progress streak computation, contract, fixtures and stored awards.
4. Verify title coin inputs; update owner docs, fixtures and changelog.
5. Focused tests, PostgreSQL proof, affected typecheck, diff selector, candidate
   review and complexity check. Commit, push, open draft PR, ready after proof.

## Findings and lane handoffs

The server blanked Friends because one unresolved photo task set the whole game
series incomplete. The reader now excludes only pending contributions and keeps
known pills/people; it still settles no pass award until inference completes.
A PostgreSQL route regression fails with the old flag and passes after removal,
including the scheduled owner-bound cache write. Existing lookup, sealing,
`after()` and commit-time audience checks also pass unchanged.

Read-only production request evidence showed main Progress reads but no Friends
endpoint invocation in the inspected window. That supports a missing native
request as the reason no friend classification was queued; it does not prove
which native code path prevents the request. Native request dispatch and the
per-exercise title-coin selection remain iOS lane handoffs. No writer workaround
or iOS edit was added here.

The task removes Progress streaks. Existing game-detail and pair-board run
contracts remain outside this lane; the board's current-run helper was moved
out of the deleted Progress streak module. No response compatibility branch was
added. No new persisted field, table, endpoint, registry or configuration flag.

## Verification

- Old-flag photo-only regression: expected exit 1 before restoring the fix.
- Focused Progress/board suite with PostgreSQL: 727 tests across 32 files, exit 0.
- Web typecheck and final prepared typecheck: exit 0.
- Standalone migration on the isolated empty local test DB: exit 0, zero rows.
- Complexity guard: exit 0 after moving pill selection to its own pure helper.
- Changelog generation and archive tests: exit 0 (4 tests).
- Final cancellation/totals and changelog checks: 47 tests, exit 0.
- Remote diff selector: stopped with exit 1 after the SSH port remained closed
  for more than four minutes. No worker resource profile or test result exists.
- Local `pnpm test:diff <all changed paths>`: exit 0 in 864.9 seconds. Includes
  policy guards, affected typecheck, 16,112 web tests passing (2,825 skipped),
  lint, development smoke and production build. Focused PostgreSQL proof above
  covers this lane's database tests excluded from the ordinary web suite.
- Exact-head CI runs when PR #5100 becomes ready. Candidate source review and
  merge-tree check pass; no private identifiers or unrelated authored changes.

No production data or credentials were persisted, no production mutation was
performed, and no ReviewGPT run or merge was started.
Completed: 2026-11-16
