# Documentation drift pipefail fix

Status: completed
Created: 2026-07-14
Updated: 2026-07-14

## Goal

- Keep the TypeScript 7 PR's documentation gate truthful by fixing the pinned repo-tools checker bug that treats an early successful `grep -q` match as failure when `pipefail` observes the producer's `SIGPIPE`.

## Success criteria

- The exact base-to-head change set recognizes the changed `agent-docs/index.md` entry.
- `pnpm docs:drift`, frozen install, dependency policy, and focused patch verification pass from a clean committed head.
- The correction stays confined to an exact-version pnpm patch of `@cobuild/repo-tools@0.1.15` and its lock/workspace metadata.

## Scope

- In scope: one upstream shell-function patch, pnpm patched-dependency metadata, lockfile refresh, and focused regression proof.
- Out of scope: replacing the drift checker, changing its policy, suppressing documentation requirements, or publishing an upstream package release.

## Evidence

- The committed TypeScript 7 patch updates `agent-docs/index.md`, but the checker exits with the missing-index error.
- Direct reproduction under `set -o pipefail` returns status 141 for `echo "$changed_files" | grep -Eq '^agent-docs/index\.md$'` because the changed index path is matched before the producer finishes.
- The same documentation subset passes when short enough to avoid the producer-side `SIGPIPE`, proving the policy inputs are valid and the pipeline status is the defect.

## Tasks

1. Patch `has_change` to feed the changed-file string through a here-string instead of a producer/`grep -q` pipeline.
2. Refresh the pnpm patch metadata and verify the installed checker contains only that correction.
3. Run the clean base-to-head documentation gate and dependency checks, then close the plan with a scoped commit.

## Verification outcomes

- Exact 37-file reproduction: original pipeline status 141; patched here-string status 0.
- CI-mode gate: `GITHUB_BASE_REF=main pnpm docs:drift` passed.
- `pnpm install --frozen-lockfile`, `pnpm deps:guard`, `pnpm deps:ignored-builds`, patch syntax, `git diff --check`, and the identifier scan passed.
- Coverage review found the end-to-end CI-mode proof sufficient and made no edits.
- Security review found no evidence-backed medium-or-higher security or privacy issue and no residual human check.
Completed: 2026-07-14
