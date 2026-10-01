# Separate runtime invocation setup projections

Status: completed
Created: 2026-09-13
Updated: 2026-09-14

## Outcome and invariant

Reduce the largest runtime coordinator hotspot by separating initial checkpoint metadata and base environment projections into private functions. Preserve fallback order, trust-store and forwarded/user environment precedence, platform feature admission, and all checkpoint/wake state ownership.

## Design

Reuse existing runtime normalization and checkpoint contracts. Pass the current workspace and request explicitly to the metadata projection. Keep environment reads at their existing initialization point. Leave abort handlers, lifecycle ownership, database and checkpoint operations in the coordinator. No new public API, persisted state, dependency or deployment setting.

## Proof and completion

Run runtime checkpoint, startup and environment coverage, package typecheck, complexity guard and candidate diff review. Compare extracted expressions and order against the base. Publish an isolated PR; start ReviewGPT on the stable pushed head concurrently with CI.

## Results

Coordinator complexity 251 → 233; file debt 513 → 495. Both private projections stay below 20. Candidate review checked unchanged field order, fallback and environment precedence, and call-site ordering. Runtime package typecheck passed.

Focused startup, checkpoint-wake, restore and environment suites passed 110 of 111 tests on the combined run. The detached-ask authority/join case hit its bounded event wait under concurrent local load, then passed alone on the same candidate (one test, 354 ms). The complete startup suite then passed all 29 tests; combined with the other three passing suites, all 111 selected cases have passed. No assertion was weakened.

Exact-head CI and final ReviewGPT remain external completion gates after publication.
Completed: 2026-09-14
