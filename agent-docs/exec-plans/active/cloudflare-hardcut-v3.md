I stress-tested the uploaded guide against current `main` and would **rewrite it as a much narrower “Milestone 3” hard cut**. The uploaded guide still contains useful invariants, but it also carries obsolete migration shape from before the direct-runtime and Warm Codex work landed. The final guide should not talk about reintroducing flags, extracting under the old child path, adding a generic managed-process registry, or keeping Codex single-use as the target. Those are no longer the architecture on `main`.   

# Final hard cut migration guide: package-owned hosted invocation

## Current state on `main`

Current `main` has already landed the big lifecycle cuts:

```text
UserRunner DO
  -> warm RunnerContainer
    -> container-entrypoint
      -> apps/cloudflare hosted-workspace-invocation
        -> assistant-runtime runHostedWorkspaceRuntimeJobInProcess
          -> assistant-engine single-slot hosted Warm Codex
```

The old `node-runner` production path is gone from current source search results; remaining hits are docs/old completed plans, not active source files. 

The remaining architectural issue is narrower: `apps/cloudflare/src/hosted-workspace-invocation.ts` still builds runtime config, creates the runtime wake signal, constructs Cloudflare platform/fetch/mailbox bridge pieces, builds runtime bridge job options, and directly calls `runHostedWorkspaceRuntimeJobInProcess`.  

Also, `apps/cloudflare/src/runtime-bridge-workspace.ts` still owns a lot of runtime semantics: it builds `HostedWorkspaceRuntimeJobOptions`, owns checkpoint snapshot construction, mailbox import bridge construction, lease checks, snapshot lifecycle logs, and mailbox payload decode glue.    

Cloudflare should keep lifecycle and platform transport. It should not own hosted runtime behavior.

## Target architecture

The final hard-cut target should be:

```text
UserRunner DO
  -> warm RunnerContainer
    -> container-entrypoint active invocation slot
      -> Cloudflare platform adapters
      -> assistant-runtime runHostedWorkspaceInvocation(...)
        -> assistant-runtime hosted bridge/checkpoint/mailbox runtime semantics
        -> assistant-engine hosted Warm Codex
      -> container process cleanup proof
```

This is intentionally not another lifecycle subsystem. It is a deletion/ownership cleanup.

## Non-goals

Do **not** add:

```text
runtime feature flag
old/new package invocation fallback
new Cloudflare runtime service wrapper
generic managed-process registry
new scheduler / queue / demand owner
long-lived CLI bridge
new warm-Codex lifecycle path
cross-invocation Codex authority redesign
```

Warm Codex already belongs to assistant-engine. RunnerContainer already owns lifecycle. Entrypoint already owns process cleanup. The package-owned invocation cut should not create a fourth owner.

## Ownership boundary

### Cloudflare owns

```text
HTTP routes
active invocation slot
request parsing
architecture-version handshake
runtime wake route and pending wake state
request abort wiring
RunnerContainer lifecycle
warm-container recycle policy
/proc cleanup
expected Warm Codex root cleanup
Cloudflare platform port implementations
Cloudflare web-control fetch
Cloudflare egress/provider fetch wiring
R2/artifact transport implementation
write-fence transport calls
Cloudflare-specific mailbox payload decryption adapter
metadata-only container diagnostics
```

RunnerContainer already has the right post-success/failure policy: failed invocations destroy the warm container, successful invocations can keep it warm, and success-count recycling is present. 

### assistant-runtime owns

```text
hosted invocation assembly
HostedWorkspaceRuntimeJobOptions construction
runtime bridge semantics
mailbox import bridge behavior
checkpoint snapshot orchestration
idle_shutdown checkpoint request construction
lease/current-authority validation semantics
runtime wake interaction with checkpointing
workspace restore / mailbox import / foreground/background runtime
```

### assistant-engine owns

```text
Codex app-server process
single-slot hosted Warm Codex
Codex RPC ids
pending RPC map
turn correlation
poison/stop/reuse decisions
expected Codex root process snapshot
```

The Warm Codex state machine already has a process object, ignored-response tracking, process-scoped ids, idle/running/stopping/stopped state, and stop/poison behavior.   

## Hard-cut principle

After this migration:

```text
apps/cloudflare does not construct HostedWorkspaceRuntimeJobOptions.
apps/cloudflare does not own checkpoint/mailbox runtime semantics.
apps/cloudflare passes platform adapters, roots, decoder, wake signal, and authority.
assistant-runtime owns the invocation behavior.
```

