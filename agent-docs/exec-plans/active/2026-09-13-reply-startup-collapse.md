# Simplify the foreground startup path

Status: active
Created: 2026-09-13
Updated: 2026-09-13

## Goal

- Reduce foreground startup time by deleting unnecessary work and collapsing
  redundant calls. Aim for a measurable one-to-two-second improvement without
  another state owner, cache, configuration knob, or background service.

## Success criteria

- Prove each removal with current source and reproducible synthetic evidence.
- Preserve member authority, write fences, encrypted restore validation, canonical
  state, conversation continuity, cancellation, and durable delivery.
- Open focused PRs with tests, typecheck, complexity review, ReviewGPT, and CI.
  Distinguish measured local savings from production outcomes.

## Scope

- In scope: existing restore, initial mailbox admission, and conversation startup.
- Out of scope: production mutations, deployments, policy changes, and new owners.

## Constraints

- Web owns accepted input and authority; runtime owns ordering; Codex owns native
  continuity. Keep these owners and deployed formats. Use source and synthetic
  timing proof to justify removable work. Never persist private production data.
- Product UX: Patch. Deliver the same authorized reply sooner. Cover cold/warm
  startup, invalid/cancelled restore, direct/group continuity, and background work
  as affected. Result: Ready for the cleanup change; the end-to-end latency target remains unproven.

## Risks and mitigations

1. Restore and resume shortcuts can omit validation or canonical evidence.
   Require focused invalid-archive, cancellation, and continuity regressions at
   the changed boundary. Preserve native contracts and current state ownership.

## Tasks

1. Ask ReviewGPT for minimal source-backed patches and independent PR seams.
2. Trace waits and establish baseline operation-count/timing proof.
3. Implement validated removals or reorderings; update affected owner contracts.
4. Run focused tests, typecheck, complexity and parent product review.
5. Open draft PRs, establish Ready candidates, and run final ReviewGPT with CI.
6. Resolve findings within task authority and close the plan.

## Decisions

- Inspect work after standby allocation before adding allocation machinery.
- Keep this session as the completion owner for ReviewGPT.
- Existing extraction already connects the native decoder directly to tar, and
  ordinary native resume already excludes returned turns. Do not duplicate them.

## Verification

- Select focused commands after source inspection. Use synthetic fixtures;
  compare operation counts and elapsed time at the actual owning boundary.
- Baseline Cloudflare snapshot/local restore-preparation suites: 49 tests passed.
- Baseline assistant-runtime restore continuity and memory suites: 17 tests passed.
- ReviewGPT supplied one standalone cleanup patch. It removes the snapshot
  inventory pass from pruning, bypasses wholly disposable subtrees, and derives
  the retained-directory result from the completed walk. Keep the upstream
  resume-record sanitizer and every archive/authentication boundary unchanged.
- Patched runtime-state pruning and native-memory suites: 20 tests passed.
- Patched bundle and snapshot-interruption suites: 70 tests passed.
- Patched assistant-runtime restore continuity and memory suites: 17 tests passed.
- Runtime-state typecheck passed. Complexity guard passed: unchanged maximum 27
  and debt 7 in the archive collector; changed pruning functions remain below 20.
- The two-rollout call-count fixture eliminates ten redundant lstat calls and
  the second listing of retained directories. Retained bytes remain identical.
- A separate synthetic native-resume probe showed only millisecond-scale lookup
  differences. Do not add a path-selection interface without a measured need.
- No second equally small removal was proved. The requested one-to-two-second
  production improvement remains unestablished; final review and CI are pending.

- Changelog page rendering: 10 tests passed after generating fragments and
  running Vitest from the repository root. The documented command's discovery
  issue is already recorded in the existing friction log; no duplicate entry.
- Web typecheck passed after normal generated-input preparation.
- Local helper-only benchmarks on Node 24.14.1 used alternating base/head order,
  fresh synthetic files, and retained-content hashes. Median paired savings were
  3.7 ms for 12 rollouts (five pairs) and 167.9 ms for 2,000 rollouts (three pairs).
  Both sets contained a slower patched sample. These noisy local measurements do
  not establish a production gain or the requested one-to-two-second target.
- Draft PR #3424 contains this one coherent deletion. Final ReviewGPT and CI
  remain completion gates; production deployment remains outside scope.
