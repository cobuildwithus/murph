# Container CPU follow-up and latency regression proof

## Outcome and constraints

Find further measured, behavior-preserving CPU improvements and protect three
important paths in one-vCPU Docker CI: full runner hydration, bulk import, and
incremental import into existing history. Reuse the existing runner-bundle CI
owner and synthetic core benchmark. Prefer deletion and direct changes at the
current owner; add no dependencies, persistent state, or orchestration layers.

Mailbox, scheduling, admission, wake behavior, production sizing, merge, and
deployment are excluded. Production stays at two vCPUs. Local emulated Docker
measurements are relative evidence, not production latency guarantees.

## Ownership and plan

The parent owns the existing task branch and PR #2836. Its prior review wake
watcher was stopped before resuming edits; the PR is draft during development.
The user requested parallel investigation. Three agents investigated import
hotspots, bootstrap loading, and CI design. The parent then authorized strictly
separate CI-tooling and audio-loader edits; the parent owns core changes and
integration. All subagents have finished.

1. Inspect remaining CPU profiles and production code paths; reproduce each
   proposed optimization before selecting the smallest maintainable change.
2. Add a bounded, secret-free Docker regression command using identical
   synthetic harnesses for base and candidate on the same one-vCPU quota.
3. Wire it into the existing required native-AMD64 runner-bundle job; test the
   guard itself with passing and deliberately regressed measurements.
4. Run focused correctness tests, typechecks, real Docker proof, and parent
   complexity/privacy review. Record rejected experiments and limits honestly.
5. Commit through finish-task, update the PR, and run exact-head CI and the
   applicable full-patch ReviewGPT gate concurrently. Do not merge or deploy.

## Evidence and decisions

- The previous timezone-normalization result remains in the PR; its immutable
  completed plan is historical evidence, not current execution instructions.
- The prior reviewer reported no code findings, but capture failed its model
  identity check. It is diagnostic evidence, not an accepted final review.
- Graft is unavailable in this environment; use scoped source discovery.
- Frog entries inspected; no new qualifying repository friction identified.
- Internal-only performance/proof work: no product behavior, prompt, sync
  cadence, provider input, or public changelog change is intended.
- Reuse the read-only event-identity baseline; retain copies at the two actual
  reconciliation mutation boundaries. Skip unused no-session cache preparation.
  Historical content matching now hashes only references with historical owners
  and has one small local calculation helper. Existing invalidation remains.
- Move the generated audio SDK into the existing validated request function,
  before its provider timeout. The first audio request still pays load cost;
  ordinary configuration and non-audio hydration do not.
- Reuse the required native-AMD64 bundle CI job and production Dockerfile.
  Three alternating samples guard hydration, bulk import, and incremental
  import, including CPU/wall medians plus real canonical semantic assertions.
  Relative budgets intentionally do not prevent gradual subthreshold drift.
- The initial follow-up import comparison improved median CPU; the later final
  packaged run passed all budgets but did not reproduce those import gains.
  Hydration median wall time was 6.02 s to 4.75 s in that later run. Emulation
  and shared-host variation preclude a strict production speed claim.
- Focused core proof: 240 tests; importers: 258 tests; audio SDK: 17 tests.
  Core/contracts/operator-config typechecks, full production runner assembly,
  provider boundary guard, and 20 Node CI/policy tests passed. Docs drift and
  gardening passed. Complexity debt in the core owner decreased by six.
- The first packaged probe exposed an overly tight separate health-request
  timeout. The probe now uses its existing overall hydration deadline; no
  production timeout changed. Runtime shutdown logs remain enabled and are
  excluded from benchmark rows without waiving required measurements.
- The Docker negative control injected five seconds of actual CPU work into
  only the candidate incremental import, with three fresh-container samples.
  Semantics stayed equal and the guard correctly rejected both CPU and wall
  growth (CPU 5.98 s against a 1.12 s allowance). The injection is ignored
  diagnostic tooling, not committed benchmark or production behavior.
- Parent review: the same canonical owners and mutation copies remain; no new
  dependency, persistent cache, external call, orchestration owner, or provider
  input was added. New tooling stays within the existing required CI job.
  Changed-file privacy scan passed. No public changelog entry is appropriate
  for this internal optimization and regression-proof work.

## Progress

- [x] Reconfirm exact PR head, clean worktree, and exclusive task ownership.
- [x] Start non-overlapping read-only investigations requested by the user.
- [x] Select and reproduce additional low-complexity optimizations.
- [x] Implement and exercise the one-vCPU CI regression guard.
- [x] Complete focused proof and parent candidate review.
- [ ] Scoped commit and exact-head PR gates (the prior model-mismatched review
  is not an accepted final gate; preserve that evidence when resolving review).
Status: completed
Updated: 2026-09-04
Completed: 2026-09-04
