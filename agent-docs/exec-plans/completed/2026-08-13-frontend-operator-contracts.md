# Fix frontend operator command and changelog documentation contracts

Status: completed
Created: 2026-08-13
Updated: 2026-08-13

## Goal

- Make the documented design-proof upload command display CLI help while
  retaining positional screenshot paths, including paths whose first character
  is `-`.
- Make the completion workflow's canonical changelog examples match the
  validator's literal Markdown-list contract and keep that alignment executable.

## Success criteria

- `pnpm design-proof:upload -- --help` exits successfully and prints uploader
  usage without reading credentials or files.
- The uploader argument contract still accepts ordinary paths and dash-prefixed
  positional paths after the separator.
- The completion workflow shows literal `- Changelog:`, `- Items:`, and
  `- Reason:` examples matching the pull-request validator.
- Focused tests fail if the documented changelog forms drift from the validator.
- Focused tests, TypeScript verification, docs checks, and the privacy scan pass.

## Scope

- In scope: the design-proof uploader package invocation/argument boundary,
  uploader CLI tests, the completion workflow changelog examples, and focused
  documentation-contract tests.
- Out of scope: Cloudflare upload behavior, changelog validation policy,
  pull-request publication, Frog automation, and product/runtime behavior.

## Constraints

- Technical constraints: consume pnpm's forwarded separator exactly once;
  preserve the CLI's explicit positional-only separator; add no dependency or
  second validation owner.
- Product/process constraints: base the isolated sanctioned worktree on
  `f3a2842f0314e646d4d3a9c054a3b062517d3ae3`; keep local identifiers and
  credentials out of tracked output; commit locally without pushing or opening
  a pull request.

## Risks and mitigations

1. Risk: treating every leading separator as positional-only would continue to
   hide `--help`, while dropping it unconditionally could reject dash-prefixed
   filenames.
   Mitigation: distinguish the package-manager forwarding boundary from the
   uploader parser and cover both behaviors directly.
2. Risk: prose examples can drift back to forms that Markdown renders as
   paragraphs rather than list items.
   Mitigation: extract the canonical documented examples in a focused test and
   run them through the production changelog validator.

## Tasks

1. Reproduce and encode the package-level CLI argument contract.
2. Correct the canonical changelog examples and add documentation-contract
   coverage against the production validator.
3. Run focused tests, typecheck/docs checks, privacy scan, inspect the final
   diff, close the plan, and commit the exact task paths.

## Decisions

- Reuse the existing uploader parser and changelog validator as the only
  behavior owners; add only boundary normalization and contract assertions.
- Changelog classification is not applicable because this changes internal
  operator tooling and contributor documentation, not member-visible behavior.

## Verification

- `pnpm design-proof:upload -- --help` passed and printed usage without reading
  Cloudflare credentials.
- `pnpm exec vitest run --config scripts/vitest.config.ts
  scripts/upload-design-proof-image.test.ts --no-coverage` passed 18 tests.
- `node --test scripts/check-pr-changelog.test.mjs` passed 14 tests.
- `pnpm docs:drift` passed after the documentation-index update.
- `pnpm test:diff` passed the shell/Node syntax guards, hosted-runtime guards,
  provider-request guard, and repository TypeScript tooling. Its repo-tools
  suite twice encountered unrelated process-lifecycle timing failures in
  unchanged tests: one Frog-autofix test on the first run, then two Crabbox
  verification tests on the clean rerun. The Frog-autofix test passed when run
  in isolation; the touched uploader and changelog tests passed independently.
- Final diff inspection and whitespace validation passed. The scoped privacy
  scan found no credential, email address, local username, home-directory path,
  or other direct personal identifier in task-added content.
Completed: 2026-08-13
