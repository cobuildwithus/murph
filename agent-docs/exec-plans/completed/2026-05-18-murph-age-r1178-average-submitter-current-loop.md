# Murph Age R1178 Average-Submitter Current-Loop Surfacing

## Goal

Add a narrow aggregate-only R1178 packet that bridges the current autoresearch loop state to the R1177 average-submitter priority packet, so ordinary roughly 16-50 submitters are pointed first at the bloodwork/labs plus wearable activity pair.

## Scope

- Add `scripts/murph-age/r1178-average-submitter-current-loop-surfacing.ts`.
- Add focused tests for valid R1076/R1177 surfacing, missing or stale R1177 routing, safe CLI output, and path-safe CLI errors.
- Refresh the R1178 latest artifact under `.runtime/operations/research/murph-age/model-runs/`.

## Out Of Scope

- No edits to the existing R1075/R1076 current-loop executor files in this crowded worktree.
- No row parsing, private route config ingestion, real route metric computation, product display, product claims, ReviewGPT send, or model evidence promotion.
- No branch/worktree changes.

## Verification

- Focused R1178 Vitest file.
- Focused current priority packet slice as needed.
- Full `scripts/murph-age` Vitest suite if feasible.
- `pnpm typecheck`.
- Diff/whitespace and targeted privacy/aggregate-egress scans.
Status: completed
Updated: 2026-05-18
Completed: 2026-05-18
