# Hosted-local E2E exit-137 container flake: root cause + docker forensics

## Problem

Hosted-local E2E CI lanes flaked four times on 2026-06-11 with hosted runner
containers dying at exit code 137 (SIGKILL). An old note blamed "OOM at cold
start"; that was unverified. Evidence (CI jobs 80876196374, 80890585563,
80879600241) shows three distinct shapes that all log a 137 signature.

## Evidence and proven causes

### Shape A — benign: every local `destroy()` is a docker force-remove SIGKILL

`ctx.container.destroy()` in wrangler local dev is implemented by workerd's
docker client (`workerd 1.20260507.1`, `src/workerd/server/container-client.c++`)
as `DELETE /containers/<name>?force=true` (`removeContainer`, line 609-630;
`destroy`, line 2345-2360). Docker force-remove sends SIGKILL immediately — no
SIGTERM, no grace period. Local repro: `docker events` shows `kill 9` → `die
137` ~135ms after the DELETE on a healthy container whose SIGTERM trap never
fires. This matches every CI `requested-nonzero-stop`/`exitCode:137` warning
(destroy→onStop latencies 69–132ms across all three jobs). These warnings are
expected local-dev semantics, not OOM and not slow entrypoint shutdown. The
"SIGTERM grace escalation" hypothesis is disproven for local dev: SIGTERM is
never sent, so `container-entrypoint.ts` shutdown handling is never exercised
by destroy.

### Shape B — test-killing: runner image tag removed by wrangler dev (job 80890585563)

Both container classes (`RunnerContainer`, `DeploySmokeRunnerContainer`) build
from the same Dockerfile/context/build-args, so both builds produce one Docker
image ID with two `cloudflare-dev/*` tags (CI logs show identical
`writing image sha256:…` for both builds). wrangler 4.90.0's
`cleanupDuplicateImageTags` (containers-shared `utils.ts`; runs after each
image build in `prepareContainerImagesForDev`) executes `docker rmi` on every
other `cloudflare-dev*` tag pointing at the same image ID — untagging
`cloudflare-dev/runnercontainer:<tag>` right after the deploy-smoke build.
The next runner cold start then fails in workerd `createContainer` with
"No such image available named cloudflare-dev/runnercontainer:150ccde4"
(`container-client.c++:1744`), the floating `container.start()` rejection logs
as an uncaught error, the monitor guard rejects "Container failed to start"
(`container-client.c++:2328`), and every wake retries with
`container_rpc_error` for ~2 minutes until "Timed out waiting for hosted
runtime processing to be accepted after retry_later".

Deterministic local repro: two identical builds share an image ID with
unprefixed `RepoTags`; `docker rmi <runner tag>` untags it; container create
returns 404 "No such image". Why some runs survive (jobs 1/3 ran runner
containers fine after the same dual build) is not fully explained — the new
docker-events forensics records `tag`/`untag`/`delete` image events with
timestamps so the next occurrence settles it. Upstream bug candidate worth
reporting to wrangler: `cleanupDuplicateImageTags` assumes same-ID tags are
stale duplicates, which is false when sibling container classes share a
Dockerfile.

### Shape C — test-killing: SIGKILL lands on a freshly recreated same-name container (jobs 80876196374, 80879600241)

Identical fingerprint in both jobs: a warm invocation fails → DO requests a
fail-closed destroy → `destroyIfRunning` races `this.destroy()` against the
onStop settle poll and the settle wins in 88–132ms (`settleReason: "onStop"`),
abandoning the native destroy RPC mid-flight
(`apps/cloudflare/src/runner-container.ts:1255-1295`) → the DO immediately
cold-starts a NEW docker container under the SAME deterministic per-DO name →
748–857ms into readiness polling the new container dies with monitor rejection
"Container exited with unexpected exit code: 137", with no destroy requested by
the DO (no `destroy-requested` log between the cold start and the kill).

