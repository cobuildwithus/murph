# Explain sparse interval normalization failures

Status: completed
Created: 2026-11-10
Updated: 2026-11-10

## Goal

- Identify the first rejected sparse calendar predicate through bounded runtime-log enums, without changing validation, replacement authority, or retry cadence.

## Success criteria

- Synthetic predicate and magnitude cases fail on base and pass after the diagnostic change; service and hosted log projections preserve only safe categories.
- Focused owner tests, typechecks, complexity guard, and local PR evidence checks pass before the exact pushed head becomes Ready.

## Scope

- In scope: importer diagnostics, existing service allowlist, owner tests and diagnostic documentation.
- Out of scope: provider payload collection, validation/retry changes, production mutations, merge and ReviewGPT.

## Constraints

- Technical constraints: preserve the failure code and existing evaluation order; reuse value-kind/range/unit fields and canonical validators.
- Product/process constraints: synthetic fixtures only; publish through origin with the requested attribution and draft-first lifecycle.

## Risks and mitigations

1. Misclassifying failures or leaking values. Cover every predicate, boundary buckets and unknown units; emit no new raw data.
2. Deploy skew. Existing Web parser accepts these scalar fields; runner producers and consumers ship together. Old runners continue reporting the legacy reason.

## Tasks

1. Trace normalization and logging; confirm the official caffeine contract.
2. Add failing synthetic proof; replace the combined predicate with ordered reasons and extend existing category allowlists.
3. Run focused checks, review the diff, close the plan, commit, push and open a Ready PR.

## Decisions

- Junction documents caffeine in grams with no schema maximum. Murph converts grams to milligrams and applies its own inclusive 0..2 g bound. A 0.2 g sample must remain accepted; no demonstrated unit bug justifies behavior changes.
- No new state, queue, flag, logging owner or deployment dependency. Preserve old reason type for compatibility with existing callers and historical logs.
- The [Junction caffeine GET contract](https://docs.junction.com/api-reference/data/timeseries/caffeine) specifies grams and no maximum. The current [official iOS SDK unit mapping](https://github.com/tryVital/vital-ios/blob/a3f8af1c2032e2fa5fde36a6ef8b76df2f5efabe/Sources/VitalHealthKit/HealthKit/Models/CoreModels%2BExtensions.swift#L369) ultimately uses milligrams for HealthKit caffeine uploads. That upload mapping does not prove the server's GET conversion or a deployed member's response shape. No behavioral fix is justified without the new diagnostic evidence.
- Range buckets reuse the three existing inclusive resource validators on scaled rejected values, rather than adding a second set of limits. The first failed predicate retains the existing order, and the existing error code, retryability and 30-minute cadence are unchanged.

## Verification

- Base proof: two selected importer tests failed on the generic reason; nine selected hosted log cases failed because the new range/unit categories were omitted. All pass with the change.
- `pnpm --dir packages/importers exec vitest run --config vitest.config.ts --no-coverage --maxWorkers=2 test/device-providers-junction.test.ts`: 273 passed.
- `pnpm --dir packages/device-syncd exec vitest run --config vitest.config.ts --no-coverage --maxWorkers=2 test/service.test.ts test/junction-provider-diagnostics.test.ts`: 253 passed.
- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --no-coverage --maxWorkers=2 test/hosted-runtime-maintenance.test.ts test/hosted-device-sync-runtime.test.ts`: 333 passed, including old producer diagnostics and retained retry behavior.
- `pnpm --filter @murphai/importers --filter @murphai/device-syncd --filter @murphai/assistant-runtime typecheck`: passed.
- `pnpm complexity:diff`: passed; changed source files have zero added complexity debt. Reviewed the existing hotspots and kept value classification in one local helper.
- All focused suites and typechecks reran successfully after rebasing onto `55d83979af67` from origin/main. The hosted tests pass logs through the unchanged Web protocol parser, proving mixed-version category acceptance.
- Candidate review: diagnostics-only diff; synthetic fixtures; no raw value, unit, timestamp or identity added to logs. PR evidence and exact-head CI remain publication checks; the parent owns merge, deployment and post-deploy aggregate observation.
Completed: 2026-11-10
