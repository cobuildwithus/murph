# Hosted Runtime Lifecycle Simplification

## Goal

Collapse hosted runtime lifecycle complexity so the warm Cloudflare container is
the normal execution boundary. Successful hosted invocations should not
normally spawn and kill a disposable Node child, and successful assistant turns
should not normally spawn and stop a fresh Codex app-server process.

The first hard-cut target is:

```text
UserRunner Durable Object
  -> warm RunnerContainer
    -> container-entrypoint active invocation slot
      -> explicit HostedInvocationScope
      -> package-owned runHostedWorkspaceInvocation(...)
      -> single-use assistant-engine Codex app-server
      -> container process cleanup proof
```

Warm Codex app-server reuse is a separate follow-on project after the per-run
Node child is deleted:

```text
warm RunnerContainer
  -> package-owned hosted runtime invocation
    -> assistant-engine single-slot hosted Codex app-server
```

The architecture to retire is:

```text
Temporal hosted workflow
  -> UserRunner Durable Object
    -> warm RunnerContainer
      -> per-invocation isolated Node child
        -> per-turn Codex app-server process
```

## Success Criteria

- One successful hosted invocation does not SIGKILL a per-run runtime process.
- Cloudflare remains a thin runner and platform adapter over the local Murph
  runtime. It leases/restores/exposes ports/calls/checkpoints; it does not own
  assistant, mailbox, checkpoint, or Codex runtime semantics.
- Consecutive invocations for the same warm container use one package-owned
  hosted invocation path, not a child/fallback matrix.
- Warm Codex cross-invocation reuse is not a success criterion for the first
  deletion cut. It becomes eligible only after per-turn/request authority
  injection exists.
- Consecutive assistant turns may reuse one hosted Codex app-server only when:
  - the process is healthy and idle
  - the process identity matches
  - no stale authority is embedded in process env/config, or embedded authority
    is part of the identity
  - no unexpected descendants remain after the prior turn
  - cross-invocation reuse is disabled until authority is injected per turn or
    per request
- Existing hosted protocol invariants remain intact:
  - one active write-fenced invocation per user runner
  - foreground conversation input has priority over background maintenance
  - runtime-owned `idle_shutdown` checkpointing remains the durable completion
    boundary
  - runtime callbacks remain authorized by the active write fence
  - unexpected subprocesses are cleaned up before warm reuse
  - secret/env projection remains allowlisted and metadata-only in diagnostics
- The default steady state has fewer lifecycle owners, not another nested
  supervisor.
- Hosted invocation code does not depend on the supervisor's ambient
  `process.env` or `process.cwd()`.
- The first deletion cut has no intentionally warm child process inside the
  runtime. Existing `/proc` cleanup remains enough.
- The later warm-Codex project may allow exactly one intentional warm Codex root
  process, with health, identity, stop, descendant-cleanup, and PID-reuse
  protection semantics.
- A warm Codex process never carries stale write-fence authority, CLI bridge
  authority, workspace identity, or config state into a later turn.
- The cut does not introduce long-lived rollout flags, compatibility services,
  or a permanent dual-path architecture. Rollback is by deploying the previous
  known-good image/version, not by carrying the old runtime stack forward.
- Milestone 1 direct invocation preserves every non-lifecycle side effect of the
  isolated runner path: browser-vault warm-source clearing, warm-root creation,
  native parser-toolchain rebinding, env projection, and redacted error
  classification.
- Milestone 1 deploy skew is handled by an architecture/version handshake and
  warm-container reset, not by request-shape compatibility branches.

## Current State

- Milestone 2 warm-Codex process ownership now stays in
  `packages/assistant-engine`: `apps/cloudflare` imports the concrete snapshot
  and stop hooks from `@murphai/assistant-engine/hosted-codex-lifecycle`, while
  the expected-root process shape lives as a neutral hosted contract in
  `@murphai/hosted-execution/runtime-control`.
- The prior review follow-up for legacy runtime-wake result compatibility,
  hosted env projection naming, and direct invocation launcher-root side-effect
  tests has landed in current code/tests. Remaining lifecycle work should be
  tracked by new concrete findings rather than that completed follow-up note.
- Current follow-up: scope accepted CLI bridge requests to the active
  invocation by draining in-flight authenticated bridge work before clearing the
  active invocation binding.
- Current follow-up: remove hosted assistant/mailbox invocation dependence on
  ambient `process.env` and `process.cwd()` by threading explicit turn env and
  working-directory values through the assistant automation and notification
  paths.

## First-Principles Corrections

Five focused review passes found that the original draft still preserved too
much lifecycle machinery. A later first-principles pass tightened this further:

- Cloudflare must stay thin. It should implement transport/platform ports and
  process cleanup, then call into package-owned local Murph runtime code.
- The removed Node child becomes a package-owned hosted invocation call, not a
  new Cloudflare runtime service or wrapper layer.
- The hard cut deletes the normal child path in the same architecture change.
  Do not keep a long-lived `node-runner` fallback or feature-flag matrix.
- Direct hosted runtime and warm Codex are separate projects. The first project
  deletes the per-invocation Node child while keeping Codex single-use. The
  second project introduces a single-slot hosted Codex state machine.
- Milestone 1 must explicitly forbid warm-process infrastructure. No managed
  process registry, warm Codex process hooks, app-server session cache,
  lingering direct-runtime feature flag, package-wide migration, or new
  Cloudflare runtime service wrapper belongs in the first cut.
- Warm Codex app-server reuse stays in scope, but its process state belongs to
  `packages/assistant-engine`, where Codex RPC state and live-turn state already
  live.
- The later warm-Codex root process is explicit expected state, not an
  accidental exception to `/proc` cleanup and not a generic process supervisor.
- Hosted invocation requires explicit env/root/context inputs. Ambient env/cwd
  replacement is not allowed in the new hosted path.
- UserRunner's runtime config is the single launch spec. The container validates
  it and supplies platform ports; it does not rebuild runtime truth from ambient
  env.
- `node-runner.ts`, dynamic runner loading, child IPC transport, and
  child-specific diagnostics are deletion targets, not long-term seams.
- Codex warmth must have strict identity and poisoning rules for authority
  changes, RPC timeouts, write failures, aborts, stale resumes, parse errors,
  and unexpected server messages.
- Per-attempt write-fence authority must not be baked into a warm Codex process
  env/config. Authority belongs on each turn/request or in a package-owned
  authority adapter that reads the active invocation context.
- Wake authority should stay one coherent boundary. The current
  RunnerContainer/DO write-fence validation remains authoritative unless a
  later transport change deliberately adds route-level validation.
- Hosted invocation code may read only `HostedInvocationScope`, not ambient
  `process.env`. Supervisor code may read only frozen startup config, not live
  invocation env.

## Current Code Shape

### Container Lifecycle

`apps/cloudflare/src/runner-container.ts` owns the Cloudflare container
lifecycle.

Important current behavior:

- `invokeHostedExecution` starts or health-checks the warm container, then sends
  `POST /internal/workspace-invocation` to the container entrypoint.
