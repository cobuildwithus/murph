# Hosted container readiness telemetry

Status: active
Updated: 2026-08-29

## Goal

Partition the currently opaque hosted cold-container readiness interval without
changing admission, startup, health, retry, or cleanup behavior.

Success means:

- a fresh direct start records adjacent milestones for lifecycle-lock wait,
  platform state read, start issue, the Cloudflare `onStart` hook,
  `startAndWaitForPorts` completion, and the explicit health check;
- the container health response reports process-start and TCP-listen timestamps
  so Node startup is visible before the first invocation reaches the runtime;
- warm reuse and shell prewarm remain behaviorally unchanged and optional
  telemetry tolerates mixed old/new containers during rollout;
- no member content, identifier, request body, path, credential, or new remote
  request is added; and
- focused tests, owner typechecks, exact-head CI, and ReviewGPT pass.

## Evidence

- The production trace records 6.104 seconds from fresh-start fence binding to
  container readiness.
- The first invocation later reports 1.211 seconds of Node startup, leaving
  4.893 seconds inside the Cloudflare lifecycle interval without a persisted
  subdivision.
- Existing durable diagnostics stop at `freshStartFenceBoundAtEpochMs` and
  resume at `freshStartContainerReadyAtEpochMs`.
- Dedicated runtime logs begin after container readiness and contain no
  platform-container lifecycle events.
- Cloudflare's API exposes `onStart`, `getState`, `startAndWaitForPorts`, and
  health fetch completion, but does not provide an internal scheduler/image/
  port-poll timing breakdown.

## Implementation

1. Return an optional, numeric-only cold-start readiness observation from the
   existing RunnerContainer readiness RPC.
2. Capture the readiness request, lifecycle-lock acquisition, state-read
   completion, start issue, `onStart`, start-and-port wait completion, health
   check boundaries, and final ready observation.
3. Add process-start and TCP-listen timestamps to the existing private health
   response and parse them as optional non-negative integers.
4. Merge the observation into the existing orchestration phase breakdown and
   extend the strict shared parser/key registry.
5. Extend the operational latency report and runtime protocol documentation so
   the next trace can be interpreted without manual subtraction.
6. Add focused cold-start ordering, mixed-version, propagation, and strict
   parser coverage.

## Invariants

- Telemetry is additive, best-effort, numeric-only, and introduces no new I/O.
- Readiness still requires the same platform port wait and health validation.
- Deadlines, lifecycle-lock ownership, write-fence behavior, retries, and
  fail-closed cleanup remain unchanged.
- Warm reuse does not claim cold-start milestones.
- A missing `onStart` or old-container health field is omitted rather than
  synthesized.

## Verification

- Run focused Cloudflare RunnerContainer, container entrypoint, UserRunner
  processing-controller, Hosted Execution parser, Web latency-store, and report
  tests.
- Run typechecks for every touched owner and narrow reverse dependents.
- Inspect the final diff for private identifiers, paths, credentials, protocol
  drift, and startup-path work.
- Run exact-head CI and the final ReviewGPT gate, resolving every accepted
  finding before merge.

## Deployment

Deploy the Web/shared strict reader first, then deploy the Cloudflare Worker and
runner bundle through the protected production workflow. The new Worker accepts
old warm containers whose health response omits process timestamps, and the old
Web release never receives unknown fields. Use the currently required immediate
container rollout and require managed-container smoke to prove the new bundle
fingerprint. Roll back the Worker writer first; the additive Web reader may
remain deployed.
