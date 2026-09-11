# Collapse assistant terminal settlement duplication

Status: completed
Created: 2026-09-11
Updated: 2026-09-11

## Goal and protected invariants

Reduce local-service terminal-settlement complexity while preserving each returned result, transcript, delivery, usage record, and failure outcome. The turn lock and active-input controller remain the lifecycle owners; preserve registration, drain, commit-authority, resume, cancellation, and cleanup ordering.

## Evidence and design

The current source duplicates delivery-outcome result construction in ordinary completion, accepted-no-reply failure recovery, and deterministic audience-safety completion. Provider success and terminal failure also duplicate usage ordinal allocation and recording. Transcript projection occupies the lifecycle function despite depending only on already-resolved turn facts. Keep focused helpers in the same owner; add no mutable lifecycle object, new persistence, retry, or external work.

## Scope

- Local-service result/usage settlement and preceding/final response projection.
- Focused existing local-service tests, relevant package typecheck, complexity guard, and one production-derived real-Codex journey.
- Parent owns candidate review, Ready, exact-head CI, final ReviewGPT, and merge.

## Tasks

1. Collapse repeated result and usage construction without moving effects.
2. Isolate transcript projection at its existing call position.
3. Verify authority, failure, delivery, steering, typing, and session regression suites plus typecheck and guard.
4. Inspect live reply, privacy and final diff; close the implementation plan and open a complete draft PR.

## Verification

- `pnpm --filter @murphai/assistant-engine typecheck` passed.
- `pnpm complexity:diff --base HEAD -- packages/assistant-engine/src/assistant/local-service.ts` passed against creation base `85c157e01432a45d694732c93934998fc50df059`: file debt 143 to 108, maximum 128 to 109; `runCurrentProviderRequest` 55 to 39.
- Remaining hotspots are the turn lifecycle owner (`run`, 109) and provider request owner (`runCurrentProviderRequest`, 39). Further splitting their mutable authority, steering, and recovery transitions would exceed this focused settlement change.
- Focused local-service failures, delivery, live-input, typing-input, and session suites passed: 5 files, 108 tests, with one worker.
- Existing focused real-Codex journey `answers once from an early detail retained across sixty committed messages` passed with `gpt-5.6-terra`, local subscription auth: 60 committed messages, one provider request, one user/assistant transcript pair, and the correct concise recall reply. Reply review: Ready.
- Full source diff reviewed by the parent. Confirmed that null transcript input returns before media inspection and that the four-case delivery union preserves intent projection. No source changes were requested.
- Privacy and final diff checks passed. No new Frog entry was needed; relevant existing friction records were inspected.
- Implementation complete; parent retains final candidate/head review, Ready, exact-head CI, ReviewGPT, and merge ownership.
- Provider inputs, tool declarations, persisted schemas, and deployment contracts are unchanged; initial provider input measurement is not applicable.
Completed: 2026-09-11
