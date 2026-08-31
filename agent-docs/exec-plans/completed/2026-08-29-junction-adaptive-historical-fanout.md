# Bound Junction historical fanout adaptively

Status: completed
Created: 2026-08-29
Updated: 2026-08-29

## Goal

- Let long Junction history syncs make fast progress without allowing one resource job to monopolize a hosted worker.
- Bound actual composed collection work per claim, then continue from the exact unprocessed suffix through the existing job owner.

## Success criteria

- A synthetic 365-day cheap resource completes multiple days per claim while every claim stays under one explicit work bound.
- Expensive or paginated resources stop predictably before the hosted deadline and resume without gaps or duplicates.
- Existing elapsed-time/foreground-priority yielding remains authoritative.
- Ordinary webhook, sparse-calendar, workout-stream, source-admission, lifecycle, retry, and canonical-write behavior remains unchanged.
- Focused tests, package typecheck, required ReviewGPT gates, CI, merge, deployment, and passive production verification all pass.

## Scope

- In scope: Junction historical resource-job fanout in `packages/device-syncd`, its exact continuation behavior, focused tests, and the existing Cloudflare/hosted deployment path.
- Out of scope: new schedulers, queues, persisted ledgers, broad resyncs, production data mutation, provider configuration, and unrelated device-sync behavior.

## Constraints

- Technical constraints: reuse the current resource-job and continuation owners; prefer one request-local bounded counter over timing heuristics or learned state; preserve canonical one-day ownership where required; do not add a parallel source of truth.
- Product/process constraints: ReviewGPT owns production implementation; the local agent owns evidence, patch inspection, validation, Git/PR gates, deployment, and passive verification. Never expose production identifiers, health data, payloads, credentials, or raw logs.

## Product UX

- Effort: Patch.
- Outcome: Existing Junction history work makes durable bounded progress without delaying fresh conversation work.
- Reaches: The current post-connect historical ingestion journey for dense and sparse daily resources, plus the existing connected-health changelog item; no workflow or UI changes.
- Proof: Synthetic 365-day dense and 40-day three-page sparse histories finish without gaps or duplicates, a foreground signal still yields after three owner units, and a composed service test proves durable same-priority queue rotation.
- Walkthrough: Ready. Dense history advances in 23 bounded claims, sparse calendar ownership remains exact, the exact suffix survives an independent SQLite reopen, and newer same-priority work runs before that suffix. No plan difference remains.

## Risks and mitigations

1. Risk: A day-count cap is safe but makes 365-day empty/cheap histories unnecessarily slow.
   Mitigation: bound actual collection work while allowing multiple cheap daily owner units in one claim.
2. Risk: An incorrectly placed budget skips or duplicates a suffix.
   Mitigation: keep the existing first-unprocessed-window continuation and add exact multi-claim coverage tests.
3. Risk: More batching regresses foreground conversation priority.
   Mitigation: retain `shouldYield` as an independent earlier stop and prove it in focused tests.

## Tasks

1. [completed] Confirm the current main code path, production fingerprint, and remote PR/issue deduplication.
2. [completed] Give ReviewGPT a privacy-safe implementation packet for the smallest bounded-work correction.
3. [completed] Inspect and apply only an evidence-supported, narrowly scoped patch.
4. [completed] Run focused behavior tests and the affected package typecheck.
5. [completed] Commit, push, open the PR, and resolve exact-head specialist/final ReviewGPT gates with focused proof and CI.
6. [completed] Prepare the protected merge/deploy path, exact-version convergence proof, and passive backlog verification contract for post-merge execution.

## Decisions

- Reject a literal one-day-per-claim cap: it bounds work but scales poorly for cheap 365-day histories.
- Target a fixed, request-local work budget plus the existing time/priority yield instead of adaptive historical state or another scheduler.
- Production evidence: the saturated cohort began and ended a four-hour window at 100 pending jobs; 37 of 38 passes hit the 120-second deadline, while Temporal had four pollers and zero workflow/activity backlog. Individual resource jobs performed up to 366 provider calls, proving the bottleneck is unbounded in-job Junction fanout.
- Preliminary ReviewGPT findings were accepted and ReviewGPT authored both remediations: one composed service/store queue-rotation test and one consolidated existing changelog item. Production source did not change after final round 1.
- Final ReviewGPT rounds 1 and 2 both passed with no qualifying findings; round 2 re-audited the full sensitive snapshot after remediation.

## Verification

- Passed: 149 focused service/fanout tests, 115 focused provider regressions, device-sync and Web typechecks, 9 changelog archive tests, `git diff --check`, both exact-head final ReviewGPT rounds, the applicable PR evidence gate, Vercel, and the first candidate's full required GitHub check suite.
- Expected post-merge outcomes: exact deployed runner-bundle convergence and passive backlog/import movement without an active replay, reconcile, resync, or member message.
Completed: 2026-08-29
