# Murph Age R1180 Action Guidance

## Goal

Make the average-submitter safe confirmation intake self-guiding when it is the live current-loop command: if no safe response has been supplied yet, R1180 should point to the existing safe fillable-response/materializer path instead of ending at a null command.

## Scope

- `scripts/murph-age/r1180-average-submitter-safe-confirmation-response-intake.ts`
- `scripts/murph-age/r1180-average-submitter-safe-confirmation-response-intake.test.ts`
- `scripts/murph-age/r1181-average-submitter-feature-only-execution-contract.ts`
- `scripts/murph-age/r1181-average-submitter-feature-only-execution-contract.test.ts`
- `.runtime/operations/research/murph-age/model-runs/r1180-*`

## Constraints

- Preserve the priority order: glycemia bloodwork/labs plus daily wearable activity first for ordinary roughly 16-50 submitters.
- Keep all R1180 output aggregate-only and feature-only.
- Do not store private paths, headers, filenames, row values, participant identifiers, source variable names, predictions, coefficients, model parameters, source text, or small cells.
- Do not infer row-owner confirmation. Only explicit safe response inputs may mark the confirmation ready.
- Keep product display and ReviewGPT blocked until real aggregate evidence gates clear.
- Preserve unrelated dirty worktree edits.

## Plan

1. Add safe action guidance to R1180 waiting/incomplete states, including the existing R1183 materializer command and safe fillable artifact name.
2. Expose the guidance in the R1180 CLI summary without dumping the template body or local paths.
3. Update R1181's exact R1180 packet guard so the new guidance is validated rather than treated as shape drift.
4. Update focused R1180/R1181 tests for waiting, incomplete, ready, invalid, stale-ask, CLI behavior, and guidance drift.
5. Regenerate the live artifacts, run focused/broad verification, privacy/egress scans, and commit through `scripts/finish-task`.

## Verification

- Focused R1180 test.
- Broad Murph Age script suite.
- `pnpm typecheck`.
- `bash scripts/workspace-verify.sh test:diff ...`.
- Diff/whitespace/privacy/aggregate egress checks for touched files/artifacts.
Status: completed
Updated: 2026-05-18
Completed: 2026-05-18