- On successful invocation, `completedSuccessfully = true`, so the warm
  container is kept.
- On startup, request, or runner failure, the warm container may be destroyed.
- The runner idle lifecycle defaults to `300_000ms` in code, with optional
  `HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS` override.
- Runtime wake goes through `wakeRuntime`, which checks active attempt, user,
  and lease generation before calling the container's internal
  `/internal/runtime-wake` route.

The container is already the short-lived warm cache. The extra churn happens
inside the container.

### Container Entrypoint

`apps/cloudflare/src/container-entrypoint.ts` owns the in-container HTTP server.

Important current behavior:

- `POST /internal/workspace-invocation` rejects concurrent invocations with
  `409`.
- Runtime wake uses an active `RuntimeWakeSignal` callback when available, or a
  pending wake flag while the runtime is still starting.
- `runHostedWorkspaceInvocationWithProcessIsolation` snapshots `/proc` before a
  run and calls `enforceHostedContainerProcessIsolation` afterward.
- The process cleanup sweep kills unexpected descendant or same-UID orphan
  processes and fails closed if they remain.
- If cleanup fails with `HostedRunnerShellIsolationError`, the entrypoint exits
  the warm shell.

This entrypoint already has the primitives the simplified architecture needs:
single active invocation, wake routing, and post-run process cleanup.

### Node Runner Layer

`apps/cloudflare/src/node-runner.ts` builds the runtime config, then delegates to
`runHostedWorkspaceInvocationIsolatedDetailed`.

`apps/cloudflare/src/node-runner-isolated.ts` currently:

- computes a per-user warm launcher root
- clears stale browser-vault warm source state
- creates launcher `home`, `cache`, `tmp`, and `hf-home` directories
- spawns a detached Node child running `node-runner-child`
- sends the job over stdin
- listens for IPC result and runtime-wake-ready messages
- treats an IPC result as sufficient completion even if the child leaves handles
  open
- always kills the child process group in `finally` using `SIGKILL`

`apps/cloudflare/src/node-runner-child.ts` currently:

- reads one JSON job from stdin
- creates a `RuntimeWakeSignal`
- builds the Cloudflare runtime platform and mailbox decoder
- resolves the warm vault root from `process.cwd()`
- calls `runHostedWorkspaceRuntimeJobInProcess`
- sends the result back over IPC
- exits

This layer is mostly lifecycle machinery around code that can become a direct
callable runtime function.

### Hosted Runtime

`packages/assistant-runtime/src/hosted-runtime.ts` owns the actual hosted work:

- workspace read and version/user validation
- workspace restore
- mailbox import
- assistant input staging
- inbox sidecar/projection
- CLI bridge startup
- assistant/device/background runtime work
- runtime wake handling during dirty waits
- `idle_shutdown` checkpointing
- warm-clean checkpoint marker writing

The main simplification blocker is
`packages/assistant-runtime/src/hosted-runtime/environment.ts`:

- `withHostedProcessEnvironment` serializes access with a process-wide queue.
- It snapshots `process.env` and `process.cwd()`.
- It replaces `process.env`.
- It `chdir`s into the vault root.
- It restores env and cwd afterward.

That ambient global-state wrapper explains why a disposable child was attractive
originally. With a short-lived warm container and a single active invocation
gate, the hard-cut target removes it from the hosted invocation path and
threads explicit runtime context instead.

### Codex App-Server

`packages/assistant-engine/src/assistant-codex.ts` currently starts a Codex
app-server per assistant turn:

- resolve env and `CODEX_HOME`
- create a temp root for images
- spawn `codex app-server`
- send `initialize`
- send `thread/start` or `thread/resume`
- send `turn/start`
- wait for `turn/completed`
- drain progress
- stop the app-server process

`packages/assistant-engine/src/assistant-codex/app-server-rpc.ts` handles stop:

- close stdin
- send `SIGTERM`
- wait up to 3s
- escalate to `SIGKILL`
- best-effort kill the process group after exit

This is the largest repeated startup cost left after removing the Node child.
The app-server protocol already separates initialization/thread context from
turn start, so it can be wrapped in a reusable session object.

## Keep These Invariants

### One Active Invocation

Keep the entrypoint-level active slot. The current `activeHostedRunnerJobCount`
gate is the right primitive.

Do not introduce concurrent invocations inside one warm container. This plan
keeps one active invocation per warm container.

The one-active-invocation gate is not enough by itself while ambient
compatibility code exists. `/health` and `/internal/runtime-wake` can run during
an active invocation, so every in-container route that can run concurrently must
avoid invocation-sensitive `process.cwd()` and `process.env` reads.

### Write Fence Is Authority

Keep the current write-fence model:

- UserRunner begins a runtime write fence.
- The container job carries attempt id, user id, lease generation, deadline,
  and workspace version.
- Runtime callbacks include the active authority headers.
- Stale or wrong-user authority fails closed.

The process boundary is not the authority boundary. The write fence is.

### Runtime Owns Idle Checkpointing

Keep the hosted protocol's current completion model:

- foreground work may defer intermediate checkpointing
- dirty runtime state remains local while the invocation is active
- final durable progress is proven by runtime-owned `idle_shutdown`
- Cloudflare activity expiry is cleanup-only
- Temporal remains pointer-only and observes durable demand/status

### Container Owns Cleanup

Move the useful cleanup invariant to the container:

- after each invocation, snapshot and sweep unexpected processes
- if sweep succeeds, keep warm state
- if sweep fails, destroy the warm container

Do not depend on per-run process group death as the normal cleanup mechanism.

### Env Projection Stays Strict

Do not weaken env handling while removing lifecycle layers.

Preserve:

- hosted forwarded env denylist
- user env denylist
- runner-secret allowlist
- parser toolchain env omission unless typed
- Codex shell env allowlist
- hosted direct CLI env projection
- metadata-only diagnostics and redaction

The simplification is lifecycle deletion, not broad env inheritance.

## Target Design

### Small Primitives

The target should be a deletion architecture, not another supervisor. Keep the
owners that already exist:

- `UserRunner` Durable Object: write fence, active attempt, wake/replace
  orchestration, runner reset.
- `RunnerContainer`: warm container lifecycle, health check, sleep/expiry, and
  reset on poisoned state.
- `container-entrypoint.ts`: HTTP routes, one active invocation slot, pending
  wake delivery, platform port construction, package invocation call, and
  process cleanup proof.
- `packages/assistant-runtime`: package-owned hosted invocation, restore,
  mailbox import, foreground/background runtime work, runtime bridge behavior,
  and `idle_shutdown` checkpoint ownership.
- `packages/hosted-execution`: hosted protocol contracts, request/result
  shapes, parsers, and redacted diagnostics contracts.
- `packages/assistant-engine`: Codex app-server process/RPC/live-turn state.

Do not add a broad `HostedContainerRuntimeService` that duplicates the
entrypoint and `RunnerContainer` lifecycle owners.

Do not add `apps/cloudflare` modules that own local Murph runtime semantics.
Cloudflare-specific code should implement ports and transport only.

Milestone 1 target:

