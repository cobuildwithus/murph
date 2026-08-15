# Correct design-proof forwarding and hermetic command coverage

Status: completed
Created: 2026-08-13
Updated: 2026-08-13

## Goal

- Correct the design-proof uploader's reviewed CLI boundary so pnpm-only
  forwarding normalization is separate from one canonical option parser.
- Make package-command help coverage hermetic and fail before repository
  configuration discovery or network access on a regression.

## Success criteria

- Pnpm, npm, and direct invocation shapes normalize and parse as documented.
- Help remains an option before the positional-only delimiter, including after
  a filename; unknown flags still fail.
- One documented inner `--` escape preserves dash-prefixed filenames and
  literal `--` or `--help` filenames.
- Package-level help proof cannot read ignored credentials or reach Cloudflare.
- Focused tests, docs checks, typecheck/diff verification, and privacy checks
  pass or report unrelated unchanged failures precisely.

## Scope

- In scope: uploader forwarding normalization, its canonical argument parser,
  CLI help text, uploader tests, and verification evidence.
- Out of scope: Cloudflare upload behavior, changelog-validator changes already
  accepted from the original task, publishing, and unrelated checkout repair.

## Constraints

- Technical constraints: remove at most one pnpm-owned forwarding boundary;
  preserve every remaining argument for the canonical parser; add no dependency
  or second option-parsing owner.
- Product/process constraints: retain the sanctioned exact-base worktree and
  existing changelog changes; use patch-based edits; preserve privacy; do not
  push or open a pull request.

## Risks and mitigations

1. Risk: unconditional leading-separator removal would make npm/direct literal
   filenames ambiguous.
   Mitigation: identify the pnpm package lifecycle explicitly and table-test all
   invocation routes.
2. Risk: a help regression could discover ignored credentials before failing.
   Mitigation: run the package command with credential variables removed and a
   poison Git executable first on `PATH`, forcing any configuration path to fail
   before file discovery or network work.

## Tasks

1. Separate package-manager forwarding normalization from canonical parsing.
2. Document and table-test help, unknown options, and positional escaping.
3. Run focused and diff-aware verification, inspect the final diff, privacy
   scan, and close the correction plan.

## Decisions

- Treat only `npm_lifecycle_event=design-proof:upload` with a pnpm user agent as
  the pnpm package route whose preserved outer separator is normalized away.
- Keep changelog classification not applicable: this remains internal operator
  tooling and contributor documentation.

## Verification

- `pnpm exec vitest run --config scripts/vitest.config.ts
  scripts/upload-design-proof-image.test.ts --no-coverage` passed 30 tests,
  including real pnpm, npm, and direct help commands behind poison Git.
- `node --test scripts/check-pr-changelog.test.mjs` passed 14 tests.
- `pnpm design-proof:upload -- --help` passed and printed the documented help.
- `pnpm docs:drift` passed.
- `node scripts/run-typescript.mjs package -p tsconfig.tools.json --pretty
  false` passed.
- Scoped `pnpm test:diff` passed syntax, hosted-runtime/provider guards, its
  repository TypeScript check, 35 repository-tools files, and all 599 runnable
  tests. The untouched wearable-fixture suite could not load `node:sqlite`
  because this shell runs Node 20 while the repository requires Node 24.14.1 or
  newer; no test in that suite ran.
- Final diff inspection, whitespace checks, and the scoped privacy scan passed;
  task-added content contains no credential, email address, local username,
  home-directory path, or other direct personal identifier.
Completed: 2026-08-13
