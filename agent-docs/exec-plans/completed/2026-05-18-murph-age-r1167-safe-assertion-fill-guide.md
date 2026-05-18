# Murph Age R1167 Safe Assertion Fill Guide

## Goal

Add a pathless, aggregate-safe fill guide for the R1165 row-owner feature-only safe assertion template so an ordinary 16-50 submitter can identify the allowed lab portal/spreadsheet and phone/watch/wearable boolean assertions without sharing private values.

## Success Criteria

- R1167 emits a research-local artifact that validates the current R1165 runner/template state before declaring the guide ready.
- The guide names only safe field paths, allowed boolean/enumerated assertion values, required input kinds, and blocked private-content categories.
- The guide preserves R1165's no-private-data boundary: no paths, headers, file names, row values, participant identifiers, predictions, coefficients, source text, source variables, or small cells.
- R1165 remains the execution gate; R1167 does not infer row-owner availability or run R1163/R1164.
- Focused tests, Murph Age verification, typecheck, diff/whitespace checks, and privacy/egress scans pass or are reported with unrelated blockers.

## Scope

- `scripts/murph-age/r1167-ordinary-consumer-feature-only-safe-assertion-fill-guide.ts`
- `scripts/murph-age/r1167-ordinary-consumer-feature-only-safe-assertion-fill-guide.test.ts`
- `.runtime/operations/research/murph-age/model-runs/r1167-*`
- Completion plan/ledger cleanup

## Constraints

- Preserve R1165 as the only assertion acceptance/child-runner gate.
- Do not request, store, or echo private details.
- Preserve outcome-linked model evidence, product display, and ReviewGPT gates.
- Preserve unrelated dirty worktree changes.

## Verification Plan

- Focused R1167 tests.
- Full Murph Age script suite.
- `pnpm exec tsc -p tsconfig.tools.json --pretty false`
- `pnpm typecheck`
- Diff/whitespace and identifier/private-detail/aggregate-egress scans for touched files and generated artifacts.

Status: completed
Updated: 2026-05-18
Completed: 2026-05-18