```text
UserRunner DO
  -> warm RunnerContainer
    -> container-entrypoint active invocation slot
      -> explicit HostedInvocationScope
      -> package-owned runHostedWorkspaceInvocation(...)
      -> single-use assistant-engine Codex app-server
      -> container process cleanup proof
```

Milestone 1 forbidden list:

- no managed process registry
- no warm Codex process hooks
- no app-server session cache
- no direct-runtime feature flag kept past the cut
- no package-wide migration unless needed to delete the child
- no new Cloudflare runtime service wrapper

Anything beyond that belongs after the child is gone. The existing container
already has the Milestone 1 primitives: one active invocation and post-run
process cleanup.

Milestone 2 target:

```text
Same as Milestone 1, except assistant-engine may keep exactly one verified
Codex app-server root process warm when identity and authority rules allow it.
```

### Package-Owned Invocation Primitive

Replace the detached child with one package-owned callable primitive exported
from `packages/assistant-runtime`:

```ts
async function runHostedWorkspaceInvocation(input: {
  job: HostedAssistantWorkspaceRuntimeJobInput;
  scope: HostedInvocationScope;
  platform: HostedRuntimePlatform;
  runtimeWakeSignal: RuntimeWakeSignal;
  signal: AbortSignal;
}): Promise<HostedWorkspaceInvocationResult>;
```

This primitive owns Murph runtime behavior. `container-entrypoint.ts` owns only:

- request parsing
- busy rejection
- pending wake state
- request abort wiring
- process baseline snapshots
- Cloudflare platform port construction
- post-run cleanup
- warm-shell destroy on poisoned state

Implementation shape:

- Move code into packages only when it removes hosted runtime semantics from
  Cloudflare. Keep Cloudflare-specific transport adapters in Cloudflare. Do not
  block child deletion on pure code motion that does not change the lifecycle
  boundary.
- Keep Cloudflare-specific fetch, R2, Durable Object, and outbound-control
  adapters in `apps/cloudflare` as implementations of `HostedRuntimePlatform`
  ports.
- Stop reading runtime input from stdin and stop using IPC for result/wake
  readiness.
- Pass `vaultRoot`, `operatorHomeRoot`, scratch root, cache root, temp root,
  and platform transport env explicitly.
- Stop deriving runtime roots from `process.cwd()`.
- Stop reading provider transport config from the supervisor's ambient
  `process.env`.
- Create one `RuntimeWakeSignal` per active invocation.
- Keep the same mailbox payload decoder and workspace bridge options.
- Preserve all non-lifecycle side effects of the isolated runner path,
  including browser-vault warm-source clearing, per-user warm-root creation,
  safe root permissions, native parser-toolchain rebinding, env projection, and
  redacted config/error classification.
- Treat UserRunner's runtime config as the launch spec except for
  container-image facts such as native parser tool paths. Those remain container
  facts and must not be trusted from Worker-provided typed paths across the
  Worker-to-container seam.
- Call the package-owned hosted invocation function directly.
- Return the existing `HostedWorkspaceInvocationResult`.
- Delete `node-runner.ts`, `node-runner-isolated.ts`,
  `node-runner-child.ts`, normal child IPC message types, and dynamic
  node-runner loaders as part of the hard cut.

### Explicit Runtime Context

The new hosted path should not run through `withHostedProcessEnvironment`.
Thread per-invocation truth through small explicit value objects instead of one
large context bag:

```ts
interface HostedInvocationAuthority {
  attemptId: string;
  leaseGeneration: string;
  userId: string;
  workspaceVersion: string;
}

interface HostedInvocationRoots {
  warmRoot: string;
  vaultRoot: string;
  operatorHomeRoot: string;
  scratchRoot: string;
  cacheRoot: string;
  tempRoot: string;
}

interface HostedInvocationEnv {
  runtimeEnv: Readonly<Record<string, string>>;
  platformTransportEnv: Readonly<Record<string, string>>;
  cliBridgeEnv?: Readonly<Record<string, string>>;
}

interface HostedInvocationScope {
  authority: HostedInvocationAuthority;
  env: HostedInvocationEnv;
  job: HostedAssistantWorkspaceRuntimeJobInput;
  roots: HostedInvocationRoots;
}
```

Required behavior:

- Build the projected runtime env with existing env projection helpers.
- Pass platform transport env explicitly to Cloudflare/internal fetch helpers.
- Pass only the value object each helper actually needs.
- Pass `workingDirectory` or `vaultRoot` explicitly to assistant-engine calls.
- Keep the hosted CLI bridge per-invocation. Do not make it a long-lived service
  in this plan.
- Compute immutable entrypoint constants at startup, including app/image root,
  runner bundle manifest path, and base supervisor env.
- Read immutable supervisor config into a frozen startup object.
- Build platform adapters from the frozen startup object.
- Delete, neutralize, or otherwise make unreachable raw `process.env` entries
  that hosted invocation code must never see.
- Fail tests if invocation code reads raw `process.env` for per-run truth.
- Make `/health` use only those immutable constants, not `process.cwd()` or
  invocation env. During an active invocation, `/health` may return a smaller
  response if that keeps the route independent.
- Keep `/internal/runtime-wake` independent of ambient `process.env` and cwd.
- Remove `withHostedProcessEnvironment` from the hosted invocation path. If any
  helper still needs ambient env/cwd, fix that helper or keep compatibility only
  in non-hosted local CLI paths.

Hard-cut gate: no required hosted runtime path reads the supervisor's ambient
`process.env` or `process.cwd()` for per-invocation authority, provider
transport config, vault root, operator home, or working directory.

Long-term rule:

- hosted invocation code reads only `HostedInvocationScope`, never ambient
  `process.env`
- supervisor code reads only frozen startup config, never live invocation env

### Per-Invocation Cleanup Scope

Use a small cleanup stack for direct invocation instead of another runtime
service:

```ts
const scope = createHostedInvocationCleanupScope();

try {
  scope.defer(() => clearRuntimeWakeCallback());
  scope.defer(() => stopCliBridge());
  scope.defer(() => removeAbortListener());
  return await runHostedWorkspaceInvocation(...);
} finally {
  await scope.dispose();
}
```

Every per-invocation resource must either be returned from the package call or
registered in the cleanup scope before it can leak.

Resources that belong in this cleanup scope include:

- wake callback
- pending wake state
- CLI bridge
- temp roots
- active-turn registration
- abort listeners
- progress delivery
- any compatibility env/cwd shim while it still exists

### Wake Authority Boundary

Preserve one coherent wake authority model.

Current behavior:

- `RunnerContainer.wakeRuntime` verifies active attempt, user, and lease
  generation before it calls the container.
- The container's `/internal/runtime-wake` route is payloadless and only
  delivers to the active invocation's wake signal or records a pending wake
  while the runtime is starting.

Target behavior:

- Keep the current DO-side write-fence validation as the authority boundary.
- Keep the entrypoint wake route payloadless unless the transport is deliberately
  changed in a separate protocol step.
- Bind each pending wake to the active invocation attempt id already known by
  the entrypoint.
- Clear the wake callback and pending wake state in `finally` after every
  invocation.