The kill is a docker-level SIGKILL. The only SIGKILL issuers are force-removes
keyed by the deterministic container NAME, and workerd has three unguarded
stale-removal paths at the pinned version: (1) the abandoned/cancelled destroy
RPC whose daemon-side DELETE proceeds after cancellation, (2)
`KJ_DEFER … waitUntilTasks.add(destroyContainer())` fired when a start RPC
fails or is cancelled (`container-client.c++:2259`), and (3) the
`~ContainerClient` destructor cleanup (`container-client.c++:974`) whose
pending promise a successor client may cancel without cancelling the
daemon-side operation. Docker resolves the name at DELETE-handling time, so a
delayed force-remove kills whichever container currently owns the name — the
new one. Host-OOM is implausible on the evidence: kills land only on
fresh containers ~800ms after a destroy of the same name while much larger
processes survive, and workerd sets no container memory limit (no cgroup OOM
possible; `HostConfig` carries only `RestartPolicy: on-failure`).

Not yet proven: which of the three stale-removal paths fired. The docker-events
forensics (container `kill` events carry the signal, `die` events carry the
exit code, `oom` events flag cgroup OOM, all with container IDs) makes the next
occurrence attributable from CI logs alone and definitively kills or confirms
the OOM hypothesis.

## Changes

- `packages/hosted-local-harness/src/dev-hosted-local/runtime.ts`: new
  `spawnHostedLocalDockerEventsForensics` — streams
  `docker events --format {{json .}}` filtered to container/image lifecycle
  actions (create/start/kill/die/stop/destroy/oom/tag/untag/delete) through the
  existing redacted child-log piping under the `docker-events` prefix.
- `packages/hosted-local-harness/src/dev-hosted-local/stack.ts`: spawns the
  forensics child before wrangler dev (so image builds and tag cleanup are
  captured), keeps it out of the fail-fast `children` set, terminates it in
  `kill`/`stop`/startup-failure paths, and includes it in failure-report tails.
- `packages/hosted-local-harness/src/dev-hosted-local/types.ts`: adds the
  `docker-events` child process name.
- `Dockerfile.cloudflare-hosted-runner` +
  `packages/hosted-local-harness/src/dev-hosted-local/environment.ts`: per-class
  `HOSTED_RUNNER_CONTAINER_CLASS` build arg feeding a label, so the two class
  images can never share a Docker image ID in local dev — making wrangler's
  duplicate-tag `docker rmi` a no-op (fixes shape B). Verified locally:
  identical builds differing only in this build arg produce distinct image IDs
  and disjoint `RepoTags`.

## Handoff to the hosted-runner-destroy-timeout lane (owns `runner-container.ts`)

Shape C's durable correction belongs to that lane's in-flight work on bounding
destroys: `destroyIfRunning` must not let the cold-start path proceed on
`settleReason: "onStop"` alone while the native `this.destroy()` RPC is still
pending — onStop only proves the old process exited, not that the
name-keyed docker force-remove has finished (or was safely cancelled). Either
await the retained `destroyRequest` promise (bounded) before any
`startAndWaitForPorts` on the same DO, or treat an unsettled destroy as
`warmShellInvalidatedByUnsettledDestroy` and refuse the immediate same-name
restart. Their existing plan step "destroy requests are bounded before the
settle poll" covers the right surface.

## Verification

- Mechanism repros (local docker): force-remove SIGKILL semantics
  (`kill 9`/`die 137`, ~135ms, SIGTERM trap untriggered); duplicate-tag
  untag → create 404 "No such image"; per-class build arg → distinct image IDs.
- `pnpm --dir packages/hosted-local-harness exec vitest run
  test/dev-hosted-local/stack.test.ts test/dev-hosted-local/environment.test.ts`
  — 123/123 pass (includes new per-class image_vars assertions).
- `pnpm test:diff` over the changed files.

## State

Completed in PR #137. Shape B is fixed here; Shape C is handed off to the hosted-runner destroy-timeout lane (see handoff section).
