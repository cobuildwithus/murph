# Frog Autofix Round 11 Authority Follow-up

## Goal

Close the two production-reachable findings from the valid exact-head round-11
audit while preserving the existing task-provenance and PR-body handoff owners.

## Accepted findings

- The second task comparison ran before a final scope callback that fetched
  `origin/main`, allowing the fetch itself to stale the task fence before merge.
- A terminal pre-PR disposition was written only after fallible remote calls,
  and any observed deterministic remote ref was treated as replaceable even
  though lease equality proves concurrency, not parent ownership.
- The same audit noted that post-wait task comparisons consumed the existing
  local remote-tracking ref without first refreshing it.

## Design

- Consume one caller-fetched `origin/main` snapshot for issue, merge-base,
  scope, and final task comparison; place the last task comparison after the
  final scope check.
- Refresh `origin/main` before every post-wait task comparison.
- Write an exact local terminal marker in the existing private PR-body path
  before remote operations. Recover that marker before branch synchronization
  or any implementation/child turn.
- Replace a remote ref only when it equals the exact locally retained neutral
  handoff head from a proven push-before-PR interruption. Preserve and fail
  closed on every newly appeared or otherwise unproven branch, using an
  explicit nonexistence lease to protect the initial branch-creation race.

## Verification

- Focused sequencing proof for final-scope task drift and fresh post-wait reads.
- Real Git proof for neutral empty-commit recognition and local marker
  durability.
- Remote-ref authorization cases for absent, exact retained, refreshed retained,
  and foreign heads, plus recovery-before-implementation ordering.
- Focused Frog suite, workspace typecheck, repo tooling, docs/shell/permission
  guards, privacy/diff checks, and a current-base merge tree before the next
  exact-head review and CI pass.

## Progress

- [x] Validate and accept the exact round-11 findings.
- [x] Move the final task fence after the last scope evaluation.
- [x] Refresh task authority after long waits.
- [x] Persist local terminal disposition before remote operations.
- [x] Restrict remote replacement to proven retained handoff provenance.
- [x] Complete focused proof and owner documentation.
- [x] Verify the correction and hand it off to the next exact-head review.
Status: completed
Updated: 2026-08-12
Completed: 2026-08-12
