# Collapse Junction bounded-feature validation complexity

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Goal

Reduce repeated numeric validation in the existing Junction bounded-feature owner while preserving every admitted feature and rejection envelope.

## Success criteria

- Collapse repeated optional ranges and average/maximum comparisons; lower the cyclomatic guard debt without moving the same branches into another giant function.
- Preserve finite numeric strings, absent optional values, explicit undefined/null rejection, every bound, ECG required fields, and feature/split/identity error precedence.
- Pass focused regression proof on base and candidate, focused coverage, importer typecheck, and the complexity guard.

## Scope

- Existing bounded-feature validator, its focused tests, and this plan.
- No public API, schema, canonical output, provider fetch, persistence, or dependency changes.

## Constraints

Keep the importer as the bounded health-data admission owner. Retain compact evidence and raw-array exclusions. Use synthetic proof and neutral Git metadata. The parent owns candidate review, Ready status, exact-head CI, and final ReviewGPT.

## Risks and mitigations

1. Optional and required numeric rules differ: retain the explicit ECG/duration required gate and test missing, null, invalid, and finite string values.
2. Range checks overlap pair constraints: test every boundary independently and test each pair with absent, equal, ordered, and reversed values.
3. Validation errors have ordering: assert generic feature rejection precedes split validation, which precedes identity conflicts.

## Tasks

1. Add focused public-boundary regression matrices and prove they pass before implementation.
2. Replace repeated numeric rules with closed local range/pair data and small predicates; retain resource-specific guards.
3. Run focused coverage, importer typecheck, complexity guard, and full candidate diff/privacy review.
4. Close the plan with a scoped commit, push, and open a complete draft PR for parent review.

## Decisions

- The cause is repeated optional metric ranges and ordered numeric pairs inside assertFeature (base complexity 118).
- No new state or external effect is needed. Failure remains the existing TypeError envelope; retry and deployment compatibility remain unchanged because accepted inputs and outputs are preserved.
- The existing owner contract does not change, so no architecture or product document update is needed.

## Verification

- Base proof: `MURPH_VITEST_MAX_WORKERS=1 pnpm --dir packages/importers test test/device-providers-junction-bounded-features.test.ts` passed all 37 tests before the validator changed.
- Candidate proof: `MURPH_VITEST_MAX_WORKERS=1 pnpm --dir packages/importers test:coverage test/device-providers-junction-bounded-features.test.ts --coverage.include=src/device-providers/junction-bounded-features.ts` passed all 37 tests. Focused file coverage: 89.27% statements, 81.23% branches, 100% functions, 91.09% lines.
- `pnpm --dir packages/importers typecheck` passed.
- `pnpm complexity:diff --base HEAD -- packages/importers/src/device-providers/junction-bounded-features.ts` passed against the unchanged base: assertFeature 118 to 43, file maximum 118 to 48, and debt above 20 from 134 to 59.
- Remaining hotspots: the unchanged workout reducer (48), the generic/resource-specific feature gate (43), and unchanged split validator (28). The new helpers remove repeated rules; further separation of the structural gate would mainly relocate distinct necessary checks.
- Full candidate diff, whitespace, and added-content privacy review passed. No new actionable Frog friction was encountered.
- Candidate implementation is complete. Push and draft PR handoff follow this scoped commit; parent candidate review, exact-head CI, and final ReviewGPT remain explicit gates.
Completed: 2026-09-10
