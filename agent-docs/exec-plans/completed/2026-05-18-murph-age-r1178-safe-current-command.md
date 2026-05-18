# Murph Age R1178 Safe Current Command

## Goal

Make R1178 choose the safe row-owner answer-sheet command as the current loop command while the ordinary 16-50 lab-plus-wearable row-owner assertion is still missing.

## Scope

- `scripts/murph-age/r1178-average-submitter-current-loop-surfacing.ts`
- `scripts/murph-age/r1178-average-submitter-current-loop-surfacing.test.ts`
- refreshed R1178 ignored runtime artifact

## Non-Goals

- Do not remove the explicit row-owner-only R1176 live-chain command.
- Do not infer row-owner confirmation.
- Do not read, parse, store, or surface private paths, headers, row values, refs, source text, predictions, coefficients, or product claims.
- Do not change earlier R1173/R1174/R1176 artifacts.

## Verification Plan

- Focused R1178 tests.
- Adjacent R1177/R1178/R1179 tests.
- Full Murph Age script suite.
- `pnpm typecheck`.
- Scoped `workspace-verify test:diff`.
- R1178 direct artifact regeneration and aggregate-egress scan.
- Required completion audits for privacy-sensitive repo code/test work.
Status: completed
Updated: 2026-05-18
Completed: 2026-05-18
