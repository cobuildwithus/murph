# Worktree guard session isolation

Status: active
Created: 2026-08-10
Updated: 2026-08-10

## Goal

- Prevent one unauthorized registered worktree from blocking commits and
  sanctioned worktree creation in unrelated authorized sessions.
- Preserve fail-closed behavior for commits made from the unauthorized
  checkout and preserve all global numeric, disk, and audit visibility.

## Success criteria

- The commit hook identifies the exact committing worktree.
- An authorized checkout can commit while an unauthorized sibling exists.
- The unauthorized sibling cannot commit.
- `scripts/create-worktree` can create and mark a sanctioned checkout while an
  unauthorized sibling remains counted by the global resource guard.
- An already-authorized checkout on the preceding guard implementation can use
  its installer, committer wrapper, and creation helper during rollout.
- An authorized checkout on the current guard can use those entrypoints while
  the primary checkout still has the preceding guard and no raw sibling exists;
  the older primary remains globally fail-closed if a raw sibling exists.
- No guard publishes authorization for a raw checkout, so a later primary
  downgrade cannot reinterpret durable compatibility state as authority.
- Any current guard scan retires the exact authorization-plus-isolation state
  written by the rejected intermediate guard, authorization first under the
  shared guard lock; task-local scans never publish it and malformed nodes fail
  closed.
- A preceding-version creator remains globally fail-closed around a raw
  sibling until it advances; current-version creation remains checkout-scoped.
- The explicit no-argument guard continues to fail when any unauthorized
  registered worktree exists when run from the primary checkout.

## Scope

- In scope: worktree guard modes, hook/install/create callers, focused tests,
  and durable workflow documentation.
- Out of scope: terminating or adopting existing unowned processes, deleting
  checkouts, weakening worktree-count or disk-space limits, or changing PR
  review behavior.

## Tasks

1. Add explicit committing-checkout and sanctioned-creation guard modes.
2. Prove cross-session isolation and continued raw-checkout rejection.
3. Run focused verification, required ReviewGPT audit, and exact-head CI.
4. Archive the plan after the workflow PR is green and ready to land.

## Verification

- Shell syntax passed for the guard, creation helper, hook installer, and
  pre-commit hook.
- Focused worktree-guard coverage passed: 29 tests, including both
  mixed-version directions, hook/guard update ordering, downgrade safety, and
  scoped resource-budget coverage. The added regressions seed the exact
  intermediate marker pair, prove current task-first retirement against the
  exact preceding primary and hook, downgrade rejection, and malformed-node
  fail-closed behavior.
- The first simplified scoped `pnpm test:diff` run passed syntax, source guards,
  repo-tools typechecking, dependency policy, and 519 of 520 repo-tools tests.
  Its unrelated signal-forwarding timing test then passed directly in
  isolation. The complete serialized rerun passed all 520 tests and every
  preceding check. After merging current `origin/main`, the focused 27-test
  suite and the complete serialized 520-test diff suite passed again. After
  adding the retirement regressions, the focused suite passed all 29 tests.
  The first complete serialized diff run then passed 521 of 522 tests before
  the unrelated signal-forwarding timing test failed; that exact test passed
  all 5 tests in isolation, and the complete serialized rerun passed all 522
  tests and every preceding check. After the task-first retirement correction,
  the focused suite passed all 29 tests and the complete serialized diff suite
  passed all 522 tests plus every preceding check again.
- The current-main merge had one documentation conflict. Its resolution keeps
  the upstream changelog and shared-guard requirements together with this
  change's scoped rollout and downgrade guarantees; no code conflict occurred.
- With the live unrelated raw review checkout still registered, the repaired
  guard passed for this authorized checkout while its no-argument global audit
  and a raw-checkout-scoped audit both failed as designed. The obsolete marker
  pair created by the rejected design was removed to a recoverable temporary
  backup before this live verification.
- The preliminary ReviewGPT pass identified historical-entrypoint and scoped
  resource-budget coverage gaps. Final round 1 then identified inverse-version
  compatibility and marker-write ordering gaps. Round 2 required a
  retrospective because task-local marker publication repeated the same
  authority-exposure mechanism. Round 3 proved that primary-only publication
  was still rollback-unsafe: a preceding guard would reinterpret the durable
  legacy marker after downgrade. The recorded correction deletes compatibility
  publication and its isolation state instead of adding another migration
  protocol. Round 4 then found that an exact previously published head could
  have left both markers behind before that deletion. The recorded correction
  added bounded retirement under the existing primary guard and lock. Round 5
  then proved that primary-only retirement left the exact preceding primary
  trusting persisted authorization during a task-first rollout. The recorded
  correction allows any successfully completed current guard scan to delete
  that exact rejected authority state under the shared lock: remove
  authorization first and remove only a regular non-symlink isolation marker
  after authorization is absent. Task-local guards still never publish state.
  All accepted findings await exact-head reruns.
- Pending: exact-head ReviewGPT and GitHub Actions.
