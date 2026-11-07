# Measure canonical meal read latency

Status: completed
Created: 2026-10-23
Updated: 2026-10-23

## Goal

Deliver only the meal-read telemetry prerequisite and synthetic benchmark in this sweep.
Hold the duplicate-read behavioral optimization pending [issue #4344](https://github.com/cobuildwithus/murph/issues/4344).

## Success criteria

- Measure fixed core-load, candidate-scan and revision-scan wall spans through the existing timing pipeline.
- Preserve results, error identity, scan/storage behavior, canonical ownership, retention and privacy.
- Keep benchmark evidence distinct from production causality; record review, rollout and observation status honestly.

## Scope

- Keep the separately authored 244-line core benchmark, its README, and three fixed timing phases with their tests/docs.
- Preserve `packages/assistant-engine/test/cli-timing-profile.test.ts` and every core/runtime/usecase timing and benchmark file.
- Restore only the three optimization paths to `4ec40920fca1872c8324d9325c23a9e50ba39754` and remove only the new cleanup changelog fragment.
- No behavioral optimization, recovery feature, new journey, dependency or member changelog belongs in this telemetry-only scope.

## Constraints

Observation only; no production mutation or rollback. Parent owns scoped integration and lifecycle helpers.
Deploy and verify readers first: Web, then Worker, then runner. Record exact versions and rollout status in the PR.
Keep this plan active until the parent completes `finish-task` closure; release is not complete.

## Risks and mitigations

- Old readers can reject the extended timing catalog: verify each reader before releasing the producer.
- Unordered aggregates cannot establish duplicate counts; synthetic timings cannot explain the production maximum.
- App heartbeat tooling is absent: the immediate four-hour scheduled observation is blocked unless capability becomes available. Record the blocker; make no health claim.
- Failed-work semantics belong to the failed-call investigator in #4344. Do not weaken the failure assertion or force invalid JSON.

## Tasks

- [x] Hold the behavioral patch and hand off the preexisting recovery/output contract to #4344; retain private-safe patches/logs.
- [x] Record parent-reported timing, compatibility, typecheck and benchmark proof below.
- [ ] Parent applies the scoped restorations and this docs-only disposition while preserving the timing/benchmark work.
- [ ] Complete parent review, CI on the exact candidate, independent final ReviewGPT and merge.
- [ ] Verify Web → Worker → runner deployment; anchor 24/72-hour measurement windows to that verified deployment.
- [ ] Begin immediate four-hour observations when supported, or record the explicit monitoring blocker and exact status in the PR.
- [ ] Parent completes task closure through the repository lifecycle helper.

## Decisions

- Supplied aggregate: 104 successful shows total about 1,060 s, maximum 28.6 s; 100 reads came from three cron profiles. Ordering is unavailable.
- Held optimization: historical success measured seven → six CLI calls with silent skip/no card; one synthetic compact full-output segment measured 2,621 → 1,315 bytes. This is unshipped, with no production speedup claim.
- Unavailable-readback candidate failed the strict gate: seven calls, one fallback, truthful prose but an accepted `skip`. The same base-skill fixture accepted a failure-summary `skip` in eight calls, including a queue recheck.
- Existing retry proof passes both read orders: at most two edits, one cleanup after verified retry success, none after failed retry. Failed retry truthfully returns `send_message`; structured failed work remains unsupported.

## Verification

Parent-reported PASS: 10 core + 17 usecase + 64 runtime-state + 13 assistant-profile timing tests, including actual `4ec40920` older-reader compatibility in both runtime-state and assistant-engine.
All affected typechecks, workspace boundaries, complexity and docs-drift checks PASS.

Synthetic owned-read benchmark uses the actual path, mixed compressed shards and freshness parity; ten warm alternating pairs after two warmups:

| Fixture | Median | Range |
| --- | --- | --- |
| 24k | 112.85 ms | 110.45–117.66 ms |
| 240k | 951.00 ms | 931.01–993.72 ms |

These measurements do not attribute the 28.6 s production maximum. Final review, exact CI, merge, verified deployment and observation remain parent-owned and pending; monitoring is blocked as above.
Completed: 2026-10-23
