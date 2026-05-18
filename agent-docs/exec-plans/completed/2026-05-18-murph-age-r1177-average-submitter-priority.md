# Murph Age R1177 Average-Submitter Priority Packet

## Goal

Add a narrow aggregate-only R1177 packet that makes the current Murph Age next step prioritize ordinary roughly 16-50 submitters with:

- a glycemia bloodwork lab portal export or spreadsheet
- a phone/watch/wearable daily activity export

The packet should demote optional common bloodwork and vitals/body context until the required pair is confirmed, and it must not accept or persist private paths, headers, row values, identifiers, predictions, coefficients, source text, or small cells.

## Scope

- Add `scripts/murph-age/r1177-ordinary-consumer-average-submitter-priority-packet.ts`.
- Add focused tests for the default blocked state, ready state, missing/stale input handling, CLI output, and path-safe CLI errors.
- Refresh the R1177 latest artifact under `.runtime/operations/research/murph-age/model-runs/`.

## Out Of Scope

- No row parsing, private route config ingestion, or real route metric computation.
- No product display, product claims, ReviewGPT send, model evidence promotion, or source-rights changes.
- No branch/worktree changes.

## Verification

- Focused R1177 Vitest file.
- Focused/current Murph Age script slice as needed.
- Full `scripts/murph-age` Vitest suite if feasible.
- `pnpm typecheck`.
- Diff/whitespace and targeted privacy/aggregate-egress scans.

## Outcome

- Added the aggregate-only R1177 average-submitter priority packet and focused tests.
- Refreshed the ignored latest R1177 runtime artifact.
- Verification passed: focused R1177 tests, focused current-chain slice, full `scripts/murph-age` suite, scoped `test:diff`, `pnpm typecheck`, whitespace/privacy scans, and aggregate-egress scan.
- Required security/privacy, simplify, coverage-write, and task-finish review passes completed; final review found no remaining findings.

## Status

- Completed.
Status: completed
Updated: 2026-05-18
Completed: 2026-05-18
