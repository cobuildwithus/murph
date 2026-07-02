# Wake stopped-shell short-circuit

## Why

Production `hosted_ingress_latency_trace` (week of 2026-06-25) shows the single
largest serial block in cold-reply latency is the active-wake probe on a
stopped container shell: 3.2s p50 / 4.8s p90 on 59% of user-triggered cold
starts. `RunnerContainer.wakeRuntime` unconditionally `containerFetch`es the
container's `/internal/runtime-wake` endpoint; on a stopped shell the
`@cloudflare/containers` base class boots the container inside `containerFetch`
just for the freshly booted entrypoint to answer "absent" — a just-booted
container can never host an active child, so the probe is a tautology that
costs a full container boot.

## User-visible goal

Cold replies (user messages Murph while their container is stopped) reach the
provider ~1.3-1.5s sooner at p50, more at p90. No behavior change on warm
wakes or ambiguous shells.

## Change

In `apps/cloudflare/src/runner-container.ts`, `wakeRuntime`: when there is no
in-memory `workspaceInvocationActiveOperation` AND the platform container
handle reports the container is not running, return
`{ kind: "not-wakeable", reason: "no-active-child" }` before
`noteRunnerActivity`/`containerFetch`. Platform truth (`ctx.container.running
=== false`) means no container process exists, so no child can exist; this is
the same stopped-shell-as-inactive-proof standard PR #344 (f5557068d5) added to
`readActiveRuntimeUserFence` and that
`agent-docs/references/hosted-runtime-protocol.md` codifies as "Inactive
liveness is explicit no-active-child proof."

Add one sentence to the protocol doc's wake-path section recording that a
verifiably stopped shell (platform running=false) is explicit no-active-child
proof for the wake probe.

## Invariants to preserve

- Fail-safe direction only: any ambiguity (running, healthy, stopping,
  unknown/null, in-memory active op present, platform handle unavailable)
  keeps today's `containerFetch` probe path unchanged.
- No changes to fence mutation paths, preserved-after-transport-failure
  handling, retention/preemption paths, `ensureReadyForProcessing`, timeouts,
  or the legacy wake fallback in `runtime-container-wake.ts`.
- No new persisted state, config, env vars, or log keys. No `as any` /
  lazy `as unknown` casts.
- Verify-before-clear stays intact: fence replacement remains identity-matched
  and owned by the wake path; this change only makes the existing
  "no active child" verdict fast on shells that are provably stopped.

## Verification

- Focused `apps/cloudflare` tests for `wakeRuntime` (stopped shell + no active
  op short-circuits without `containerFetch`; running shell still probes;
  in-memory active-op behavior unchanged) plus the existing runner-container
  suite and typecheck.

## Status

Adversarially reviewed pre-implementation (codex gpt-5.5 xhigh, read-only):
SAFE, no counterexample; sharp edge noted is tail-only (boot >8s now hits the
fresh-start confirm timeout and retries cleanly).
Status: completed
Updated: 2026-07-02
Completed: 2026-07-02
