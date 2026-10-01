# Repair canonical reminder live fixture hosted automation boundary

Status: completed
Created: 2026-09-29
Updated: 2026-09-29

## Goal

Repair Frog #3903: the canonical reminder fixture must provide the current hosted automation contract during create and cancel, retaining actual canonical persistence and scheduler behavior.

## Scope and constraints

Only test fixtures, deterministic coverage and owner documentation change. The synthetic port owns no hosted authorization policy, external transport, provider response, or scheduler. It delegates writes and reads to core and timing to the existing cron owner. Production runtime port tests retain host policy coverage. No dependency cycle or private runtime implementation copy is introduced.

This automation explicitly prohibits nested Codex execution. The existing real-model journey remains available for separately authorized execution; this change claims deterministic fixture proof, not a live-model result.

## Tasks

1. Reproduce missing execution context at the create-turn boundary.
2. Supply one hosted port and execution context through create, scheduling and cancellation; update obsolete CLI and null-model assertions.
3. Verify canonical writes, real timing projection, optimistic concurrency and archive effects deterministically.
4. Complete typecheck, parent review, exact-head ReviewGPT and required CI.

## Evidence

- The new create-turn regression fails on the unchanged baseline because automationTool is absent. Candidate restored after the isolated baseline run.
- Prepared runtime build passed. Six deterministic cases pass, including actual dynamic-tool dispatch, missing-port rejection, real canonical persistence, stale-update rejection and cancellation. Package typecheck, docs drift and complexity checks passed. Parent candidate review passed. Exact-head ReviewGPT and required CI remain completion gates.

## Decisions

- The engine-owned fixture supplies a synthetic implementation of the public hosted port contract; actual storage and scheduler remain production implementations.
- A reminder must save a supported Luna or Sol override. Scheduled usage is checked against that saved override, while ordinary conversation turns retain the configured model.
Completed: 2026-09-29
