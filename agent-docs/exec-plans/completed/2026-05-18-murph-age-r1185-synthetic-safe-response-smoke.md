# Murph Age R1185 Synthetic Safe Response Smoke

## Goal

Add a narrow R1185 aggregate-only, non-evidence smoke proof for the average 16-50 lab/bloodwork plus wearable path. The proof should exercise the R1180-R1184 safe-response chain in an isolated synthetic run so we know the chain advances after a real row-owner safe confirmation, without mutating live artifacts or implying real row-owner confirmation.

## Constraints

- Synthetic proof only; not model evidence, not product evidence, not row-owner confirmation, and not a real data receipt.
- Do not update live R1180-R1184 artifacts while running the synthetic proof.
- No private paths, header names, file names from private sources, row values, identifiers, private ref values, source variable names, predictions, coefficients, model parameters, source text, or small cells.
- No product display, model evidence promotion, ReviewGPT send, or inferred row-owner confirmation.
- Persist only aggregate stage conclusions, artifact names, readiness booleans, safe command strings, and synthetic/non-evidence labels.

## Current State

- R1184 confirms the live chain is blocked on explicit row-owner safe-response assertion.
- R1183 has a fillable safe confirmation response artifact.
- A real row-owner assertion is still required before the live chain can advance.
- Focused R1185 smoke testing exposed an adjacent aggregate contract mismatch: R1184 checks for `requiredResponseFieldIds`, so R1180 now emits that field and R1181 validates it in the expected R1180 shape.
- R1185 now validates live R1184 blocker artifacts against the expected aggregate-only shape before synthetic proof promotion, and uses a synthetic-specific readiness flag in its persisted output.

## Planned Changes

- Add `scripts/murph-age/r1185-average-submitter-safe-response-smoke-proof.ts`.
- Add focused Vitest coverage for default blocked-live-state smoke proof, rejection of unsafe live R1184 state, isolated temp execution without path egress, and CLI output.
- Update the R1180/R1181 aggregate contract so actual R1180 outputs satisfy R1184's readiness predicate.
- Regenerate the R1185 latest artifact under the ignored model-runs directory.

## Verification

- Focused R1185 test: passed.
- Adjacent R1180-R1185 tests: passed.
- Full Murph Age script test suite: passed.
- `pnpm typecheck`: passed.
- Diff-aware verification scoped to R1185 files: passed.
- Privacy/egress scans over touched files and generated artifacts: passed.
Status: completed
Updated: 2026-05-18
Completed: 2026-05-18