This is the core simplification.

# Final migration plan

## Step 0: Freeze the cut scope

This is a **Milestone 3 package-owned invocation hard cut**.

Do not touch:

```text
RunnerContainer lifecycle
container-entrypoint route topology
Warm Codex process state
Codex authority model
Temporal workflow ordering
write-fence protocol
runtime wake protocol
```

Do touch:

```text
apps/cloudflare/src/hosted-workspace-invocation.ts
apps/cloudflare/src/runtime-bridge-workspace.ts
packages/assistant-runtime/src/hosted-runtime/*
package exports/tests/docs
```

The cut succeeds only if behavior is preserved and ownership is simpler.

## Step 1: Add the package-owned invocation API

Add a new package module:

```text
packages/assistant-runtime/src/hosted-runtime/invocation.ts
```

Export:

```ts
export interface HostedInvocationAuthority {
  attemptId: string;
  leaseGeneration: string;
  userId: string;
  workspaceVersion: string;
}

export interface HostedInvocationRoots {
  vaultRoot: string;
}

export interface HostedInvocationBridge {
  consumePendingRuntimeWake?: () => boolean;
  decodeMailboxPayload: HostedWorkspaceMailboxPayloadDecoder;
  readCurrentLease?: () =>
    | HostedInvocationAuthority
    | null
    | Promise<HostedInvocationAuthority | null>;
  snapshotDiagnosticsHashSecret?: string | null;
}

export interface HostedWorkspaceInvocationInput {
  job: HostedAssistantWorkspaceRuntimeJobInput;
  authority: HostedInvocationAuthority;
  roots: HostedInvocationRoots;
  platform: HostedRuntimePlatform;
  runtimeWakeSignal: RuntimeWakeSignal;
  bridge: HostedInvocationBridge;
  signal?: AbortSignal | null;
}

export async function runHostedWorkspaceInvocation(
  input: HostedWorkspaceInvocationInput,
): Promise<HostedWorkspaceInvocationResult> {
  // build runtime job options
  // call runHostedWorkspaceRuntimeJobInProcess
}
```

Keep this API small. Do not introduce a giant `HostedInvocationScope` bag unless every field has a clear owner.

## Step 2: Move bridge semantics into assistant-runtime

Create:

```text
packages/assistant-runtime/src/hosted-runtime/invocation-bridge.ts
packages/assistant-runtime/src/hosted-runtime/snapshot-bridge.ts
packages/assistant-runtime/src/hosted-runtime/mailbox-bridge.ts
```

Move these out of `apps/cloudflare/src/runtime-bridge-workspace.ts`:

```text
HostedWorkspaceMailboxPayloadDecoder interface
createHostedWorkspaceRuntimeBridgeJobOptions
createHostedRuntimeBridgeLeaseFromWorkspaceRequest
checkpoint lease validation
idle_shutdown checkpoint request enforcement
mailbox import bridge construction
snapshot lifecycle/metric log construction
v2 snapshot orchestration
runtime wake interruption during snapshot/checkpoint
```

The existing Cloudflare bridge currently creates runtime job options directly. That exact semantic owner should move. 

The existing bridge also enforces idle-shutdown snapshot construction. Preserve that exactly in package code. 

## Step 3: Do not move Cloudflare transport into assistant-runtime

Do **not** move these into assistant-runtime:

```text
createCloudflareHostedProviderFetch
readCloudflareHostedProviderFetchBaseUrls
createCloudflareHostedMailboxPayloadDecoder
web-control base URLs / allowlist
Cloudflare internal hosts
Cloudflare write-fence transport
Cloudflare R2 transport implementation
container process cleanup
expected Codex root cleanup
```

The most important trap is mailbox payload decrypt. `runtime-bridge-workspace.ts` currently has a legacy decrypt path that reads hosted worker env, builds crypto env, fetches ingress root keys through web-control, and uses callback signing. That is Cloudflare/web-control transport, not assistant-runtime semantics. Keep it in Cloudflare behind a decoder interface. 

Package code should only see:

```ts
decodeMailboxPayload.decode(...)
```

It should not know how Cloudflare obtains root keys.

## Step 4: Move or neutralize snapshot-local helpers

The current snapshot bridge uses local snapshot archive helpers and runtime-state archive planning. The semantic snapshot orchestration should be package-owned; Cloudflare should not directly own archive/checkpoint behavior. 

There are two acceptable routes.

