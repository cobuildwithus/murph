# Keep pre-commit regression proof independent of SIGPIPE timing

Status: completed
Created: 2026-10-21
Updated: 2026-10-21

## Problem and invariant

The large staged CLI diff test first requires an obsolete git-diff/grep pipeline
to fail. Its exit status depends on pipe buffering and scheduling, so a correct
current hook can still fail release verification. Preserve actual current-hook
coverage of artifact regeneration, unrelated files and generator failures.

## Scope

Tests and developer-friction evidence only. Remove obsolete proof rather than
add sleeps, larger arbitrary buffers, platform branches or production changes.
No production logs, identities or private rows belong in the patch.

## Tasks

1. [x] Confirm the failing assertion and source mechanism.
2. [x] Obtain minimal implementation and synthetic proof through ReviewGPT.
3. [x] Run focused tests, relevant typecheck and parent review.
4. [x] Complete implementation and local proof; track external review, CI and merge in the PR and automation memory.

## Evidence target

Run the current hook with representative small, large and unrelated staged
diffs. Establish that an obsolete pipeline can succeed while the current hook
correctly regenerates outputs. Do not make that obsolete failure mandatory.

## Completed evidence

ReviewGPT reproduced both exit statuses from the obsolete pipeline on the same
512-entry synthetic staged diff: 8 zero exits and 24 SIGPIPE exits in 32 runs.
The unchanged current hook regenerated all three artifacts. The correction
removes the obsolete helper and asserts actual generated index contents, while
retaining rename, Unicode, unrelated-diff and generator-error coverage.

`pnpm test:diff scripts/developer-workflow-entrypoints.test.ts` passed all 908
repository-tool tests, the tooling TypeScript check and selected architecture,
privacy and dependency guards. `pnpm complexity:diff` passed with no authored
production source to analyze. Parent review confirmed a tests-only correction,
no added timing assumptions and no production contract changes.

Final pushed-head ReviewGPT, required CI, merge and release verification remain
external completion gates recorded in the PR and automation memory.
Completed: 2026-10-21
