# Fix CLI help smoke timeout

Status: completed
Created: 2026-05-23
Updated: 2026-05-23

## Goal

- Make the canonical repo acceptance gate pass by fixing the CLI package
  coverage timeout in the root help smoke test.

## Success criteria

- Root cause for the `packages/cli/test/incur-smoke.test.ts` timeout is
  understood and fixed without widening CLI behavior.
- Focused CLI verification passes.
- `pnpm verify:acceptance` passes.

## Scope

- In scope: CLI smoke test/helper changes needed to make root help verification
  deterministic.
- Out of scope: CLI command topology changes, user-facing command behavior,
  unrelated active work.

## Constraints

- Technical constraints: preserve incur-backed CLI routing; do not replace the
  smoke check with brittle static-only assertions unless it still proves the
  live root command surface.
- Product/process constraints: preserve unrelated dirty work and active ledger
  rows; avoid local-path or identifier leakage in docs/output.

## Risks and mitigations

1. Risk: masking a real CLI help hang.
   Mitigation: reproduce with focused CLI commands and keep verification
   coverage against the live CLI path.

## Tasks

1. Reproduce and isolate the root help timeout.
2. Apply the narrowest deterministic fix.
3. Run focused CLI checks and full acceptance.
4. Close the plan through the repo finish workflow.

## Decisions

- Keep the root help assertion live, but render root help once for the Incur
  built-ins and health CRUD command groups instead of twice.
- Give the root-help smoke an explicit 90 second timeout because it is heavier
  than leaf help checks under full coverage fanout.

## Verification

- Commands to run: focused CLI test/coverage commands, then
  `pnpm verify:acceptance`.
- Expected outcomes: all commands pass.
- Passed so far: `pnpm --dir packages/cli test:coverage`.
- Passed: `pnpm verify:acceptance`.
- Passed: `git diff --check`.
Completed: 2026-05-23
