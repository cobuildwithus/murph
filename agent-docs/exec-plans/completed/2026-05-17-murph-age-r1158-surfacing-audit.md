# Murph Age R1158 Surfacing Audit

## Goal

Surface the R1158 ordinary lab-plus-wearable safe-confirmation fill guide in the current autoresearch loop and completion audit, so the average roughly 16-50 submitter path has a first-class audited guide before row-owner confirmation.

## Scope

- `scripts/murph-age/r1076-current-autoresearch-loop-executor.ts`
- `scripts/murph-age/r1076-current-autoresearch-loop-executor.test.ts`
- `scripts/murph-age/r1145-ordinary-consumer-current-chain-completion-audit.ts`
- `scripts/murph-age/r1145-ordinary-consumer-current-chain-completion-audit.test.ts`
- Refreshed R1076/R1145 artifacts

## Constraints

- R1158 remains a fill guide only, not a confirmation and not model evidence.
- Keep row-level data, private values, paths, headers, filenames, product display, ReviewGPT, and model-evidence promotion closed.
- Preserve the live blocker on actual row-owner safe confirmation, private route config, and real lab/wearable route metrics.

## Plan

1. Add R1158 expected artifact/summary fields to R1076 and its CLI output.
2. Add R1158 as an audited R1145 requirement with strict non-evidence presence guards.
3. Update focused R1076/R1145 tests with R1158 fixtures and missing-artifact coverage.
4. Regenerate R1076/R1145 artifacts.
5. Run focused tests, full Murph Age suite, typecheck, and scoped privacy/identifier scans.

## Verification

- Focused R1076/R1145 tests.
- Full Murph Age script suite.
- `pnpm exec tsc -p tsconfig.tools.json --pretty false`.
- `pnpm typecheck`.
- Scoped artifact egress and direct identifier scans.

Status: completed
Updated: 2026-05-17
Completed: 2026-05-17
