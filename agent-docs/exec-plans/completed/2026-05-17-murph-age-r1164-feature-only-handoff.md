# Murph Age R1164 Feature-Only Handoff

## Goal

Add a narrow aggregate-only handoff artifact that turns the R1163 ordinary lab-plus-wearable availability runner state into a clear research-only planning packet for average 16-50 submitters.

## Success Criteria

- R1164 consumes the safe R1163 artifact and never accepts or stores private paths, headers, filenames, row values, refs, participant identifiers, source text, predictions, coefficients, or model parameters.
- R1164 prioritizes bloodwork/lab portal or spreadsheet exports plus phone/watch/wearable daily activity exports as the minimum feature-only pair.
- R1164 explicitly distinguishes feature-only research planning from real outcome-linked model evidence.
- Focused tests, Murph Age verification, typecheck, diff/whitespace checks, and privacy/egress scans pass or are reported with unrelated blockers.

## Scope

- `scripts/murph-age/r1164-ordinary-consumer-feature-only-research-handoff.ts`
- `scripts/murph-age/r1164-ordinary-consumer-feature-only-research-handoff.test.ts`
- R1164 latest runtime artifact under the Murph Age model-runs directory
- Completion plan/ledger cleanup

## Constraints

- No product display or ReviewGPT send.
- No row parsing, private config execution, or model evidence promotion.
- Preserve unrelated dirty worktree changes.

## Verification Plan

- Focused R1164 test.
- Focused R1163/R1164 test pair.
- Full Murph Age script suite.
- `pnpm exec tsc -p tsconfig.tools.json --pretty false`
- `pnpm typecheck`
- Diff/whitespace and identifier/private-detail/aggregate-egress scans for touched files and regenerated artifacts.
Status: completed
Updated: 2026-05-17
Completed: 2026-05-17