- If a future route-level body is added, validate attempt id, lease generation,
  and user there too; do not split semantics between two half-authoritative
  boundaries.

### Boring Health Route

Keep `/health` deterministic and cheap. It should report only:

- process alive
- hosted runtime architecture version
- image/bundle architecture version
- active job count
- poisoned flag
- last cleanup status if already known

Do not make `/health` perform full `/proc` scanning, deep warm-Codex identity
verification, or expensive runtime checks. Expensive proof belongs at the points
that decide whether state may survive:

- before accepting an invocation if a warm expected process exists
- after every invocation
- before keeping the container warm
- on explicit reset/shutdown

Health is a status route, not a second lifecycle owner.

### Architecture Version Handshake

Avoid deploy-skew compatibility matrices with one explicit architecture/version
handshake:

- `/health` returns `hostedRuntimeArchitectureVersion`
- invocation requests include the expected architecture version
- the entrypoint rejects a version mismatch with a reset-worthy error
- `RunnerContainer` destroys the warm container on version mismatch

This covers:

- new Worker with old warm container
- old Worker with new warm container
- new request shape with old entrypoint
- old request shape with new entrypoint

Rollback remains previous-image redeploy plus warm-container reset. Do not keep
old/new request-shape branches as a long-lived compatibility layer.

### Warm Codex Root Process Tracking

Milestone 1 hosted runtime does not need intentional warm-process tracking.
Existing container `/proc` cleanup is enough while Codex remains single-use.

Warm Codex app-server reuse, when implemented later, needs cleanup proof but not
a generic process supervisor framework. Assistant-engine should expose a narrow
single-slot hosted Codex surface:

- `snapshotExpectedCodexRootProcess()`
- `stopWarmCodex(reason)`
- `health()`

The expected warm survivor is the Codex app-server root process only. Do not
exempt the entire process group. Codex may launch shell commands, parser tools,
or user commands during a turn, and those descendants must not survive warm
reuse.

Warm-Codex cleanup rule:

- the expected Codex root pid may survive
- the expected process group is not automatically exempt
- after each turn/invocation, prove the app-server is idle
- kill unexpected live descendants and same-UID orphans
- if descendants remain after cleanup, poison the Codex process and destroy the
  warm container

Expected warm process proof must not be PID-only. For the intentional warm
survivor, expose only process facts the container can verify:

```ts
interface HostedExpectedCodexRootProcess {
  commandLineDigest: string;
  owner: "codex-app-server";
  pid: number;
  processGroupId: number | null;
  startTimeTicksFromProcStat: string;
  uid: number | null;
}
```

Container cleanup must verify that the registered pid still refers to the same
process. PID reuse should never make an unrelated process look expected.
Assistant-engine identity digests remain internal reuse state; do not include
them in the container-facing proof unless the container can verify them through
a real assistant-engine health check. The existing simpler PID snapshot logic
can remain for unregistered leak cleanup, because those checks run over short
cleanup windows.

### Warm Roots

Separate restored runtime roots from process scratch roots.

Current child launcher roots:

```text
warmRoot/
  durable/
    vault/
  home/
  cache/
  tmp/
  hf-home/
```

Hosted workspace restore derives:

- `vaultRoot` from `warmRoot/durable/vault`
- `operatorHomeRoot` from the durable workspace layout
- `scratchRoot` from the sibling scratch layout

Target roots:

- restored runtime roots: `vaultRoot`, `operatorHomeRoot`, and `scratchRoot`
- process roots: cache root, temp root, and any model/tool cache roots
- obsolete launcher-only `home` root should be deleted or repurposed
  deliberately; do not preserve it by accident

The warm-clean checkpoint marker remains the correctness gate for restored
runtime roots. Process scratch/cache roots are performance caches only.

### Assistant-Engine Single-Slot Warm Codex

Warm Codex reuse belongs in `packages/assistant-engine`, not in Cloudflare or
`packages/assistant-runtime`. It should be a hosted-only single slot, not a
general cache, LRU, pool, or multi-session manager.

Split `executeCodexAppServerTurn` into:

```ts
async function executeCodexAppServerTurn(input): Promise<CodexAppServerTurnResult> {
  const process = await hostedWarmCodexSlot.getOrStart(input.identity);
  return await runCodexAppServerTurnOnProcess(process, input);
}
```

Single-slot behavior:

- if no process exists, start one
- if identity matches and the process is healthy and idle, reuse it
- if identity differs, stop the old process and start a new one
- if the process is poisoned, unhealthy, running, or stopping, stop it and start
  a new one
- local CLI behavior remains unchanged unless separately designed

Add an assistant-engine-owned primitive:

```ts
interface CodexAppServerProcess {
  identity: CodexAppServerProcessIdentity;
  runTurn(input: CodexAppServerTurnInput): Promise<CodexAppServerTurnResult>;
  stop(reason: CodexAppServerStopReason): Promise<void>;
  poison(reason: CodexAppServerPoisonReason): Promise<void>;
  health(): CodexAppServerHealth;
  expectedRootProcess(): HostedExpectedCodexRootProcess;
}
```

Assistant-engine owns:

- spawned `codex app-server` process
- JSON-RPC stdin/stdout parsing
- process-scoped monotonically increasing RPC request id
- pending RPC request map keyed by process-scoped id
- initialized state
- explicit `idle | running | poisoned | stopping | stopped` state
- active turn registration and cleanup
- progress/tool request plumbing
- stale event handling
- process poisoning/restart

The hosted runtime only supplies lifetime policy:

- use the warm process slot only in hosted mode
- expose the expected Codex root process to container cleanup
- stop the warm Codex process on container reset/shutdown
- keep Codex single-use in the Milestone 1 deletion cut; introduce warm
  Codex only as the later stateful subsystem project

### Codex Identity And Authority

Keep a warm Codex app-server only when its identity is stable and its authority
cannot go stale.

The identity digest must include metadata-only hashes or ids for:

- resolved app-server command and args
- hosted test app-server command
- `CODEX_HOME`
- generated `config.toml` content
- provider/base URL identity
- model provider id
- model id
- sandbox and approval policy
- working directory and vault root identity until context switching is proven
- shell env allowlist policy
- dynamic tool capability/catalog version
- safe env allowlist digest

Required hard-cut authority model:

- keep the app-server process warm across invocations only after authority is
  request/turn scoped
- inject runtime authority per turn or per request through explicit request
  params, not process env
- never let a warm process hold a stale write-fence header, bridge token, or
  workspace version

If Codex cannot accept per-turn provider authority directly, add one small
package-owned authority adapter in assistant-engine/runtime that attaches the
active invocation authority to provider requests. Do not push this concern into
Cloudflare, and do not claim cross-invocation app-server warmth while
per-attempt authority is still embedded in process env/config.

Warm-Codex authority phases:

- Phase A: reuse only when identity, including embedded authority digest,
  matches exactly
- Phase B: add per-turn/request authority injection
- Phase C: allow cross-invocation reuse only after Phase B is proven

### Codex Session Poisoning

Warm reuse is safe only if corrupted sessions are aggressively discarded.

