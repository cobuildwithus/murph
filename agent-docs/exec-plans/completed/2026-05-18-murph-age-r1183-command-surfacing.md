# Murph Age R1183 Command Surfacing

## Goal

Surface the safe R1183 materializer command as the visible next runnable action when the average-submitter lab/wearable chain is waiting on explicit row-owner confirmation.

## Scope

- `scripts/murph-age/r1182-average-submitter-safe-response-handoff.ts`
- `scripts/murph-age/r1182-average-submitter-safe-response-handoff.test.ts`
- `scripts/murph-age/r1178-average-submitter-current-loop-surfacing.ts`
- `scripts/murph-age/r1178-average-submitter-current-loop-surfacing.test.ts`
- `scripts/murph-age/r1179-average-submitter-objective-gap-audit.ts`
- `scripts/murph-age/r1179-average-submitter-objective-gap-audit.test.ts`
- `.runtime/operations/research/murph-age/model-runs/r1178-*`
- `.runtime/operations/research/murph-age/model-runs/r1179-*`
- `.runtime/operations/research/murph-age/model-runs/r1182-*`

## Constraints

- Keep glycemia bloodwork/labs plus daily wearable activity as the first ordinary 16-50 submitter path.
- Do not infer row-owner confirmation from command surfacing.
- Keep all output aggregate-only, feature-only, and product-display blocked.
- Do not store private paths, headers, filenames, row values, participant identifiers, private refs, source variable names, predictions, coefficients, model parameters, source text, or small cells.
- Preserve unrelated dirty worktree edits.

## Plan

1. Inspect the current R1178/R1179/R1182 next-action and command propagation.
2. Route waiting-on-safe-confirmation command fields to the existing R1183 materializer where that is the immediate runnable action.
3. Update focused tests so command surfacing is guarded without weakening explicit confirmation gates.
4. Regenerate live artifacts and run focused/full Murph Age verification, typecheck, privacy/egress scans, and scoped commit.

## Verification

- Focused R1178/R1179/R1182 tests.
- Full Murph Age script suite.
- `pnpm typecheck`.
- `bash scripts/workspace-verify.sh test:diff ...`.
- Diff/whitespace/privacy/aggregate egress checks for touched files/artifacts.
Status: completed
Updated: 2026-05-18
Completed: 2026-05-18
