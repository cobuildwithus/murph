# Codex warm cold-start latency

Status: completed
Created: 2026-07-29
Updated: 2026-07-29

## Goal

- Land a clean process-only Codex initialization overlap before the separate R2
  ENAM migration, using the existing assistant-engine process owner rather than
  adding another lifecycle system.
- Preserve every foreground reply, process-ownership, snapshot, provider-auth,
  abort, replacement, and rolling-deploy invariant.
- Keep the existing 20-minute conversation warm lease unchanged.

## Success criteria

- ReviewGPT inspects the current repository and recommends the implementation
  boundary and patch shape before code changes begin.
- `packages/assistant-engine` remains the only resident App Server process
  owner. The exact process owns one memoized spawn-and-initialize readiness
  promise that is distinct from foreground turn reservation.
- The existing engine-owned warm-slot transition lock covers only inspect,
  exact teardown, publication or reservation, and workspace-boundary
  admission. Initialization readiness runs outside it, preserving the overlap
  while one owner-local boundary-admission state makes speculative preparation
  decline and warm foreground/account acquisition fail busy for the full
  boundary call. A caller that already obtained a slot-transition ticket keeps
  FIFO priority.
- After restore and final Codex config/auth preparation, eligible foreground
  runtime work may begin process-only initialization while independent mailbox
  preparation continues. The foreground turn synchronously reserves the exact
  process, then joins the same readiness promise.
- No speculative initialization can create a thread, turn, provider request,
  account operation, dynamic tool, compaction, or detached child.
- Cancellation and replacement cannot leave a pending startup RPC, stale warm
  owner, orphan process, or checkpoint race. Failure is a missed optimization
  and accepted foreground work remains eligible for ordinary fresh startup.
- Invocation release cancels through a handle bound to the exact admitted
  process, so a stale invocation cannot tear down a later replacement.
- A checkpoint cancels and awaits exact teardown of unreserved initialization
  that is still pending; ready idle and reserved/running processes continue to
  follow their existing checkpoint contracts.
- Focused lifecycle tests, canonical verification, completion review, CI, and
  production rollout proof pass.

## Constraints

- Do not overlap Codex startup with snapshot restore or final `CODEX_HOME`
  config/auth preparation.
- Keep signed provider authority scoped to an accepted invocation and the
  current user/runner write fence.
- Add no scheduler, queue, new persisted state owner, broad flag system, or
  keepalive ping loop. Do not add a second warm-slot state machine; derive
  readiness from the exact process object and reuse the existing narrow slot
  transition lock rather than adding another lifecycle owner.
- Keep the ENAM migration independent and avoid editing its bucket-migration
  surfaces.
- Avoid reorganizing `RunnerContainer` destroy internals owned by the existing
  destroy-timeout lane.

## Tasks

1. Audit the current 20-minute conversation warm lease, cold recurrence, and
   resident Codex lifecycle.
2. Obtain and verify ReviewGPT's implementation recommendation against the
   single-owner architecture and investigation findings.
3. Implement the process-owned readiness change with focused race and lifecycle
   coverage plus current durable documentation.
4. Run canonical verification and direct hosted lifecycle proof.
5. Complete preliminary specialist review, parent final review, final
   ReviewGPT, CI, mergeability, merge, worktree retirement, and production
   rollout verification.

## Current evidence

- The current assistant-engine helper couples process creation and turn
  reservation. Starting it speculatively would reserve work that no turn owns;
  the durable correction is to make initialization a memoized property of the
  existing process object and keep reservation foreground-owned.
- The hosted restore path completes snapshot materialization and final managed
  Codex config/auth preparation before independent initial mailbox preparation,
  providing a bounded overlap seam without exposing a half-restored Codex home.
- Existing process shutdown can otherwise leave initialization RPCs pending;
  every stop path must reject pending RPCs before the exact process is cleared.
- Exact-process handles alone do not serialize a caller already awaiting old
  process teardown against a workspace checkpoint. The existing slot-transition
  lock must cover teardown through publication and the checkpoint decision, but
  must not cover the process-owned initialization wait. The owner must also
  reject new resident admission for the full boundary call; otherwise a caller
  queued while pending teardown holds the lock can publish before the boundary
  caller resumes.
- Deterministic reverse-order tests reproduced that boundary-first gap before
  the admission fence: speculative replacement published a new process and
  foreground replacement completed a turn. The same tests now prove both are
  rejected while earlier slot tickets keep FIFO priority.
- App Server initialization is measured work worth attempting to overlap, but
  this plan promises no fixed end-to-end saving. Rollout evidence must measure
  readiness reuse, exposed foreground wait, failure/fallback, and reply
  completion without content or identity telemetry.
- Production already uses a 20-minute post-conversation warm lease. Extending
  that lease would retain each container's provisioned memory and disk longer,
  so this change leaves the lease and Cloudflare capacity posture unchanged.
- The preliminary specialist ReviewGPT pass found one missing fail-open
  regression case for preparation rejection before admission. That focused
  coverage was added and proves the accepted foreground input still reaches the
  ordinary assistant phase without an invented cancellation owner.
- Independent product and workspace-boundary reviews passed after the final
  reverse-order race remediation. They rechecked launch-identity convergence,
  synchronous foreground claim, the single pre-provider fallback, exact abort
  and release cleanup, FIFO ticket order, ready-idle preservation, managed
  account exclusion, and accepted-reply completion.
- Canonical remote acceptance passed in 5 minutes 23 seconds on the frozen
  candidate with every workspace typecheck, build, package coverage lane, Web
  verification, Cloudflare verification, and the full affected Codex/runtime
  suites green. A later clean rebase onto current `main` changed only base
  history; both affected package typechecks passed again. Local umbrella
  verification separately encountered the shared host's runtime-artifact lock,
  while the isolated acceptance runner built that same artifact successfully.
- The parent final review found and removed one unrelated 120-second test
  timeout relaxation. The resulting patch has no second process owner, new
  infrastructure, persisted state, keepalive, warm-lease change, ENAM
  dependency, or direct-identifier leakage.
- A local production-shaped direct scenario used the installed Codex binary
  with isolated empty workspace and Codex-home directories plus a child
  environment narrowed to those paths and `PATH`. On the final candidate,
  process-only initialization became ready in 330 ms, crossed the real
  lifecycle boundary, and shut down without creating a thread, turn, tool, or
  provider request.

## Deployment concerns

- Merge and verify this change before the independent ENAM rollout changes the
  R2 baseline.
- Use the existing Cloudflare version/deployment path and rollback mechanism;
  do not make the ENAM deploy responsible for activating this change.
Completed: 2026-07-29
