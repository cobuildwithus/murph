# Fail closed when PR ReviewGPT context is missing

Status: completed
Created: 2026-08-10
Updated: 2026-08-10

## Goal

- Make the canonical Murph ReviewGPT command fail closed before upload when a
  PR-only preset is not bound to its exact pushed PR head and review phase.

## Success criteria

- `pnpm review:gpt completion-specialists ...` automatically packages the
  current branch PR as a preliminary review without requiring callers to copy
  two environment variables.
- `pnpm review:gpt pr-review ...` automatically packages the current branch PR
  as a final review.
- Explicit mismatched phases, dirty worktrees, and non-matching pushed heads
  fail before ReviewGPT can stage or send an attachment.
- Generic ReviewGPT presets continue to invoke the package without PR lookup.
- Focused tests, shell syntax validation, typecheck, and an exact-head dry run
  prove the guarded entrypoint.

## Scope

- In scope: the existing ReviewGPT PR-head preflight, the root package command,
  focused regression tests, and the live PR-review workflow documentation.
- Out of scope: changing ReviewGPT prompts or their required evidence,
  modifying the external package, and changing generic audit packaging.

## Constraints

- Technical constraints: keep the published `@cobuild/review-gpt` package as
  the runner; preserve the existing one-argument preflight command; avoid a
  second wrapper or duplicated packaging implementation.
- Product/process constraints: required PR evidence remains fail-closed and
  exact-head; the change must not weaken review validity to hide workflow
  errors.

## Risks and mitigations

1. Risk: the guard could accidentally require GitHub context for exploratory
   audits.
   Mitigation: activate it only for the canonical PR preset names and aliases,
   with a regression test for a generic preset.
2. Risk: auto-detection could review the wrong branch or stale head.
   Mitigation: resolve the current branch PR and retain the existing clean-tree
   and exact-SHA checks before invoking the package.
3. Risk: callers could supply a contradictory phase.
   Mitigation: reject a mismatched explicit phase instead of overriding it.

## Tasks

1. Completed: extended the existing preflight with a package-run mode that
   recognizes PR presets, resolves their PR context, and exports the required
   phase.
2. Completed: routed the root `review:gpt` command through that mode while
   preserving the package as the implementation.
3. Completed: added focused behavior tests and updated the PR ReviewGPT
   workflow examples.
4. Completed locally: ran scoped verification. Exact pushed-head proof follows
   after this plan-closing commit opens its PR.

## Decisions

- Preserve the prompt's mandatory evidence contract. The invalid reviews were
  caused by missing invocation context, not by an overly strict prompt.
- Reuse `scripts/review-gpt-pr-head-preflight.sh` rather than add another
  wrapper or patch the external dependency.

## Verification

- Commands to run: `bash -n scripts/review-gpt-pr-head-preflight.sh`, focused
  Vitest for the guard and release-script contract, `pnpm --filter
  @murphai/murph typecheck`, `git diff --check`, and an exact-head
  `completion-specialists --dry-run` after the PR exists.
- Expected outcomes: PR presets carry the correct derived PR URL and phase into
  the package, invalid local state fails before package execution, and generic
  presets pass through without GitHub lookup.
- Passed: `bash -n scripts/review-gpt-pr-head-preflight.sh`.
- Passed: focused guard Vitest, 6 tests.
- Passed: focused root command contract Vitest, 1 test with 42 skipped.
- Passed: `pnpm --filter @murphai/murph typecheck`.
- Passed: `pnpm review:gpt simplify --dry-run --no-zip` through the guarded
  package-backed entrypoint.
- Passed: `git diff --check`.
- The package-level `test:source -- <file>` wrapper ignored the file argument
  and expanded into the broad CLI suite; it surfaced unrelated experiment
  journal failures before the current session stopped that owned run. The
  direct focused Vitest command above exercised this change and passed.
Completed: 2026-08-10