Poison and restart the Codex process on:

- initialize failure
- RPC timeout
- stdin write failure
- JSON parse/framing error
- unexpected server request
- process exit or signal
- `thread/resume` RPC failure until Codex proves resume failure is stateless
- stale resume fallback before retrying without `resumeSessionId`
- abort after provider work has started unless a terminal turn event proves the
  process returned to idle
- any abort path that sends an OS signal such as `SIGINT` to the app-server
- failed `turn/interrupt`
- late response for a timed-out request
- late event for a closed turn that cannot be ignored by turn id
- identity mismatch
- expected root process health failure

Do not reset JSON-RPC ids per turn in warm mode. The process owns
`nextRpcId`, and it increases monotonically until process restart. A late
response for an unknown or timed-out id must be handled by a strict rule:
poison, or ignore only when it is provably correlated to a closed turn and
cannot affect the active turn.

Server-originated requests should be categorized:

- known unsupported request shape: reply with an RPC error and continue
- supported Murph dynamic progress request: handle normally
- malformed request, bad JSON/framing, impossible correlation, or unknown
  request that cannot be safely rejected: poison

Every event handler must check active turn identity or turn generation before
mutating turn state.

Per-turn cleanup must prove:

- all pending RPCs for the turn are resolved or rejected
- stale responses cannot resolve later turns
- active-turn controller is unregistered
- pending steer/interrupt calls are rejected after close
- progress delivery queues are drained or rejected
- temp image roots are removed
- diagnostics remain metadata-only

## Greenfield Hard-Cut Plan

Milestone 1 is a deletion plan, not a compatibility migration. It removes the
per-run Node child and keeps Codex single-use. The old per-run child stack
should not remain as a supported production fallback. If production needs
rollback, redeploy the previous known-good worker/container image.

Milestone 2 is the separate warm-Codex state-machine project. It should not be
mixed into Milestone 1.

### Step 0: Prove The Boundary And Deletion List

Before edits, write down the exact ownership boundary:

- Cloudflare owns HTTP routes, Durable Object/container transport, write-fence
  calls, platform port implementations, warm-container health, and process
  cleanup.
- `packages/assistant-runtime` owns hosted invocation behavior: restore,
  mailbox import, runtime bridge, assistant/background work, wake-aware dirty
  waits, and `idle_shutdown` checkpoint construction.
- `packages/assistant-engine` owns Codex process/RPC/live-turn state.
- `packages/hosted-execution` owns protocol contracts and parsers.

Deletion targets in the hard cut:

- `apps/cloudflare/src/node-runner.ts`
- `apps/cloudflare/src/node-runner-isolated.ts`
- `apps/cloudflare/src/node-runner-child.ts`
- normal-path child IPC result/wake message types in `runner-job-transport.ts`
- child-only runtime diagnostics and tests
- dynamic `loadNodeRunner`/preload code in `container-entrypoint.ts`
- hosted-path use of `withHostedProcessEnvironment`
- container-side runtime config rebuilds from ambient env
- top-level launcher-only roots that no longer serve the package runtime

Success: the implementation has one target shape and one delete list before
code is moved.

### Step 1: Make Entrypoint Routes Env/Cwd Independent

Before the entrypoint calls package-owned runtime code, make routes that can run
during an invocation independent of invocation env/cwd:

- compute immutable app/image root at startup
- compute immutable runner bundle manifest path at startup
- capture and freeze base supervisor env/config at startup for non-invocation
  configuration only
- create platform adapters from frozen startup config, not raw live env
- neutralize or make unreachable raw env entries that hosted invocation code
  must never see
- make `/health` read from immutable paths/constants and keep it cheap: process
  alive, architecture version, active job count, poisoned flag, and last cleanup
  status only
- add a `hostedRuntimeArchitectureVersion` handshake between RunnerContainer and
  entrypoint, and destroy the warm container on mismatch
- keep `/internal/runtime-wake` payloadless and independent of env/cwd

Success: `/health` and `/internal/runtime-wake` are safe while any remaining
compatibility shim mutates env/cwd during development.

### Step 2: Move Runtime Bridge Ownership Into Packages

Move package-owned runtime bridge behavior out of Cloudflare only where it
removes hosted runtime semantics from Cloudflare:

- snapshot/checkpoint construction that operates through
  `HostedRuntimeWorkspaceSnapshotPort`
- mailbox payload decode interfaces and package-generic decode flow
- lease assertion helpers that compare active invocation authority
- runtime invocation context validation
- call into `runHostedWorkspaceRuntimeJobInProcess`

Keep in Cloudflare only the platform-specific adapters:

- outbound web-control fetch
- Durable Object/runtime write-fence calls
- R2/artifact transport
- Cloudflare provider fetch and egress intercept integration
- Cloudflare metadata-only diagnostics mapping

Success: `apps/cloudflare` builds `HostedRuntimePlatform` and
`HostedInvocationScope`, then calls a package function. It does not
assemble Murph assistant runtime behavior. Do not block child deletion on pure
code motion that does not change the lifecycle boundary.

### Step 3: Remove Ambient Hosted Env/Cwd

As part of the hard cut, remove hosted-path reliance on process-global env/cwd:

- runtime roots are explicit scope fields
- provider transport config is explicit platform transport env
- assistant/Codex working directory is an explicit input
- CLI bridge env is per-invocation
- `withHostedProcessEnvironment` is not used in the hosted invocation path

Success: no hosted invocation code reads supervisor ambient `process.env` or
`process.cwd()` for per-invocation authority, roots, provider transport, or
working directory.

### Step 4: Replace The Entrypoint Call And Delete The Child Stack

Change `container-entrypoint.ts` to:

- parse the existing invocation request
- verify the expected hosted runtime architecture version
- validate the already-built runtime spec from UserRunner
- compute explicit roots/context
- create one invocation `RuntimeWakeSignal`
- register wake callbacks, CLI bridge stop, abort listeners, temp roots,
  progress delivery, and any temporary env/cwd compatibility shim in a small
  per-invocation cleanup scope
- preserve browser-vault warm-source clearing, per-user warm-root creation,
  safe permissions, parser-toolchain rebinding to container-image paths, env
  projection, and redacted config/error classification
- build Cloudflare platform ports
- call `runHostedWorkspaceInvocation`
- run existing process cleanup
- keep Codex app-server single-use per turn
- keep warm only after clean success
- destroy the warm container on abort, preemption, timeout, failed cleanup, or
  uncleared in-process state

Delete the per-run child stack in the same change. Do not keep a runtime flag
or alternate production path.

Success: no normal hosted invocation spawns the Node runtime child, and the
container has no dynamic node-runner loader.

Direct-mode abort rule: if the request aborts before the invocation reaches a
known durable return boundary and cleanup cannot prove all in-process state is
idle, do not keep the container warm. Do not use partial reset heuristics.

### Step 5: Add A Boring Warm-Container Recycle Policy

The removed child was an automatic memory reset. Keep the replacement simple:

- destroy the warm container after a fixed number of successful hosted
  invocations
- destroy the warm container after any ambiguous in-process cleanup failure