Preferred route:

```text
Move node-local snapshot archive helpers into @murphai/runtime-state/node
or assistant-runtime hosted-runtime/snapshot-bridge.
```

Fallback route for a smaller first cut:

```text
Keep only a narrow HostedWorkspaceSnapshotArchiveBuilder adapter in Cloudflare,
but move orchestration, lease checks, wake checks, and checkpoint session flow
into assistant-runtime.
```

Do not let `assistant-runtime` import from `apps/cloudflare`. That would invert the dependency and make the architecture worse.

## Step 5: Shrink Cloudflare hosted invocation adapter

After package extraction, `apps/cloudflare/src/hosted-workspace-invocation.ts` should become a thin adapter.

It should do only:

```text
resolve warmRoot / vaultRoot
clear browser-vault warm source state
build or validate runtime launch spec
rebind parser toolchain to container-image paths
create RuntimeWakeSignal
build Cloudflare HostedRuntimePlatform
build Cloudflare mailbox payload decoder
call assistant-runtime runHostedWorkspaceInvocation(...)
assert/parse result
```

It should stop doing:

```text
constructing HostedWorkspaceRuntimeJobOptions
constructing checkpoint snapshot behavior
owning mailbox import behavior
owning lease validation semantics
calling runHostedWorkspaceRuntimeJobInProcess directly
```

Current `hosted-workspace-invocation.ts` calls `runHostedWorkspaceRuntimeJobInProcess` directly; that should disappear. 

Target shape:

```ts
const result = await runHostedWorkspaceInvocation({
  job,
  authority: {
    attemptId: job.request.attemptId,
    leaseGeneration: job.request.leaseGeneration,
    userId: job.request.userId,
    workspaceVersion: job.request.workspaceVersion,
  },
  roots: {
    vaultRoot,
  },
  platform,
  runtimeWakeSignal,
  bridge: {
    consumePendingRuntimeWake: () => runtimeWakeSignal.consumePending(),
    decodeMailboxPayload,
    readCurrentLease: () => currentLease,
    snapshotDiagnosticsHashSecret:
      job.diagnostics?.workspaceSnapshotPathHashSecret ?? null,
  },
  signal: options.signal ?? null,
});
```

## Step 6: Delete or rename `runtime-bridge-workspace.ts`

After extraction, this file should not remain with its current name and semantic weight.

Either delete it or reduce it to a Cloudflare-specific adapter:

```text
apps/cloudflare/src/cloudflare-mailbox-payload-decoder.ts
apps/cloudflare/src/cloudflare-hosted-invocation-adapter.ts
```

Do not leave a file called `runtime-bridge-workspace.ts` in Cloudflare if it still owns checkpoint/mailbox runtime behavior. That name will attract future runtime semantics back into Cloudflare.

## Step 7: Add hard static guards

Add tests that fail if the boundary regresses:

```text
apps/cloudflare does not import runHostedWorkspaceRuntimeJobInProcess
apps/cloudflare does not construct HostedWorkspaceRuntimeJobOptions
apps/cloudflare/src/runtime-bridge-workspace.ts does not exist, or is adapter-only
apps/cloudflare does not import runtime-state/node snapshot archive planning directly
assistant-runtime does not import apps/cloudflare
assistant-runtime hosted invocation receives explicit roots/platform/decoder/signal
hosted invocation path does not use withHostedProcessEnvironment
```

A source-level test similar to the existing ambient env/cwd guard is appropriate.

## Step 8: Preserve exact behavior with focused tests

Before deleting the old Cloudflare bridge, add package tests for:

```text
create package invocation options from platform + roots + decoder
idle_shutdown-only snapshot request enforcement
runtime wake interrupt during snapshot
lease mismatch fails before snapshot
lease mismatch fails before direct R2 put
lease mismatch fails before web checkpoint
mailbox conversation import decode path
mailbox decode mismatch behavior
snapshot lifecycle logs remain metadata-only
snapshot temp directory cleanup
snapshot session abort on failure before checkpoint
localWorkspaceCleanForWarmReuse behavior
```

The checkpoint flow currently checks lease before snapshot, before direct R2 upload, and before web checkpoint. Preserve those stages.  

## Step 9: Keep rollout as a hard cut

Do not add a runtime flag.

This is package code motion plus ownership cleanup. Rollback remains:

```text
deploy previous known-good image
destroy affected warm containers
preserve durable checkpoint truth
```

No permanent fallback. No parallel invocation paths.

