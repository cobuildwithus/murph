# Hosted rollout startup convergence

## Goal

Let a valid Cloudflare container cold start outlive a shorter runtime-control
caller without weakening cleanup for genuinely unhealthy containers.

Success criteria:

- The ordinary caller exposes the existing 15-second readiness window.
- Container startup remains bounded by the existing 20-second owner window.
- A caller timeout does not destroy a recent, never-ready start.
- A later readiness check can join the same start.
- Fatal, stale, stopped, poisoned, architecture-mismatched, and
  previously-ready unhealthy containers retain bounded cleanup.
- Cleanup captured for an old start cannot invalidate a newer replacement.
- Focused tests, typecheck, exact-head CI, and ReviewGPT pass.

## Constraints

- Do not deploy, mutate production state, merge, or activate remediation.
- Keep retry responses and fail-closed behavior bounded.
- Add no durable lifecycle state, queue, or second lifecycle owner.
- Keep production evidence aggregate and free of member identifiers.

## Product UX

This is a Product UX Patch. A hosted user whose runner takes slightly longer
than a caller budget should see one cold start converge, not a destroy/restart
loop. A genuinely bad shell must still be recycled promptly.

## Corrected production model

The original diagnosis was wrong: the runner did not spend roughly one minute
starting. In five comparable cases, the readiness caller stopped waiting at
eight seconds, destroy was requested, and the lifecycle stop callback arrived
at 60.04–60.10 seconds. Replacement starts became healthy in 3.8–6.4 seconds.
Across seven days, successful cold starts had a 4.86-second median, 7.08-second
p95, 7.77-second p99, and 9.0-second maximum.

The two relevant clocks are therefore:

1. Runtime-control caller: 15 seconds of readiness within a 20-second default
   command budget.
2. Container owner: 20 seconds for a recent, never-ready platform start.

The 60-second observation belongs to delayed destroy/lifecycle reconciliation,
not application startup. A 90-second readiness default is unsupported.

## Approach

1. Restore the canonical container readiness default to 20 seconds.
2. Raise the shared default runtime-processing command budget from 10 to 20
   seconds so ordinary calls reach the existing 15-second readiness cap rather
   than arriving there with roughly eight seconds remaining.
3. Represent the current start as one in-memory record owned by the existing
   `RunnerContainer` lifecycle lock. Health proof, pending deadline, stop, and
   cleanup all bind to that record.
4. On caller timeout or non-fatal startup transport failure, retain only the
   same recent start that has never passed readiness. Rejoin it on the next
   check. Recycle it after the 20-second owner window or on explicit fatal or
   previously-ready failure.
5. Let the first real `onStart` hook adopt the provisional start record and
   let later hooks publish replacements. Treat a newer platform `lastChange`
   without a matching hook as ambiguous rather than manufacturing a second
   identity or authorizing destructive cleanup.

## Review retrospective

The immutable first-reviewed head changed 419 lines across nine files. The
latest published head changed 1,316 lines across eleven files because review
iterations hardened generation ownership while the working premise still
treated the 60-second callback as startup duration.

That premise is now invalidated. The corrective decision is:

- remove the 90-second configuration and all 58-second startup claims;
- keep the single current-start identity because it is the smallest boundary
  that prevents stale health, stop, or destroy completions from acting on a
  replacement;
- use the already-existing 15-second readiness cap and 20-second container
  window rather than adding a new timeout layer;
- prove the observed 8-to-9-second case directly, with delayed destroy
  settlement covered as a separate lifecycle race.

## Evidence

- Cloudflare documents `running` as a container that may still be starting and
  not yet health checked, and `lastChange` as the state-change timestamp.
- Cloudflare documents `destroy()` as immediate `SIGKILL` whose promise resolves
  after runtime destruction and whose completion triggers `onStop`.
- The pinned SDK issues `container.start()` before its abortable readiness wait;
  aborting the wait does not prove that the platform start failed.
- The focused regression reaches the caller boundary at eight seconds, then
  observes the same start healthy at nine seconds with one start and no destroy.
- Replacement-order regressions keep stale health and old destroy settlement
  bound to the captured start rather than a newer platform start.
- Round 5 found that status-read and destroy failures could still let cleanup
  for an old start set the container-wide unsettled-cleanup flag after a
  replacement started. Cleanup now revalidates the captured start record after
  each asynchronous boundary, and publishing a replacement clears invalidation
  owned by the old record.
- Focused regressions cover stale status-read rejection, stale destroy
  rejection, and unsettled cleanup completing before the replacement `onStart`.
- Round 6 found that the pending window ended after port readiness but before
  health readiness, and that `lastChange` is a state timestamp rather than a
  process identity. The correction keeps the same record pending through
  health, adopts the first lifecycle hook into that record, and returns
  unsettled when platform state is newer but ownership is ambiguous.
- The eight-to-nine-second regression now times out during health after the
  port is ready, proves the first `onStart` retains object identity, retries
  without destroy, and then proves a later warm-health failure still recycles
  that same anchored record.
- A stale never-ready start older than 20 seconds still enters bounded cleanup.

## State

Active. ReviewGPT round 6 returned one material startup-ownership finding, and
its smallest single-record correction is implemented. Current `main` merged
cleanly without manual conflict resolution. The merge exposed one synthetic
preemption fixture that changed `lastChange` on every read and omitted the real
`onStart` hook; the fixture now uses one stable platform timestamp and the
existing lifecycle callback, with no production-code expansion. The merged
head passes 423 focused Cloudflare tests, 550 hosted-execution tests, 31 focused
Web orchestration tests, and the Cloudflare and hosted-execution typechecks.
Exact-head CI and substantive ReviewGPT round 7 remain. The PR remains draft
and no production action is authorized.

## Working Set

- `packages/hosted-execution/src/contracts.ts`
- `packages/hosted-execution/test/temporal-env.test.ts`
- `apps/cloudflare/src/runner-container.ts`
- `apps/cloudflare/src/hosted-execution-worker-env.ts`
- `apps/cloudflare/scripts/deploy-automation/environment.ts`
- `apps/cloudflare/test/runner-container.test.ts`
- `apps/cloudflare/test/user-runner-alarm.test.ts`
- `apps/cloudflare/test/env.test.ts`
- `apps/cloudflare/test/deploy-automation.test.ts`
- `apps/cloudflare/test/container-image-contract.test.ts`
- `apps/cloudflare/DEPLOY.md`
