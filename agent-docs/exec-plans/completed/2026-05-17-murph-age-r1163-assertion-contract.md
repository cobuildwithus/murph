# Murph Age R1163 Assertion Contract

## Goal

Make the current R1163 feature-only safe-confirmation runner self-contained for an ordinary 16-50 lab-plus-wearable submitter by adding a pathless row-owner assertion contract that says exactly what can be asserted without storing private values.

## Scope

- `scripts/murph-age/r1163-feature-only-safe-confirmation-to-research-runner.ts`
- `scripts/murph-age/r1163-feature-only-safe-confirmation-to-research-runner.test.ts`
- Refreshed R1163/R1076/R1145 artifacts as needed

## Constraints

- Do not change the R1163 execution gate: downstream feature-only planning still runs only after the explicit row-owner assertion lets R1161 materialize a confirmed safe availability confirmation.
- Do not store private paths, filenames, headers, refs, rows, values, predictions, coefficients, product claims, product display, or ReviewGPT/model evidence.
- Keep the minimum ordinary submitter pair focused on bloodwork glycemia plus daily wearable activity.

## Plan

1. Add contract/action fields to R1163 output and CLI summary.
2. Update focused tests for waiting, materialized, and CLI states.
3. Regenerate R1163 plus dependent R1076/R1145 artifacts.
4. Run focused tests, Murph Age suite, typecheck, and privacy/egress scans.

## Verification

- `pnpm exec vitest run --config scripts/vitest.config.ts scripts/murph-age/r1163-feature-only-safe-confirmation-to-research-runner.test.ts`
- Focused integration tests if R1076/R1145 summaries are affected
- `pnpm exec tsc -p tsconfig.tools.json --pretty false`
- Full Murph Age suite
- `pnpm typecheck`
- Scoped identifier, trailing-whitespace, and aggregate-egress scans

Status: completed
Updated: 2026-05-17
Completed: 2026-05-17