This is not a new owner or healer. It is a safety valve while the warm container
now owns more lifetime.

Memory threshold is observation-first. Keep emitting RSS/cgroup diagnostics,
but start Milestone 1 with count-based recycle plus ambiguous-failure recycle.
Add memory thresholds only after direct invocation data proves a stable
threshold.

Success: hosted invocation does not require a complex memory/state recovery
system.

### Step 6: Prove And Deploy Milestone 1

Run focused unit/integration tests and hosted-local E2E before deploy. Deploy
the new worker/container as one architecture cut.

Production rollback plan:

- redeploy the previous known-good image/version if the cut fails
- do not carry the removed child path forward as a hidden compatibility mode

Operational checks after deploy:

- runtime wake accepted actions still map to `already_running` or `woken`
- no increase in ambiguous `wake-unconfirmed`
- no increase in failed process cleanup
- no increase in stale write-fence expiry
- no increase in hosted runtime configuration errors
- no retained in-process wake, active-turn, env/cwd, or bridge state after runs
- warm-turn latency decreases from removing the per-run child

Success: hosted steady state is one warm container plus package-owned hosted
runtime invocation plus single-use Codex, with Cloudflare remaining a thin
platform adapter.

State that must not exist after Milestone 1:

- `node-runner.ts` is imported by `container-entrypoint.ts`
- `node-runner-child` is built into the normal runtime path
- child IPC result/wake schemas are used by production code
- successful invocation SIGKILLs a runtime Node child
- hosted invocation path calls `withHostedProcessEnvironment`
- hosted runtime reads `process.cwd()` for vault root
- hosted runtime reads `process.env` for per-invocation authority
- `container-entrypoint.ts` dynamically loads `node-runner`
- warm Codex process can survive an invocation
- any long-lived child process is expected inside the runtime

### Step 7: Refactor Codex Without Warming

Refactor assistant-engine so process/session plumbing is separable from
per-turn logic:

- split stable app-server process/RPC state from per-turn logic
- keep stopping the process after every turn
- preserve current local CLI behavior
- add process/session tests for RPC timeout, write failure, abort ambiguity,
  stale resume, late response hazard, parse/framing error, and unsupported
  request handling

Success: Codex process/session internals are testable without changing hosted
Codex lifecycle.

### Step 8: Add Single-Slot Warm Codex In Hosted Mode

Only after Milestone 1 is stable, introduce hosted warm Codex:

- one hosted warm Codex slot, not a general cache
- initialize once per stable identity
- run multiple turns on one process only when healthy and idle
- expose only the expected Codex root process to container cleanup
- stop the warm process on container shutdown/reset
- poison/restart on RPC timeout, write failure, abort ambiguity, stale resume,
  parse/framing error, unexpected request, late response hazard, identity
  mismatch, or health failure

Success: hosted assistant turns do not normally restart Codex app-server, and
Codex process lifetime remains owned by assistant-engine.

### Step 9: Move Codex Authority Out Of Process Env

Make app-server warmth real by removing per-attempt authority from long-lived
Codex process env/config.

Preferred order:

1. Use per-turn/per-request authority if Codex app-server supports it.
2. Otherwise add a small package-owned authority adapter that attaches the
   active invocation authority to provider requests.
3. Keep Cloudflare as the egress/write-fence verifier, not the owner of Codex
   authority state.

Do not ship cross-invocation app-server reuse while user id, attempt id, lease
generation, workspace version, bridge token, or write-fence headers are baked
into the process identity.

Success: a warm Codex process can serve later invocations without stale
write-fence or bridge authority.

### Step 10: Enable Cross-Invocation Warm Codex

Only after per-turn/request authority injection exists:

- allow reuse across invocation attempts when non-authority identity matches
- keep single-slot behavior
- delete hosted single-use fallback only after production proof

Success: cross-invocation warm Codex is enabled without stale authority.

### Step 11: Simplify Process Cleanup And Roots

After the child stack and warm-Codex support are settled:

- process cleanup preserves only the expected Codex root process
- leaked arbitrary descendants or same-UID orphans still poison/destroy the
  warm container
- launcher-only `home` roots are deleted unless deliberately repurposed
- restored runtime roots remain guarded by the warm-clean checkpoint marker
- cache/temp/model roots are performance caches only

Success: process lifetime has one rule: only the verified expected Codex root
may survive; everything else is a leak.

## Test Plan

### Focused Unit Tests

Update or add tests for:

- package-owned invocation receives Cloudflare platform ports and explicit
  context
- package-owned invocation uses explicit projected env instead of supervisor env
- package-owned invocation uses explicit `vaultRoot` instead of supervisor cwd
- package-owned invocation cannot read raw `process.env` for per-run truth
- package-owned invocation exposes wake readiness without IPC
- direct path preserves browser-vault warm-source clearing before each
  invocation
- direct path computes the same per-user warm root and creates required roots
  with safe permissions
- direct path rebinds native parser toolchain to container-image paths and does
  not trust Worker-provided typed tool paths across the Worker-to-container seam
- direct path preserves config-error classification and redacted diagnostics
- entrypoint rejects concurrent invocations
- entrypoint records pending wake while runtime is starting
- entrypoint delivers pending wake after runtime becomes ready
- entrypoint clears wake callback and pending wake state after every invocation
- `/health` remains correct while an invocation is active and never depends on
  invocation cwd
- `/health` stays cheap and does not perform full `/proc` scans or deep
  warm-process identity checks
- `/health` returns the hosted runtime architecture version
- invocation architecture-version mismatch returns a reset-worthy error
- `RunnerContainer` destroys the warm container on architecture-version mismatch
- per-invocation cleanup scope disposes wake callback, pending wake state, CLI
  bridge, abort listeners, temp roots, progress delivery, and compatibility
  shims on success, failure, abort, and timeout
- container process cleanup kills leaked descendants
- container process cleanup kills daemonized same-UID orphans
- failed cleanup exits/destroys the warm shell
- warm-container recycle policy triggers on max successful invocations and
  ambiguous cleanup failure
- memory/cgroup diagnostics remain observable, but memory-threshold recycling is
  not required for Milestone 1
- package-owned invocation preserves env projection
- package-owned invocation does not expose control-plane env through runtime
  tests
- wake authority flow preserves current DO-side validation and payloadless
  container route semantics
- foreground wake during idle checkpoint reaches entrypoint, runtime wake
  signal, checkpoint abort/yield, and subsequent foreground pass
- static secret invariant scans cover new hosted invocation surfaces:
  - package invocation inputs
  - runtime context metadata
  - identity digests
  - runtime health payloads
- static deletion-proof checks fail if Milestone 1 production code still uses
  `node-runner`, child IPC result/wake schemas, dynamic node-runner loading,
  `withHostedProcessEnvironment`, hosted `process.cwd()` vault-root reads,
  hosted `process.env` authority reads, or any expected warm child process

### Codex Refactor Tests

Update or add tests for:

