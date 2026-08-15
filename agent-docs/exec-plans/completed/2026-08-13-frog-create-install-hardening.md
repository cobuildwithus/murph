# Harden sanctioned worktree creation and hook installation

Status: completed
Created: 2026-08-13
Updated: 2026-08-13

## Goal

- Make sanctioned worktree creation report success only after the new checkout
  is observably clean, and keep hook installation from racing shared Git and
  storage-guard mutations during ordinary concurrent repository work.

## Success criteria

- `scripts/create-worktree` performs a bounded clean-status proof after a
  successful checkout and retains, but fails closed on, a persistent anomaly.
- `scripts/install-git-hooks` performs every hook/config mutation while holding
  the existing storage-guard lock, and does not reacquire it when the caller
  already owns it.
- Focused tests deterministically prove transient and persistent checkout
  states, native lock contention, mutation ordering, and inherited ownership.
- Shell syntax, focused repo-tool tests/typechecking, diff checks, and privacy
  guards pass on the final file state.

## Scope

- In scope: `scripts/create-worktree`, `scripts/install-git-hooks`, their focused
  storage-guard tests, and this execution plan.
- Out of scope: storage-guard policy changes, worktree retirement, committer
  behavior, dependency changes, process termination, and automatic cleanup of
  an anomalous new checkout.

## Constraints

- Technical constraints: retain the existing OS-released lock inode and bounded
  acquisition contract; preserve compatibility with callers that export
  `MURPH_WORKTREE_GUARD_LOCK_HELD=1`; avoid unbounded polling or sleeps.
- Product/process constraints: start from the activation candidate's exact
  head, preserve an anomalous worktree for inspection, do not touch sibling or
  primary worktrees, and keep diagnostics free of checkout contents.

## Risks and mitigations

1. Risk: a clean-status retry could hide a real local modification.
   Mitigation: refresh only index metadata; never reset or mutate checkout
   files, and fail closed if any status remains after the bounded attempts.
2. Risk: nested lock acquisition could deadlock sanctioned creation.
   Mitigation: reuse the existing held-lock environment contract and test both
   contended direct installation and inherited ownership.
3. Risk: concurrency tests could leak child processes.
   Mitigation: keep exact child handles, release the owned holder through a
   marker, bound its own lifetime, and await natural exits without signals.

## Tasks

1. Completed: added the post-creation clean-status proof and fail-closed
   retention path.
2. Completed: moved hook/config mutations behind the shared storage-guard lock.
3. Completed: added deterministic focused regression coverage for both issue
   paths.
4. Completed: ran focused verification and audited the final diff; use the
   normal scoped finish path for the local commit.

## Decisions

- Reuse the one storage-guard lock and its held-lock environment marker instead
  of adding a second lock or a deferred hook state.
- Treat a status-command error the same as a non-clean status; neither can
  establish the success postcondition.

## Verification

- `bash -n scripts/create-worktree scripts/install-git-hooks` passed.
- Focused `scripts/worktree-storage-guard.test.ts` passed all 35 tests on the
  final code/test state.
- `node scripts/run-typescript.mjs package -p tsconfig.tools.json --pretty
  false` passed.
- `pnpm docs:drift` and `pnpm docs:gardening` passed after the owner-doc/index
  update.
- `git diff --check` and the task-diff privacy scan passed; the diff contains no
  local username, home path, or configured email.
- Parent review and the PR-lane ReviewGPT/required-CI gates remain downstream
  delivery work and are intentionally not run from this local-only batch.
Completed: 2026-08-13
