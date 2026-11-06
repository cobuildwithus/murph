# Skip redundant dependency hook installation

Status: completed
Created: 2026-09-11
Updated: 2026-09-11

## Goal

- Resolve Frog #3183: repeated dependency installation must not wait for the shared storage lock when hook configuration is already current.

## Success criteria

- Configured primary and authorized linked checkouts complete prepare without rewriting config or acquiring the lock.
- Bootstrap, repairs, raw checkouts, and normal commit entrypoints retain serialized admission.
- Focused regressions, tools typecheck, parent review, required final ReviewGPT, and exact-head CI pass before merge.

## Scope

- In scope: opt-in install-git-hooks no-op check, dependency prepare invocation, guard regression proof, storage lifecycle owner.
- Out of scope: changing guard budgets, commit authorization, lock timeouts, or worktree retirement.

## Constraints

- Derive readiness from existing config and markers; introduce no persisted state or dependency.
- Keep the default installer and actual commit guard unchanged.

## Risks and mitigations

1. A no-op check could bypass initialization or observe stale authorization.
   Mitigation: require current shared include, effective primary hook path, initialized baseline, and existing checkout authorization; actual commits still recheck under the guard lock.

## Tasks

1. Reproduce lock contention in the hermetic guard harness.
2. Add an opt-in read-only readiness check and retain serialized fallback.
3. Prove normal commit admission, repair, and bootstrap behavior; update the owner.
4. Complete review, PR checks, merge, and guarded retirement.

## Decisions

- Only dependency preparation opts in; committer and create-worktree keep the original installer behavior.

## Verification

- Before: both primary and linked busy-lock regressions failed with exit 75.
- After: all 90 tests in scripts/worktree-storage-guard.test.ts passed, including a real native-lock holder, serialized repairs, authorization revocation, and actual commit rejection.
- Tools TypeScript check, bash syntax, frozen dependency installation, docs drift, complexity diff, and diff whitespace checks passed. No authored JS/TS complexity applies; the shell predicate was reviewed directly.
- Parent candidate review confirmed config precedence, no new state, and unchanged commit/creation admission. Member changelog and runtime deployment concerns do not apply.
- Implementation complete; exact-head final ReviewGPT and required CI remain PR delivery gates, with results recorded on the PR before merge.
Completed: 2026-09-11
