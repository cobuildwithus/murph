# Fix current packages/cli acceptance failures

Status: completed
Created: 2026-04-24
Updated: 2026-04-24

## Goal

- Fix the current `packages/cli` acceptance failures named in the user handoff with the smallest truthful changes.

## Success criteria

- The listed failing `packages/cli` tests pass on the package-local built-runtime verification path used by acceptance.
- Any updated expectations match the current intended CLI behavior rather than masking a regression.
- Changes stay inside `packages/cli/**` unless a directly coupled CLI seam makes a minimal production fix necessary.

## Scope

- `packages/cli/src/**` only when the current CLI behavior is intentionally different and the fix is directly coupled
- `packages/cli/test/**` for stale expectations and focused coverage proof
- `agent-docs/exec-plans/active/{2026-04-24-cli-acceptance-failures.md,COORDINATION_LEDGER.md}`

## Constraints

- Stay in the `packages/cli/**` lane only.
- Preserve unrelated dirty-tree work and overlapping active rows.
- Prefer stale-expectation updates over behavior changes when the CLI output contract intentionally changed.
- Do not widen into assistant-cli hard-cut cleanup beyond any overlapping test files that must change for these failures.

## Risks and mitigations

1. Risk: some failures may reflect intentional CLI output changes while others may indicate a real regression.
   Mitigation: reproduce each failure first, then inspect the exact command contract before editing.
2. Risk: package-local tests can overlap the active assistant-cli hard-cut row on `packages/cli/test/**`.
   Mitigation: keep edits limited to the named failing tests and preserve any unrelated changes that appear.

## Tasks

1. Reproduce the listed failing `packages/cli` tests on the built-runtime package lane.
2. Inspect the coupled CLI code or expectations for each failing area.
3. Apply the smallest truthful fix set.
4. Rerun focused package-local verification for the touched failures.

## Decisions

- Keep the production/runtime surface unchanged and fix the acceptance failure in the CLI helper retry path.
- Treat harness-only module-resolution misses as retryable artifact failures by falling back to `error.message` when stdout/stderr are empty.

## Verification

- Commands to run:
  - `pnpm --dir packages/cli verify:prepared-runtime`
  - focused `MURPH_PREPARED_CLI_RUNTIME_ARTIFACTS=1 vitest` runs for the named failing files
  - `pnpm --dir packages/cli typecheck`
  - `pnpm --dir packages/cli verify:coverage` or focused built-runtime coverage proof, depending on the final touched surface
- Expected outcomes:
  - The touched `packages/cli` failures pass without widening into unrelated package/app work.
- Outcomes:
  - `pnpm --dir packages/cli verify:coverage` passed.
  - `pnpm exec vitest run --config packages/cli/vitest.workspace.ts packages/cli/test/cli-test-helpers.test.ts --no-coverage` passed.
  - `pnpm verify:acceptance` passed with the CLI coverage lane green.

Completed: 2026-04-24
