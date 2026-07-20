# Restore Vercel Install Portability

## Outcome

Restore the production Vercel deployment without weakening the machine-local
worktree storage guard.

## Proven failure boundary

- Vercel cloned `main` at `0ec9f61` and failed during `pnpm install`, before the
  web build began.
- The root `prepare` script invoked `scripts/install-git-hooks`, which invoked
  `scripts/worktree-storage-guard`.
- Bash reported that the process-substitution path `/dev/fd/63` did not exist at
  the first `done < <(...)` read.
- The same script has a second process substitution in its disk-capacity read,
  so both occurrences must be removed to restore the full install path.

## Scope

- Replace both process-substitution reads with portable captured-output reads.
- Preserve array mutations, record counting, disk-floor checks, and fail-closed
  behavior in the parent shell.
- Add a focused regression assertion that the install-time guard contains no
  process substitution.

## Verification

- `bash -n scripts/worktree-storage-guard scripts/install-git-hooks` passed.
- The guard and exact root `prepare` command completed with the storage limits
  still enforced.
- `pnpm test:repo-tools` passed: 25 files and 378 tests.
- `pnpm test:diff` passed for the script, test, plan, and ledger paths, including
  shell syntax, repo-tool typecheck/tests, log/privacy guards, hosted Temporal and
  crypto guards, and dependency policy.
- `git diff --check` passed, and the scoped diff contains no direct personal
  identifiers.
- The required coverage audit made no edits and found the existing behavioral
  harness plus the new syntax regression sufficient.
- The required deep review reported no findings across producer failure,
  empty-output, trailing-newline, record-boundary, and parent-shell mutation
  behavior.
- Final acceptance is the replacement Vercel production install and deployment.
Status: completed
Updated: 2026-07-20
Completed: 2026-07-20
