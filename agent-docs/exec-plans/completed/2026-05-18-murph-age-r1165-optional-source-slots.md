# Murph Age R1165 Optional Source Slots

## Goal

Make the feature-only row-owner safe assertion template visibly prioritize average 16-50 submitter labs and wearable inputs by including optional source-family slots for common bloodwork core and vitals/body context, without making those optional slots required for the live chain.

Success criteria:

- R1165 writes optional `common_bloodwork_core` and `vitals_body_context` source-family rows in the safe assertion template.
- R1165 accepts assertions with the required glycemia bloodwork plus daily wearable activity pair and optional add-on rows, while still rejecting missing required minimum pair coverage.
- R1167 recognizes the extended template as ready and surfaces optional add-on slot guidance without storing private paths, headers, rows, values, or identifiers.
- R1172 remains compatible with the extended template and does not promote model evidence or product display.
- Refreshed artifacts remain aggregate-only and pathless.

## Scope

- `scripts/murph-age/r1165-ordinary-consumer-feature-only-safe-assertion-runner.ts`
- `scripts/murph-age/r1165-ordinary-consumer-feature-only-safe-assertion-runner.test.ts`
- `scripts/murph-age/r1167-ordinary-consumer-feature-only-safe-assertion-fill-guide.ts`
- `scripts/murph-age/r1167-ordinary-consumer-feature-only-safe-assertion-fill-guide.test.ts`
- `scripts/murph-age/r1172-ordinary-consumer-safe-assertion-materializer.ts`
- `scripts/murph-age/r1172-ordinary-consumer-safe-assertion-materializer.test.ts`
- Refreshed ignored R1165/R1167/R1172/R1173/R1174/R1175/R1176/R1145/R1076 artifacts as needed

## Constraints

- Do not widen the required minimum feature pair beyond `bloodwork_glycemia` plus `wearable_activity_daily`.
- Optional add-ons must remain optional; absence or `false` values for optional slots must not block the feature-only chain.
- Do not infer row-owner confirmation or create model evidence.
- Keep all outputs aggregate-only and free of private paths, headers, file names, row values, participant identifiers, source variable names, predictions, coefficients, model parameters, source text, and small cells.
- Preserve unrelated dirty worktree changes and active ledger rows.

## Verification Plan

1. Focused R1165/R1167/R1172 tests.
2. Refresh R1165, R1167, R1172, then dependent R1173/R1174/R1175/R1176/R1145/R1076 artifacts.
3. Run the full Murph Age suite.
4. Run `pnpm exec tsc -p tsconfig.tools.json --pretty false` and `pnpm typecheck`.
5. Run diff whitespace, touched-file identifier/credential, refreshed-artifact identifier, and aggregate-egress scans.

## Result

- R1165 now writes optional `common_bloodwork_core` and `vitals_body_context` source-family rows in the safe assertion template.
- R1165 validation still requires only `bloodwork_glycemia` and `wearable_activity_daily` to be available, so optional add-on rows can remain false without blocking the feature-only chain.
- R1167 now treats the extended R1165 template as ready and tells the row owner the optional common bloodwork/vitals slots can stay false unless already locally available.
- R1172 remains compatible with the extended template, writes no assertion without explicit row-owner confirmation, and still does not promote model evidence or product display.
- Refreshed downstream R1173/R1174/R1175/R1176/R1145/R1076 artifacts remain aggregate-only and keep the live chain blocked on explicit row-owner safe assertion.

## Verification Results

- Passed focused R1165/R1167/R1172 tests: 3 files, 15 tests.
- Refreshed R1165, R1167, R1172, R1173, R1174, R1175, R1176, R1145, and R1076 artifacts.
- Passed full Murph Age suite: 198 files, 895 tests.
- Passed `pnpm exec tsc -p tsconfig.tools.json --pretty false`.
- Passed `pnpm typecheck`.
- Passed targeted `git diff --check`, trailing-whitespace scan, touched-file identifier/credential scan, refreshed-artifact identifier scan, refreshed-artifact aggregate-egress scan, and explicit R1165 template source-family check.
Status: completed
Updated: 2026-05-18
Completed: 2026-05-18
