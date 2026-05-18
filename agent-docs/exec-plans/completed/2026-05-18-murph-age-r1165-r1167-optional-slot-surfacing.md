# Murph Age R1165/R1167 Optional Slot Surfacing

## Goal

Surface the R1165/R1167 optional common bloodwork and vitals/body context slots in the R1145 completion audit and R1076 current autoresearch loop, so the top-level state shows the full average-user labs/wearables safe assertion shape.

Success criteria:

- R1145 validates and reports R1165 optional add-on family IDs.
- R1145 validates and reports R1167 optional add-on family IDs.
- R1076 summary, next-loop packet, and CLI output surface the R1165/R1167 optional add-on family IDs.
- Current-loop outputs still require explicit row-owner confirmation and do not promote model evidence or product display.
- Required tests, typechecks, whitespace/privacy scans, and refreshed-artifact egress scans pass.

## Scope

- `scripts/murph-age/r1145-ordinary-consumer-current-chain-completion-audit.ts`
- `scripts/murph-age/r1145-ordinary-consumer-current-chain-completion-audit.test.ts`
- `scripts/murph-age/r1076-current-autoresearch-loop-executor.ts`
- `scripts/murph-age/r1076-current-autoresearch-loop-executor.test.ts`
- Refreshed ignored R1145/R1076 artifacts

## Constraints

- Do not change the minimum feature pair: `bloodwork_glycemia` plus `wearable_activity_daily`.
- Optional add-ons remain optional safe metadata only.
- Do not infer row-owner confirmation or create model evidence.
- Do not store or expose private paths, headers, filenames, row values, identifiers, source variable names, predictions, coefficients, model parameters, source text, or small cells.
- Preserve unrelated dirty worktree changes and active ledger rows.

## Verification Plan

1. Focused R1145/R1076 tests.
2. Refresh R1145 and R1076 artifacts.
3. Run the full Murph Age suite.
4. Run `pnpm exec tsc -p tsconfig.tools.json --pretty false` and `pnpm typecheck`.
5. Run diff whitespace, touched-file identifier/credential, refreshed-artifact identifier, and aggregate-egress scans.

## Result

- R1145 now reads, validates, summarizes, and prints R1165/R1167 optional add-on family IDs for `common_bloodwork_core` and `vitals_body_context`.
- R1076 now surfaces the same optional add-on family IDs in summary, next-loop packet, and CLI output.
- The required feature-only safe assertion pair remains `bloodwork_glycemia` plus `wearable_activity_daily`; optional add-ons remain aggregate-safe metadata only.
- Current-loop artifacts still block completion/product display on explicit row-owner confirmation, private route config, and real route metrics.

## Verification Results

- `pnpm exec vitest run --config scripts/vitest.config.ts scripts/murph-age/r1145-ordinary-consumer-current-chain-completion-audit.test.ts scripts/murph-age/r1076-current-autoresearch-loop-executor.test.ts` passed.
- Refreshed R1145 and R1076 latest artifacts.
- `pnpm exec vitest run --config scripts/vitest.config.ts scripts/murph-age` passed: 198 files, 895 tests.
- `pnpm exec tsc -p tsconfig.tools.json --pretty false` passed.
- `pnpm typecheck` passed.
- Diff check, trailing-whitespace scan, touched-file identifier/credential scan, refreshed-artifact direct-identifier scan, and aggregate-egress scan passed.
Status: completed
Updated: 2026-05-18
Completed: 2026-05-18
