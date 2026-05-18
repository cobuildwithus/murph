# Murph Age R1175 Value Kind Surfacing

## Goal

Keep the ordinary 16-50 lab plus wearable submission lane centered on safe, average-consumer inputs by making R1175 surface and enforce the same value-kind and blocked-content contract already used by R1172/R1173/R1174.

Success criteria:

- R1175 bridge smoke publishes allowed value kinds and blocked private-content categories in both bridge and summary outputs.
- R1145 and R1076 require and surface the R1175 contract before treating the bridge smoke as current.
- Refreshed aggregate-only artifacts remain pathless/private-data-free and keep the current next action on row-owner feature-only safe assertion confirmation.
- Focused tests, Murph Age suite, repo typechecks, whitespace/privacy scans, and artifact egress scans pass or any unrelated blocker is documented.

## Scope

- `scripts/murph-age/r1175-r1172-to-r1165-safe-assertion-bridge-smoke.ts`
- `scripts/murph-age/r1175-r1172-to-r1165-safe-assertion-bridge-smoke.test.ts`
- `scripts/murph-age/r1145-ordinary-consumer-current-chain-completion-audit.ts`
- `scripts/murph-age/r1145-ordinary-consumer-current-chain-completion-audit.test.ts`
- `scripts/murph-age/r1076-current-autoresearch-loop-executor.ts`
- `scripts/murph-age/r1076-current-autoresearch-loop-executor.test.ts`
- Refreshed ignored Murph Age R1175/R1145/R1076 artifacts

## Constraints

- No row parsing, source text, private paths, header names, file names, row values, identifiers, source variable names, predictions, coefficients, model parameters, or small cells in git-tracked outputs or refreshed aggregate artifacts.
- R1175 smoke remains synthetic/non-evidence only; it may prove the bridge but must not promote model evidence or product display.
- Keep the priority on bloodwork/labs plus wearable activity inputs an average 16-50-year-old submitter can provide.
- Preserve unrelated dirty worktree changes and active ledger rows.

## Verification Plan

1. Focused R1175/R1145/R1076 tests.
2. Refresh R1175, R1145, and R1076 artifacts.
3. Full Murph Age suite.
4. `tsconfig.tools.json` typecheck and repo `pnpm typecheck`.
5. Diff whitespace, identifier/credential, and refreshed artifact aggregate-egress scans.

## Result

- R1175 now emits `allowedValueKindIds` and `blockedContentIds` in `bridgeSmoke`, `summary`, and CLI output for the ordinary 16-50 bloodwork/labs plus wearable activity lane.
- R1175 bridge pass criteria now require R1172 materializer and summary outputs to carry the expected booleans/fixed-ID answer contract and blocked private-content categories.
- R1145 and R1076 now surface and validate the R1175 contract before treating the bridge smoke as current.
- Refreshed R1175/R1145/R1076 artifacts keep the loop on `rerun_r1176_with_row_owner_feature_only_safe_assertion_confirmation`; R1175 remains synthetic/non-evidence and product display remains blocked.

## Verification Results

- `pnpm exec vitest run --config scripts/vitest.config.ts scripts/murph-age/r1175-r1172-to-r1165-safe-assertion-bridge-smoke.test.ts scripts/murph-age/r1145-ordinary-consumer-current-chain-completion-audit.test.ts scripts/murph-age/r1076-current-autoresearch-loop-executor.test.ts` passed.
- `pnpm exec vitest run --config scripts/vitest.config.ts scripts/murph-age` passed.
- `pnpm exec tsc -p tsconfig.tools.json --pretty false` passed.
- `pnpm typecheck` passed.
- Diff whitespace, trailing-whitespace, identifier/credential, refreshed-artifact identifier, and refreshed-artifact aggregate-egress scans passed.
Status: completed
Updated: 2026-05-18
Completed: 2026-05-18