- thread start/resume still sends the same params
- `turn/start` stays per turn
- progress dynamic tool handling still works
- live steer and interrupt still route to the active turn
- RPC timeout poisons the process and rejects late responses
- stdin write failure poisons the process
- parse/framing error poisons the process
- stale `thread/resume` failure poisons before fallback retry
- abort after provider work either observes terminal turn completion or poisons
  the process
- failed turn does not poison a healthy session unless the poisoning rules
  require it
- app-server restart occurs on identity change
- app-server stop still escalates only on explicit stop/failure
- provider credentials are not exposed to shell command env
- per-turn/request authority injection does not require process restart and does
  not leak stale authority
- tests fail if per-attempt authority is embedded in long-lived process
  env/config
- active-turn controller unregisters after success, abort, timeout, stale resume,
  provider rejection, and process poison

### Warm Codex Tests

These are required only for Milestone 2:

- single-slot behavior starts, reuses, stops, and replaces exactly one hosted
  Codex process
- app-server initializes once for multiple turns when identity is stable
- process-scoped RPC ids never reset until process restart
- process has explicit `idle | running | poisoned | stopping | stopped` state
- no pending RPCs after turn close
- active live-turn controller is always unregistered
- abort via OS signal always poisons the process
- known unsupported server request shape receives an RPC error without
  necessarily poisoning
- malformed request, bad framing, bad JSON, impossible correlation, or
  unhandled unknown request poisons
- expected root process proof verifies pid, uid, process-group id,
  `/proc/stat` start time, command-line digest, and owner
- cleanup preserves only the verified Codex root process
- cleanup kills leaked descendants even if they share the Codex process group
- cleanup rejects stale, missing, wrong-identity, PID-reused, or unhealthy
  Codex root processes
- expected Codex root process is removed on identity mismatch, poison, reset,
  and container shutdown
- authority env/config digest changes force a new process until per-turn
  authority injection exists
- cross-invocation reuse stays disabled until per-turn/request authority
  injection exists
- warm-session diagnostics use a fixed metadata-only allowlist

### Hosted Runtime Tests

Update existing hosted runtime tests so they assert the actual invariant:

- no unexpected processes remain after warm reuse
- no stale local runtime state crosses invalid leases
- warm-clean marker controls warm restore
- workspace version mismatch forces cold restore
- dirty state persists only through active write-fence ownership and final
  checkpoint
- hosted invocation clears in-process runtime state after success, failure,
  abort, and preemption
- ambiguous abort destroys the warm container unless reset proves wake handlers,
  active turns, CLI bridges, app-server state, env/cwd, and process cleanup are
  clean
- direct-runtime Milestone 1 keeps Codex single-use and requires no expected
  warm process survivor

### E2E / Smoke

Required local proof before the hard-cut deploy:

- `pnpm --dir apps/cloudflare test`
- focused container entrypoint tests
- focused assistant Codex app-server tests
- hosted-local warm reuse E2E
- hosted-local vault persistence E2E with live Codex profile when available
- hosted-local Linq delivery and scheduled reminder
- hosted-local Telegram
- hosted-local device-connect
- hosted-local direct-R2 presigned PUT
- hosted-local temporal orchestration

Production deploy proof should include the existing Cloudflare deploy smoke and
operator status polling until runner idle with a latest workspace checkpoint ref.

## Docs To Update When Implementing

- `agent-docs/references/hosted-runtime-protocol.md`
  - Replace "dirty local runtime files are valid only inside the currently
    owned child process" with active write-fence/container lease language.
- `packages/assistant-runtime/README.md`
  - Clarify that hosted runtime execution is direct-invocation-first, not
    child-process-first.
- `agent-docs/references/testing-ci-map.md`
  - Remove claims that final-image smoke exercises an isolated child-run
    workspace once that path is gone.
- `ARCHITECTURE.md`
  - If the target architecture lands, document package-owned hosted invocation,
    the direct-runtime deletion cut, and any later assistant-engine-owned warm
    Codex process reuse.
- `apps/cloudflare/README.md` and `apps/cloudflare/DEPLOY.md`
  - Update operational notes for package-owned hosted invocation,
    warm-container recycle policy, and reset policy.
- `packages/assistant-engine/README.md` if present or equivalent owner docs
  - When Milestone 2 lands, document hosted single-slot warm Codex ownership,
    identity, poisoning, and metadata-only diagnostics.

## Deletion Targets

Expected deletion or heavy simplification in the hard cut:

- `apps/cloudflare/src/node-runner.ts`
- `apps/cloudflare/src/node-runner-isolated.ts`
- `apps/cloudflare/src/node-runner-child.ts`
- dynamic `loadNodeRunner`/preload code
- child IPC result/wake-ready schemas in `runner-job-transport.ts`
- child-output tail diagnostics used only for the deleted process boundary
- tests whose only assertion is successful-run child `SIGKILL`
- child-specific static secret scan surfaces after equivalent hosted invocation
  surfaces are covered
- obsolete top-level launcher `home` root if it has no remaining owner
- hosted-path use of `withHostedProcessEnvironment`

Expected retention:

- browser-vault warm-source clearing before each invocation
- per-user warm-root computation and safe root creation
- runner env policy
- hosted secret filtering
- parser-toolchain rebinding to container-image paths
- config-error classification and redacted diagnostics
- runtime platform construction
- mailbox payload decode bridge
- workspace snapshot bridge
- runtime wake semantics
- architecture-version mismatch reset semantics
- per-invocation cleanup scope for in-process resources
- container process cleanup
- Codex shell env allowlist

Future warm-Codex retention after Milestone 2:

- expected Codex root-process snapshot/stop/health hooks
- assistant-engine single-slot hosted Codex process holder

## Risks And Mitigations

### Risk: Ambient Env Leak Across Runs

Cause: `withHostedProcessEnvironment` mutates process-wide state.

Mitigation:

- move explicit `HostedInvocationScope` value objects into the package-owned
  hosted invocation API
- read immutable supervisor config into a frozen startup object
- create platform adapters from frozen startup config
- delete, neutralize, or otherwise make unreachable raw env values that hosted
  invocation code must never see
- keep single active invocation
- keep `/health` and `/internal/runtime-wake` independent of ambient env/cwd
- restart warm container on restore failure
- fail tests if hosted invocation uses `withHostedProcessEnvironment` or reads
  raw `process.env` for per-run truth

### Risk: Leaked Tool Process Survives Warm Reuse

Cause: later warm-Codex support allows one expected Codex root process to
survive.

Mitigation:

- make container `/proc` cleanup the primary invariant
- allow only the verified expected Codex root process to survive
- never exempt the whole Codex process group
- health-check the expected Codex root process after every invocation
- kill unexpected descendants and same-UID orphans after every invocation
- fail closed by destroying warm shell when cleanup cannot prove clean state
- keep tests for descendant and daemonized orphan cleanup
- keep tests proving unregistered leaks are still killed

### Risk: Codex App-Server Carries Bad State

Cause: persistent app-server session after a failed turn.

Mitigation:

- session health state
- poison/restart on protocol error, process exit, stdin failure, identity
  change, RPC timeout, parse error, stale resume, late response hazard, or
  unrecoverable turn failure