# Final guide text

## Goal

Move hosted invocation assembly out of Cloudflare and into assistant-runtime so Cloudflare is only a runner/platform adapter.

Final target:

```text
UserRunner DO
  -> RunnerContainer
    -> container-entrypoint
      -> Cloudflare adapter: routes, wake, platform ports, cleanup
      -> assistant-runtime: hosted invocation semantics
      -> assistant-engine: Warm Codex process semantics
```

## Success criteria

```text
- apps/cloudflare no longer constructs HostedWorkspaceRuntimeJobOptions.
- apps/cloudflare no longer calls runHostedWorkspaceRuntimeJobInProcess directly.
- apps/cloudflare no longer owns checkpoint/mailbox runtime bridge semantics.
- runtime-bridge-workspace.ts is deleted or Cloudflare-adapter-only.
- assistant-runtime exports package-owned runHostedWorkspaceInvocation(...).
- Cloudflare passes explicit platform, roots, authority, decoder, wake signal, and abort signal.
- Warm Codex remains assistant-engine-owned.
- RunnerContainer/container-entrypoint lifecycle behavior is unchanged.
- No feature flag or dual path is introduced.
```

## Implementation order

```text
1. Add assistant-runtime hosted invocation API.
2. Move runtime bridge/job-option construction into assistant-runtime.
3. Move checkpoint snapshot orchestration into assistant-runtime or runtime-state/node.
4. Keep Cloudflare mailbox decrypt/web-control/R2/fetch adapters in Cloudflare.
5. Replace Cloudflare direct call to runHostedWorkspaceRuntimeJobInProcess with package runHostedWorkspaceInvocation.
6. Delete or shrink apps/cloudflare/src/runtime-bridge-workspace.ts.
7. Add static boundary tests.
8. Run focused bridge, entrypoint, runtime, and Warm Codex tests.
9. Deploy as hard cut; rollback by previous image + warm-container reset.
```

## Files to create

```text
packages/assistant-runtime/src/hosted-runtime/invocation.ts
packages/assistant-runtime/src/hosted-runtime/invocation-bridge.ts
packages/assistant-runtime/src/hosted-runtime/snapshot-bridge.ts
packages/assistant-runtime/src/hosted-runtime/mailbox-bridge.ts
```

## Files to shrink/delete

```text
apps/cloudflare/src/hosted-workspace-invocation.ts
apps/cloudflare/src/runtime-bridge-workspace.ts
```

## Files to keep Cloudflare-owned

```text
apps/cloudflare/src/container-entrypoint.ts
apps/cloudflare/src/runner-container.ts
apps/cloudflare/src/runtime-platform.ts
apps/cloudflare/src/runtime-bridge-mailbox-payload-decode.ts
apps/cloudflare/src/runner-env.ts
apps/cloudflare/src/hosted-env-policy.ts
apps/cloudflare/src/runner-native-parser-toolchain.ts
```

## Package API

```ts
export interface HostedInvocationAuthority {
  attemptId: string;
  leaseGeneration: string;
  userId: string;
  workspaceVersion: string;
}

export interface HostedInvocationRoots {
  vaultRoot: string;
}

export interface HostedInvocationBridge {
  consumePendingRuntimeWake?: () => boolean;
  decodeMailboxPayload: HostedWorkspaceMailboxPayloadDecoder;
  readCurrentLease?: () =>
    | HostedInvocationAuthority
    | null
    | Promise<HostedInvocationAuthority | null>;
  snapshotDiagnosticsHashSecret?: string | null;
}

export interface HostedWorkspaceInvocationInput {
  job: HostedAssistantWorkspaceRuntimeJobInput;
  authority: HostedInvocationAuthority;
  roots: HostedInvocationRoots;
  platform: HostedRuntimePlatform;
  runtimeWakeSignal: RuntimeWakeSignal;
  bridge: HostedInvocationBridge;
  signal?: AbortSignal | null;
}

export async function runHostedWorkspaceInvocation(
  input: HostedWorkspaceInvocationInput,
): Promise<HostedWorkspaceInvocationResult>;
```

## Cloudflare adapter shape

