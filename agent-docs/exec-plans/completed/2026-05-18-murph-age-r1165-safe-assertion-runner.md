# Murph Age R1165 Safe Assertion Runner

## Goal

Add a narrow aggregate-only runner that lets an ordinary 16-50 submitter provide a safe yes/no/enumerated assertion that lab portal or spreadsheet bloodwork plus phone/watch/wearable daily activity exports are available, then runs the R1163 research-only chain only after that assertion validates.

## Success Criteria

- R1165 publishes a safe assertion template and validator for the minimum `bloodwork_glycemia` plus `wearable_activity_daily` pair.
- R1165 accepts no row values, headers, file names, paths, participant identifiers, source text, predictions, coefficients, model parameters, or private refs.
- R1165 does not infer row-owner confirmation; it only runs R1163 after an explicit valid assertion file is supplied.
- R1076 and R1145 surface the R1165 command/state without promoting model evidence, product display, or ReviewGPT.
- Focused tests, Murph Age verification, typecheck, diff/whitespace checks, and privacy/egress scans pass or are reported with unrelated blockers.

## Scope

- `scripts/murph-age/r1165-ordinary-consumer-feature-only-safe-assertion-runner.ts`
- `scripts/murph-age/r1165-ordinary-consumer-feature-only-safe-assertion-runner.test.ts`
- R1076/R1145 optional surfacing and tests
- R1165 latest runtime artifact and generated safe assertion template under the Murph Age model-runs directory
- Completion plan/ledger cleanup

## Constraints

- No product display, ReviewGPT send, or model evidence promotion.
- No row parsing, private config execution, or synthetic row-owner assertion.
- Preserve unrelated dirty worktree changes.

## Verification Plan

- Focused R1165 test.
- Focused R1076/R1145 integration tests for R1165 surfacing.
- Full Murph Age script suite.
- `pnpm exec tsc -p tsconfig.tools.json --pretty false`
- `pnpm typecheck`
- Diff/whitespace and identifier/private-detail/aggregate-egress scans for touched files and regenerated artifacts.

Status: completed
Updated: 2026-05-18
Completed: 2026-05-18
