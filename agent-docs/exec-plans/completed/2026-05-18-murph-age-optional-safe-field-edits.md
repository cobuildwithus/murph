# Murph Age Optional Safe Field Edits

## Goal

Surface optional `common_bloodwork_core` and `vitals_body_context` availability fields as safe row-owner edits across the R1165 safe assertion fill path, so ordinary 16-50 lab/wearable submitters can explicitly mark optional common bloodwork and vitals/body context availability without making those add-ons required.

Success criteria:

- R1167 fill guide lists optional add-on availability fields as safe edits.
- R1172 materializer/audit contract recognizes the expanded safe-edit path set while keeping optional add-ons optional.
- R1173 answer sheet, R1174 next-step packet, and R1176 live-chain packet surface the expanded safe-edit path set.
- R1145/R1076 fixtures and summaries remain aligned with the expanded safe-edit path count.
- Current-loop outputs still require row-owner confirmation and do not promote model evidence or product display.
- Focused tests, full Murph Age suite, typechecks, whitespace/privacy scans, and refreshed-artifact egress scans pass.

## Scope

- `scripts/murph-age/r1167-ordinary-consumer-feature-only-safe-assertion-fill-guide.ts`
- `scripts/murph-age/r1167-ordinary-consumer-feature-only-safe-assertion-fill-guide.test.ts`
- `scripts/murph-age/r1170-ordinary-consumer-safe-assertion-smoke-proof.ts`
- `scripts/murph-age/r1170-ordinary-consumer-safe-assertion-smoke-proof.test.ts`
- `scripts/murph-age/r1172-ordinary-consumer-safe-assertion-materializer.ts`
- `scripts/murph-age/r1172-ordinary-consumer-safe-assertion-materializer.test.ts`
- `scripts/murph-age/r1173-ordinary-consumer-safe-assertion-answer-sheet.ts`
- `scripts/murph-age/r1173-ordinary-consumer-safe-assertion-answer-sheet.test.ts`
- `scripts/murph-age/r1174-ordinary-consumer-safe-next-step-packet.ts`
- `scripts/murph-age/r1174-ordinary-consumer-safe-next-step-packet.test.ts`
- `scripts/murph-age/r1175-r1172-to-r1165-safe-assertion-bridge-smoke.ts`
- `scripts/murph-age/r1175-r1172-to-r1165-safe-assertion-bridge-smoke.test.ts`
- `scripts/murph-age/r1176-r1172-r1165-row-owner-safe-assertion-chain-runner.ts`
- `scripts/murph-age/r1176-r1172-r1165-row-owner-safe-assertion-chain-runner.test.ts`
- Downstream R1145/R1076 fixture alignment and refreshed ignored artifacts as needed

## Constraints

- Keep `bloodwork_glycemia` plus `wearable_activity_daily` as the minimum required feature-only pair.
- Keep `common_bloodwork_core` and `vitals_body_context` optional and non-evidence unless the row owner explicitly confirms them.
- Do not infer row-owner confirmation.
- Do not store or expose private paths, headers, filenames, row values, identifiers, source variable names, predictions, coefficients, model parameters, source text, or small cells.
- Preserve unrelated dirty worktree changes and active ledger rows.

## Verification Plan

1. Focused tests for R1167/R1172/R1173/R1174/R1176 plus R1145/R1076.
2. Refresh affected artifacts.
3. Full Murph Age suite.
4. `pnpm exec tsc -p tsconfig.tools.json --pretty false` and `pnpm typecheck`.
5. Diff whitespace, touched-file identifier/credential, refreshed-artifact identifier, and aggregate-egress scans.

## Results

- Added optional `sourceFamilies[common_bloodwork_core].available` and `sourceFamilies[vitals_body_context].available` safe-edit paths through R1167/R1172/R1173/R1174/R1175/R1176/R1170.
- Updated R1173 answer-sheet mapping so optional safe-field edits map to optional add-on families while the required feature pair stays `bloodwork_glycemia` plus `wearable_activity_daily`.
- Updated R1145/R1076 surfacing and tests to align with the 17-field safe assertion path.
- Kept the legacy R1160 safe transcription proof at 15 steps so older required-pair confirmation proof remains distinct from the optional safe assertion path.
- Hardened R1167/R1172/R1173/R1174/R1175/R1176 CLI failure paths so path-looking errors fall back to generic command-specific stderr.
- Split R1145 required primary input gating so `common_bloodwork_core` and `vitals_body_context` stay optional add-ons rather than blocking the active-loop priority check.
- Refreshed current R1145 and R1076 artifacts after the R1145 required-pair split.

## Verification Results

- `pnpm exec vitest run --config scripts/vitest.config.ts scripts/murph-age/r1167-ordinary-consumer-feature-only-safe-assertion-fill-guide.test.ts scripts/murph-age/r1170-ordinary-consumer-safe-assertion-smoke-proof.test.ts scripts/murph-age/r1172-ordinary-consumer-safe-assertion-materializer.test.ts scripts/murph-age/r1173-ordinary-consumer-safe-assertion-answer-sheet.test.ts scripts/murph-age/r1174-ordinary-consumer-safe-next-step-packet.test.ts scripts/murph-age/r1175-r1172-to-r1165-safe-assertion-bridge-smoke.test.ts scripts/murph-age/r1176-r1172-r1165-row-owner-safe-assertion-chain-runner.test.ts scripts/murph-age/r1145-ordinary-consumer-current-chain-completion-audit.test.ts scripts/murph-age/r1076-current-autoresearch-loop-executor.test.ts`: passed, 9 files / 82 tests.
- `pnpm exec vitest run --config scripts/vitest.config.ts scripts/murph-age`: passed, 198 files / 902 tests.
- `pnpm exec tsc -p tsconfig.tools.json --pretty false`: passed.
- `pnpm typecheck`: passed.
- Direct trailing whitespace/conflict-marker scan over touched files: passed.
- Touched-file and refreshed-artifact identifier/secret scan: passed.
- Refreshed-artifact aggregate-egress scan: passed.
- Security/privacy audit: no findings after fixes.
- Coverage audit: no coverage gaps after the CLI redaction tests and R1145 optional-primary regression.
- Final task-finish review: no findings after the R1145 optional-primary fix.

## Remaining Blocker

The current Murph Age loop still waits on real row-owner confirmation/private route evidence. R1176 row-owner safe assertion confirmation, private route config, and real lab/wearable route metrics remain required before model evidence, ReviewGPT, product display, or goal completion can proceed.

## Commit Status

Scoped commit is blocked by broad unrelated dirty/untracked work in the checkout, including many files outside this task scope. Close the active plan and ledger row without staging or committing this slice.
Status: completed
Updated: 2026-05-18
Completed: 2026-05-18
