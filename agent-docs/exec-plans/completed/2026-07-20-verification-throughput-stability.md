# Verification throughput and stability

Status: completed
Created: 2026-07-20
Updated: 2026-07-21

## Goal

- Make canonical local and Crabbox acceptance verification reliably exploit a
  16-core host without oversubscribing independent package and application
  worker pools, reducing the established 11m55s local baseline by at least 3x
  and targeting 4x where the complete workload permits.

## Success criteria

- `pnpm verify:acceptance` passes locally and through the Crabbox direct
  Blacksmith provider on the exact same commit.
- Local acceptance wall time is at most 3m58s (3x faster than 11m55s); the
  measured result and any gap to 4x are reported truthfully.
- At least two fresh Crabbox acceptance samples pass without unrelated timeout
  failures, and their timing distribution is recorded.
- The composed package/app worker allocation cannot request substantially more
  CPU workers than the detected host budget during the overlap window.
- Focused repo-tool tests lock the resource allocation, shared-host behavior,
  override semantics, and failure propagation.
- Durable verification docs match the implemented command behavior.

## Scope

- In scope: root verification orchestration, app verification worker budgets,
  focused repo-tool tests, and durable verification documentation.
- Out of scope: deleting coverage, weakening timeouts or assertions, changing
  product/runtime behavior, and buying a larger Blacksmith machine before the
  current 16-vCPU lane is scheduled correctly.

## Constraints

- Technical constraints: preserve full canonical acceptance coverage, shared
  artifact ordering, exact process ownership, explicit environment overrides,
  and deterministic failure aggregation.
- Product/process constraints: use canonical `pnpm verify:acceptance` locally
  and through Crabbox; keep secrets and local identifiers out of artifacts.

## Risks and mitigations

1. Risk: excessive fanout makes individual tests hit wall-clock timeouts.
   Mitigation: allocate one composed CPU budget across concurrent branches and
   benchmark repeated fresh machines.
2. Risk: excessive throttling restores stability but misses the speed target.
   Mitigation: retain overlap and tune outer/inner concurrency from measured
   phase timing instead of serializing whole branches.
3. Risk: app builds and package coverage mutate shared outputs concurrently.
   Mitigation: retain the existing prepared-artifact boundary and artifact lock;
   overlap only read-only/prepared consumers.

## Tasks

1. Capture current scheduling and timing evidence for local and Crabbox lanes.
2. Add a composed worker-budget policy and focused orchestration tests.
3. Run focused verification and inspect the complete diff.
4. Run local full acceptance, tune if needed, and prove the 3x threshold.
5. Run repeated fresh Crabbox acceptance samples and tune for stability.
6. Complete required coverage and cross-cutting review gates, close the plan,
   commit, push, and open the PR.

## Decisions

- Treat the 16-vCPU machine as sufficient until a composed budget still cannot
  meet the target; current evidence shows oversubscription rather than an
  undersized provider.
- Do not raise test timeouts to hide contention.

## Verification

- `pnpm test:diff scripts/workspace-verify.sh scripts/workspace-verify.test.ts config/vitest-parallelism.ts apps/web/scripts/verify-fast.sh apps/cloudflare/scripts/verify-fast.sh`
- `/usr/bin/time -p env MURPH_VERIFY_EXECUTOR=local pnpm verify:acceptance`
- `/usr/bin/time -p env MURPH_VERIFY_EXECUTOR=crabbox pnpm verify:acceptance`
- Expected: focused checks pass, local wall time is at most 3m58s, and at least
  two fresh exact-head Crabbox runs pass with no timeout failures.

## Results

- Canonical local acceptance passed in 235.43s, down from the measured 715.28s
  baseline: 3.04x faster while preserving the full acceptance surface.
- Fresh standard 16-vCPU Blacksmith Testboxes passed twice. The verifier took
  222s and 224s; provider command times were 261.696s and 263.658s, and full
  one-shot times were 263.426s and 265.410s. Provider evidence: Actions runs
  [29804032394](https://github.com/cobuildwithus/murph/actions/runs/29804032394)
  and
  [29804254685](https://github.com/cobuildwithus/murph/actions/runs/29804254685).
- The remote verifier itself matched or beat local. Crabbox was 1.12x slower
  end-to-end because fresh-machine allocation, checkout, targeted sync,
  dependency install, and teardown added roughly 40s per one-shot run.
- The stable capable-host profile uses four CLI workers, one concurrent
  two-worker package peer during the protected CLI phase, five two-worker
  package processes after CLI, and two workers per overlapping app pool. This
  caps the scheduled Vitest demand below the 16-vCPU host budget.
- A load-sensitive warm-process test helper now waits for its queued lock
  cleanup in bounded fake time, preventing a primary timeout and its cascading
  next-test failure without serializing Assistant Engine. The scoped diff lane
  also gives Assistant Engine its already-proven 6 GiB heap ceiling.
- Focused shell/repo-tool checks, the 408-test repo-tool suite, the full scoped
  `pnpm test:diff` lane, local acceptance, and both fresh Crabbox runs passed.
Completed: 2026-07-21
Completed: 2026-07-21
