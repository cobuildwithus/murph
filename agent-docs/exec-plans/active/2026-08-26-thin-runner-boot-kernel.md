# Thin hosted-runner boot kernel

Status: active
Created: 2026-08-26
Updated: 2026-08-28

## Goal

- Reduce true Cloudflare container cold readiness by removing the full workspace
  executor, hosted invocation/drain graph, and deploy-smoke graph from Node's
  pre-listen static module closure.
- Preserve truthful admission: an accepted workspace invocation must begin its
  existing restore and provider path without moving the same hydration delay to
  a later request-only wait.
- Add a fixed startup byte/chunk budget so the small boot closure cannot regress
  silently.

## Protected invariants

- Identity, runtime architecture version, fencing inputs, bounded request
  parsing, one-job admission, health reporting, and process-fatal telemetry stay
  available before a workspace job is admitted.
- The existing workspace lease, checkpoint, abort, runtime-wake, shutdown,
  provider, delivery-drain, and recovery owners remain authoritative.
- Earlier listening is not success by itself. Focused proof must cover hydration
  once-per-process behavior and the accepted-job path through provider-start
  ownership, with no new queue or persisted state.

## Evidence

- `apps/cloudflare/src/container-entrypoint.ts` statically imports the direct
  workspace invocation, hosted drain helpers, Codex lifecycle helpers, and
  smoke-only code before `server.listen()`.
- The production bundle budget records a current static boot closure baseline
  of 8,571,156 bytes. Existing historical splits kept selected connectors lazy
  but did not isolate the entrypoint's complete heavy runtime graph.
- The bundle builder already owns esbuild metafile traversal and byte gates, so
  the new byte/chunk ratchet should extend that owner rather than add a second
  analyzer.

## Scope

- In scope: the container entrypoint/runtime dependency boundary, the smallest
  assistant-runtime phase seam needed for concurrent restore and hydration,
  focused lifecycle/concurrency tests, runner-bundle byte/chunk gates, and the
  matching durable architecture/verification documentation.
- Out of scope: V8 snapshots, OCI layer changes, Cloudflare rollout generation,
  Temporal changes, idle-TTL changes, Vercel migration, production deployment,
  and unrelated bundle pruning.

## Risks and mitigations

1. Earlier health could hide unchanged provider latency.
   Mitigation: preserve one accepted invocation owner and prove hydration starts
   eagerly after listen and overlaps the existing restore phase instead of
   beginning only when restore completes.
2. Lazy drain or lifecycle code could be unavailable during fatal shutdown.
   Mitigation: keep the fatal reporter in the boot kernel, start one cached
   hydration promise immediately after listen, and give shutdown/fatal paths a
   bounded best-effort fallback without accepting unsafe work.
3. A split could weaken fencing or permit concurrent jobs.
   Mitigation: keep parsing, architecture-version validation, identity reads,
   and the single-job slot in the boot kernel; retain existing job/abort/wake
   tests and add explicit hydration rejection/concurrency proof.
4. A broad refactor could create a second runtime owner.
   Mitigation: prefer dynamic-import boundaries and a narrow prepare/execute seam
   in the existing owners; add no new service, queue, durable state, or retry
   loop.

## Tasks

1. Capture the current bundle closure and map imports needed before listen,
   during restore, and only during execution/smoke/shutdown.
2. Use the requested ReviewGPT implementation handoff to produce the smallest
   patch satisfying the owner and invariants above; inspect and integrate it.
3. Add focused tests plus exact byte/chunk startup budgets, then run runner
   bundle assembly, affected Vitest suites, and affected typechecks.
4. Commit and push the exact candidate, run required preliminary and final
   ReviewGPT gates with CI, disposition any findings, and finish the plan.
5. Open a draft PR during iteration and mark it ready only after exact-head
   proof, ReviewGPT, and required CI are complete.

## Deployment concerns

- The public runner bundle and private `murph-cloud` materialization must remain
  compatible. This PR will not deploy; its final PR evidence must state the safe
  rollout order, rollback floor, and hosted-local/live smoke checks required of
  a later deployment.

## Progress

- ReviewGPT authored the heavy-runtime extraction and the package-owned,
  one-shot workspace-restore preparation seam. Parent integration kept the
  preparation bound to the exact request and vault root, then added the narrow
  Cloudflare restore-platform adapter.
- Exact production assembly now measures a 64,257-byte entry and a
  1,950,662-byte static boot closure across 22 chunks, down from the recorded
  8,571,156-byte / 49-chunk baseline. The bundle gate now caps both startup
  bytes and chunk count.
- Exact preemption no longer waits for heavy hydration or tears down the warm
  app/container. The old invocation uses its existing abort signal, retains the
  single-job slot only until its workspace restore settles, and then lets the
  replacement reuse the same process-scoped hydration promise.
- After the preemption fix, exact production assembly measures a 66,029-byte
  entry and a 1,952,434-byte static boot closure across the same 22 chunks. The
  586-byte total-output increase remains within the fixed startup budgets.
- Focused assistant-runtime and Cloudflare entrypoint/abort/restore tests,
  all 2,706 Cloudflare tests, affected typechecks, package builds, bundle-gate
  tests, and exact production runner assembly pass. Final exact-head ReviewGPT
  and CI remain pending.
