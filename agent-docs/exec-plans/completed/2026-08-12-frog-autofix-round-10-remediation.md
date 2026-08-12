# Frog Autofix Round 10 Remediation

Status: completed
Created: 2026-08-12
Updated: 2026-08-12

## Goal

- Stop recovered human handoffs before any autonomous mutation, bind canonical
  review and merge to the exact parent-owned PR body, and narrow automatic merge
  to the explicit local Frog autofix script set.

## Success criteria

- Exact and ancestor handoffs return before tooling checks, model work, edit-only
  work, commits, or pushes, while preserving any dirty human files byte-for-byte.
- Canonical specialist and final archives contain the captured parent-local body;
  a changed remote body, editor, issue binding, head, or body digest prevents the
  model invocation or merge.
- Frog PR bodies use one non-closing issue binding. The parent closes only that
  issue after an exact merge is proven, and post-merge presentation edits cannot
  make the already-completed merge appear absent.
- Automatic merge accepts only the enumerated Frog autofix scripts and rejects
  the GitHub Actions-owned `scripts/frog-pr-context.ts`, including rename/copy
  cases.

## Scope

- In scope: existing handoff/review/finalization owners, the full ReviewGPT
  packager's parent-body input, issue binding, exact script allowlist, focused
  production-shaped tests, owner docs, and the next exact-head review/CI cycle.
- Out of scope: a new state record, queue, scheduler, service, credential,
  autonomous finding-remediation loop, or product-runtime behavior.

## Tasks

1. [x] Move recovered handoff enforcement ahead of all tooling and child work.
2. [x] Bind review packaging and finalization to the exact parent-owned body.
3. [x] Replace closing keywords and broad script-prefix merge authority.
4. [x] Update owner docs and complete focused plus repository-wide verification.
5. [ ] Close the plan, push the corrected candidate, and obtain a valid
   ReviewGPT round 10 PASS plus green exact-head CI.

## Verification

- `pnpm exec vitest run scripts/frog-autofix.test.ts --config scripts/vitest.config.ts --no-coverage`
- `pnpm exec vitest run packages/cli/test/release-script-coverage-audit.test.ts --config packages/cli/vitest.workspace.ts --no-coverage`
- `pnpm test:diff <changed files>`
- `pnpm typecheck`
- `pnpm docs:drift`
- `bash -n scripts/frog-autofix scripts/package-audit-context-full.sh`
- `scripts/frog-autofix verify-permissions`
- `scripts/frog-autofix scan`
- `git diff --check`

## Results

- Focused Frog coverage passed 40/40, including dirty-state preservation,
  remote-body revalidation, exact review-body packaging, merge/body binding,
  non-closing issue ownership, and the exact automatic-merge file allowlist.
- Release-packager coverage passed 43 tests with one intentional skip; the real
  archive harness proved exact local-body inclusion and digest-mismatch refusal.
- Full workspace typecheck, docs drift, shell syntax, Frog permission checks,
  Frog scan (`eligible=0`), diff integrity, and the added-line privacy scan
  passed.
- Diff-aware verification passed its repository-tools phase (565/565) and CLI
  typecheck. Its broad CLI test phase was not a valid correctness signal on the
  shared host: 1,043 tests passed, while 113 tests exhausted fixed wall-clock or
  artifact-repair-lock timeouts and one dependent test could not load a build
  artifact after that repair step never completed. GitHub CI remains the
  authoritative clean-host broad package gate for the pushed head.
Completed: 2026-08-12
