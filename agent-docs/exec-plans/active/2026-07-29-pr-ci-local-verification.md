# Rely on pull request CI for full verification

Status: active
Created: 2026-07-29
Updated: 2026-07-29

## Goal

- Make pull-request delivery fast locally by requiring only focused proof before
  a PR while making exact-head GitHub Actions the full-suite gate.
- Preserve the full local acceptance requirement before any direct push to
  `main` or another shared default branch.

## Success criteria

- Agent guidance no longer requires `pnpm test:diff`, `pnpm test`, or
  `pnpm verify:acceptance` locally merely to open or update a PR.
- PR-bound work still runs the smallest focused local checks that prove the
  touched behavior and cannot be called complete until required CI is green on
  the exact head.
- CI failures route first to the narrowest local reproducer, with umbrella
  commands available when broader diagnosis is necessary.
- Direct default-branch pushes require `pnpm verify:acceptance` against the
  reconciled candidate.
- Completion, verification, ReviewGPT, testing-map, and index guidance agree.

## Scope

- In scope: agent workflow documentation, the preliminary specialist prompt,
  and the focused policy-oracle test.
- Out of scope: changing tests, GitHub Actions workflows, required-check
  settings, release workflows, or deployment gates.

## Constraints

- Technical constraints: keep existing CI coverage and exact-head PR review
  gates intact.
- Product/process constraints: keep the rule concise, preserve focused local
  proof, and avoid adding a second verification owner or new tooling.

## Risks and mitigations

1. Risk: agents interpret lighter local verification as permission to ship
   untested work.
   Mitigation: require focused local proof before the PR and green required CI
   on the exact PR head before completion.
2. Risk: direct pushes bypass the CI feedback loop.
   Mitigation: require the canonical full acceptance suite before a direct
   default-branch push.
3. Risk: ReviewGPT still rejects a PR because no local coverage umbrella
   command ran.
   Mitigation: make coverage applicability depend on changed executable
   behavior and accept focused local proof plus current exact-head CI status.

## Tasks

1. Update the routing and verification ownership rules.
2. Align completion and ReviewGPT specialist instructions.
3. Update the testing map, top-level agent rule, and docs index.
4. Run focused policy checks, inspect the final diff, and finish through the PR
   lane.

## Decisions

- GitHub Actions owns broad/full verification for PR-bound work.
- Local PR verification remains focused and behavior-specific.
- `pnpm verify:acceptance` remains mandatory for direct default-branch pushes.
- CI failure diagnosis starts narrow and expands only when evidence requires it.

## Verification

- `pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage packages/cli/test/release-script-coverage-audit.test.ts`
  passed with 40 tests and one intentional skip.
- `pnpm docs:drift` passed.
- `git diff --check` passed.
- Secret-safe searches found no personal identifier in the changed files and no
  remaining live policy phrase that requires a local coverage-bearing umbrella
  command for PR-bound work.
- Exact-head GitHub Actions remain pending until the review candidate is pushed.