```ts
export async function runCloudflareHostedWorkspaceInvocation(
  input: HostedExecutionWorkspaceInvocationJobInput,
  options: HostedWorkspaceInvocationOptions,
): Promise<HostedAssistantWorkspaceRuntimeJobResult> {
  const warmRoot = await resolveWarmRoot(input.request.userId);
  const vaultRoot = path.join(warmRoot, "durable", "vault");

  await clearHostedBrowserVaultWarmSourceStateHash({ vaultRoot });

  const job = {
    ...input,
    runtime: buildHostedExecutionJobRuntime({
      requestedRuntime: input.runtime ?? {},
      supervisorEnv: options.supervisorEnv,
    }),
  };

  const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
  options.onRuntimeWakeReady?.(() => {
    runtimeWakeSignal.notify();
    return true;
  });

  const lease = createMutableLease(job.request);
  const platform = buildCloudflarePlatform({ lease, job, supervisorEnv: options.supervisorEnv });
  const decodeMailboxPayload = createCloudflareHostedMailboxPayloadDecoder({ lease });

  const result = await runHostedWorkspaceInvocation({
    job,
    authority: {
      attemptId: job.request.attemptId,
      leaseGeneration: job.request.leaseGeneration,
      userId: job.request.userId,
      workspaceVersion: job.request.workspaceVersion,
    },
    roots: { vaultRoot },
    platform,
    runtimeWakeSignal,
    bridge: {
      consumePendingRuntimeWake: () => runtimeWakeSignal.consumePending(),
      decodeMailboxPayload,
      readCurrentLease: () => lease.current,
      snapshotDiagnosticsHashSecret:
        job.diagnostics?.workspaceSnapshotPathHashSecret ?? null,
    },
    signal: options.signal ?? null,
  });

  return assertHostedExecutionRunnerJobResult(result, job);
}
```

## Boundary tests

Add these as hard-cut tests:

```text
1. apps/cloudflare hosted invocation source does not contain runHostedWorkspaceRuntimeJobInProcess.
2. apps/cloudflare source does not construct HostedWorkspaceRuntimeJobOptions.
3. assistant-runtime hosted invocation source does not import apps/cloudflare.
4. runtime-bridge-workspace.ts is absent or contains only Cloudflare adapter names.
5. package invocation preserves browser-vault clearing via Cloudflare adapter.
6. package invocation preserves runtime wake pending/consume semantics.
7. package snapshot bridge preserves lease checks before snapshot, direct upload, and checkpoint.
8. package snapshot bridge aborts snapshot sessions on pre-checkpoint failure.
9. package mailbox bridge preserves conversation import behavior.
10. Cloudflare mailbox decoder remains the only code that reads Cloudflare web-control crypto env.
```

## Risk controls

### Main risk: dependency inversion

Do not let `assistant-runtime` import Cloudflare files. If a helper cannot move without importing `apps/cloudflare`, split it into:

```text
package-owned orchestration
Cloudflare-owned adapter
```

### Main risk: hidden behavior change in snapshot checkpointing

Snapshot logic is the riskiest part of the move. Preserve:

```text
idle_shutdown-only construction
lease check before snapshot
lease check before direct object upload
runtime wake check before checkpoint
lease check before web checkpoint
snapshot session abort on failure
legacy refs cleanup
localWorkspaceCleanForWarmReuse
metadata-only logs
```

### Main risk: over-abstraction

Do not add:

```text
HostedRuntimeService
HostedInvocationManager
RuntimeBridgeCoordinator
CloudflareRuntimeService
```

The package function is the abstraction. Everything else should be a helper.

## Definition of done

The migration is complete when:

```text
container-entrypoint owns routes, active slot, wake state, aborts, cleanup
RunnerContainer owns container lifecycle
apps/cloudflare owns concrete platform adapters
assistant-runtime owns hosted invocation assembly
assistant-engine owns Warm Codex process state
```

Mechanically:

```text
apps/cloudflare/src/hosted-workspace-invocation.ts is a thin adapter
apps/cloudflare/src/runtime-bridge-workspace.ts is deleted or adapter-only
apps/cloudflare does not call runHostedWorkspaceRuntimeJobInProcess
apps/cloudflare does not construct HostedWorkspaceRuntimeJobOptions
assistant-runtime exports runHostedWorkspaceInvocation(...)
all lifecycle behavior remains unchanged
```

## My final recommendation

Do this as the next cleanup, but keep it narrow. The correct hard cut is not “another migration framework.” It is:

```text
move hosted invocation semantics into assistant-runtime
leave Cloudflare with transport/platform/lifecycle only
delete the ambiguous Cloudflare runtime bridge owner
```

That is worth it because it removes the last major ownership ambiguity left after direct runtime and Warm Codex.