- fixed metadata-only diagnostic allowlist for health/poison events

### Risk: Codex App-Server Carries Stale Authority

Cause: write-fence headers, CLI bridge tokens, workspace version, or user/lease
identity are embedded in process env/config and survive into a later turn.

Mitigation:

- prefer per-turn/request authority injection
- if Codex cannot accept per-turn authority directly, use a package-owned
  authority adapter before enabling cross-invocation reuse
- fail tests if attempt, lease, user, workspace version, bridge token, or
  write-fence headers are embedded in long-lived process env/config
- never log raw authority values or config bodies

### Risk: Runtime Wake Semantics Change

Cause: replacing child wake-ready IPC.

Mitigation:

- preserve `/internal/runtime-wake` route
- preserve current DO-side write-fence validation
- keep the container route payloadless unless a separate transport migration is
  intentionally designed
- preserve pending wake semantics while runtime starts
- preserve `already_running`, `woken`, `start-required`, and
  `wake-unconfirmed` result meanings
- test same-attempt wake acceptance and wrong-attempt rejection at the owner
  boundary

### Risk: Secret Exposure Through Broader Process Env

Cause: package-owned invocation might accidentally use supervisor env.

Mitigation:

- keep existing env projection helpers
- add static secret invariant tests for the new hosted invocation surfaces
- preserve Codex shell env allowlist
- keep diagnostics metadata-only

### Risk: Hosted Invocation Leaves In-Process State Behind

Cause: the child process used to clear timers, wake handlers, active-turn
controllers, CLI bridges, pending RPCs, and module-level state by exiting.

Mitigation:

- clear wake callback and pending wake state in `finally`
- register wake callbacks, CLI bridge stop, abort listeners, temp roots,
  progress delivery, and compatibility shims in a per-invocation cleanup scope
- assert active-turn controller cleanup
- assert no pending RPCs after success/failure
- reset or destroy warm shell on ambiguous abort
- keep `/health` boring; expensive cleanup proof runs after invocations and
  before keeping the container warm, not on every health check

### Risk: Deploy Skew Or Temporal Replay Changes

Cause: package-owned hosted invocation and warm Codex should be
Cloudflare/container-internal, but any change to signal/wait/activity ordering
would affect Temporal compatibility.

Mitigation:

- add hosted runtime architecture version to `/health`
- include expected architecture version in invocation requests
- reject architecture-version mismatch with a reset-worthy error
- destroy warm containers on version mismatch
- avoid old/new request-shape compatibility branches
- keep Temporal workflow signal/activity order unchanged for this plan
- document that deployment is Cloudflare/container and assistant-engine internal
  unless a later change proves otherwise
- add Temporal replay/version proof before any orchestration contract changes

### Risk: Child Deletion Loses Non-Lifecycle Side Effects

Cause: `node-runner.ts` and `node-runner-isolated.ts` do more than spawn a
child process.

Mitigation:

- preserve browser-vault warm-source clearing before each invocation
- preserve per-user warm-root computation and safe root creation
- preserve native parser-toolchain rebinding to container-image paths
- preserve env projection and Codex shell env allowlist
- preserve config-error classification and redacted diagnostics
- test these behaviors on the direct path before deleting the child stack

### Risk: Health Becomes A Lifecycle Owner

Cause: adding warm-process checks to `/health` can make health checks expensive
or stateful.

Mitigation:

- keep `/health` limited to process-alive, architecture version, active job
  count, poisoned flag, and last known cleanup status
- run expensive process proof only before accepting an invocation when needed,
  after every invocation, before keeping the container warm, and during reset
  or shutdown

## Rollback Plan

This plan intentionally avoids a production child-path fallback.

Rollback steps:

1. Redeploy the previous known-good worker/container image.
2. Destroy affected warm containers so the next invocation starts from the
   previous image.
3. Preserve runtime checkpoint truth; do not synthesize completion.
4. Use metadata-only traces to identify whether failure was in Cloudflare port
   plumbing, package invocation, Codex process reuse, or authority injection.

## Open Questions

- What Codex protocol/API change is needed to inject runtime authority per turn
  or per request instead of via process env/config?
- Does Codex app-server support safely changing thread cwd/context inside one
  process across resumed hosted turns, or should process identity include the
  vault root and force restart on root change until proven?
- Which Codex turn failures should poison the session versus only the turn?
- Which package should own the fallback authority adapter if Codex cannot accept
  per-turn provider authority directly: assistant-engine or assistant-runtime?

## Recommended Implementation Order

Milestone 1: delete the per-run Node child while keeping Codex single-use.

1. Freeze the ownership boundary and delete list.
2. Add the Milestone 1 forbidden list to the implementation checklist: no
   managed process registry, no warm Codex hooks, no app-server cache, no
   persistent feature flag, no package-wide migration, and no Cloudflare runtime
   service wrapper.
3. Freeze supervisor startup config, make `/health` and
   `/internal/runtime-wake` env/cwd independent, and add the architecture-version
   handshake.
4. Move package-owned runtime bridge behavior out of Cloudflare only where it
   removes hosted runtime semantics.
5. Add explicit `HostedInvocationScope` value objects and remove hosted-path
   ambient env/cwd use.
6. Add the per-invocation cleanup scope.
7. Preserve browser-vault warm-source clearing, warm-root creation,
   parser-toolchain rebinding, env projection, and redacted config/error
   classification on the direct path.
8. Replace the entrypoint runtime call and delete the Node child stack in the
   same change.
9. Keep Codex app-server single-use per turn.
10. Add count-based warm-container recycle and ambiguous-failure recycle; leave
   memory-threshold recycle observation-first.
11. Prove focused tests, deletion-proof checks, and hosted-local E2E.
12. Deploy Milestone 1 as one hard cut with previous-image rollback plus
   warm-container reset on architecture-version mismatch.
13. Update durable docs for the direct hosted runtime architecture.

Milestone 2: introduce warm Codex only after Milestone 1 is stable.

1. Refactor Codex app-server process/session plumbing while still stopping the
   process after every turn.
2. Add hosted-only single-slot warm Codex.
3. Track only the expected Codex root process, with PID-reuse protection.
4. Preserve cleanup of leaked descendants and same-UID orphans.
5. Add process-scoped monotonic RPC ids, explicit process state, idle proof, and
   poisoning rules.
6. Move Codex runtime authority out of long-lived process env/config.
7. Enable cross-invocation reuse only after per-turn/request authority injection
   is proven.
8. Delete the hosted single-use Codex fallback only after production proof.

## Non-Goals

- No new scheduler.
- No new queue.
- No new durable demand owner.
- No managed process registry in Milestone 1.
- No warm Codex process hooks in Milestone 1.
- No app-server session cache in Milestone 1.
- No new Cloudflare runtime service wrapper.
- No long-lived hosted CLI bridge in this plan; keep it per-invocation.
- No memory-threshold recycle gate in Milestone 1 until direct invocation data
  proves a stable threshold.
- No weakening of write-fence authorization.
- No weakening of secret/env projection.
- No broad hosted protocol redesign.
- No product behavior changes.
