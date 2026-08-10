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
- Focused worktree-guard coverage passed: 26 tests, including historical
  entrypoint compatibility and scoped resource-budget coverage.
- Scoped `pnpm test:diff` passed with serialized Vitest workers, including all
  519 repo-tools tests, repo-tools typechecking, dependency policy, and source
  guards. Two preceding parallel attempts hit unrelated timing-only tests;
  both affected files passed directly before the serialized full rerun.
- With the live unrelated raw review checkout still registered, the repaired
  guard passed for this authorized checkout while its no-argument global audit
  continued to fail as designed.
- The preliminary ReviewGPT pass identified historical-entrypoint and scoped
  resource-budget coverage gaps. Both were remediated and await exact-head
  reruns.
- Pending: exact-head ReviewGPT and GitHub Actions.
