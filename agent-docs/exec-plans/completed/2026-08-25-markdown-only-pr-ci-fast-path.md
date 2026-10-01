# Make Markdown-only changes cheap

Status: completed
Created: 2026-08-25
Updated: 2026-08-25

## Goal

- Keep protected-branch pull requests for documentation changes while avoiding
  package builds, coverage, browser checks, billing proof, and other runtime
  verification when the exact diff contains only eligible repository Markdown.

## Success criteria

- A true documentation-only PR still receives all seven required exact-head
  contexts from their existing owners.
- Required owners execute a small positive receipt instead of reporting a
  skipped required job.
- Eligible documentation still passes exact-candidate whitespace, durable-doc
  drift/reference, and gardening proof before the release receipt succeeds.
- Mixed, incomplete, stale, runtime-consumed Markdown, and unknown diffs fail
  closed into the normal CI path.
- Main pushes remain unchanged and continue to run their full verification.
- An eligible Markdown-only `main` commit cancels the redundant production Web
  build through the checked-in Vercel ignored-build boundary; missing or
  ambiguous Git/deployment history retains the build.
- Focused classifier and workflow-contract tests cover additions, deletions,
  renames, pagination/count mismatch, mixed changes, and exact-head handling.

## Scope

- In scope: required and optional public pull-request workflow admission,
  one shared read-only changed-file classifier, deterministic production Web
  ignored-build reuse, focused tests, and durable CI documentation.
- Out of scope: weakening branch rules, adding direct-main bypass, changing
  runtime behavior, treating runtime-consumed prompts/changelog/skills as
  documentation, or mutating private-repository workflows.

## Constraints

- Preserve each required context's current owner; do not synthesize duplicate
  check names or move pull-request code into `pull_request_target`.
- A skipped job is not required-check proof. Required jobs must run and record
  why the full runtime lane is not applicable.
- The classifier may trust only the exact pull-request file inventory and must
  reject partial inventories or paths outside the narrow documentation set.

## Tasks

1. Define and test the exact Markdown-only path classifier.
2. Gate expensive pull-request jobs while retaining lightweight required-owner
   receipts and unchanged main-push behavior.
3. Reuse the same allowlist for a fail-closed production Web ignored-build
   decision over exact Vercel Git history.
4. Update verification and CI ownership docs.
5. Run focused workflow/script proof, inspect the final diff, push a draft PR,
   and run the applicable preliminary ReviewGPT coverage lens with exact-head CI.
6. Resolve findings, archive this plan, prove current-base mergeability, merge,
   and retire the task worktree.

## Verification

- Focused classifier and workflow-contract tests.
- `pnpm test:diff` for the final repo-tooling/workflow slice when it remains the
  smallest truthful lane.
- Exact-head PR CI and current-base `git merge-tree --write-tree` proof.
Completed: 2026-08-25
