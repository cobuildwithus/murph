# Murph Age R1158 Fill Guide

## Goal

Add a pathless, aggregate-only R1158 row-owner fill guide for the average ordinary roughly 16-50 submitter path, focused on glycemia bloodwork/lab exports plus daily phone/watch/wearable activity exports.

## Scope

- `scripts/murph-age/r1158-ordinary-consumer-safe-confirmation-fill-guide.ts`
- `scripts/murph-age/r1158-ordinary-consumer-safe-confirmation-fill-guide.test.ts`
- Refreshed R1158 artifact

## Constraints

- Do not accept or store row-level data, private values, paths, headers, filenames, source text, account identifiers, predictions, coefficients, product claims, or model-evidence promotion.
- Treat the guide as a non-evidence fill aid only; it must not assert that the row owner actually has labs or wearable data.
- Preserve the live blocker on actual row-owner safe confirmation and real lab/wearable route metrics.

## Plan

1. Read R1150 feature-only template, R1154 quickstart, R1156 handoff, and R1157 chain runner summaries.
2. Emit a consolidated row-owner fill guide with required input kinds, exact safe field edits, blocked content, and next commands.
3. Add tests for ready, missing quickstart, unsafe input rejection, CLI summary, and privacy egress.
4. Regenerate the R1158 artifact.
5. Run focused tests, Murph Age tests, typecheck, and scoped privacy/identifier scans.

## Verification

- Focused R1158 tests.
- Full Murph Age script suite.
- `pnpm exec tsc -p tsconfig.tools.json --pretty false`.
- `pnpm typecheck`.
- Scoped artifact egress and direct identifier scans.

Status: completed
Updated: 2026-05-17
Completed: 2026-05-17
