# Package-Owned Hosted Invocation Migration Guide

## Status

This guide is for the current `main` branch after the direct-runtime and hosted Warm Codex milestones have already landed. It replaces the older lifecycle guide language that still discusses deleting the per-run Node child, adding a direct-runtime flag, introducing a generic managed-process registry, or keeping Codex single-use as the target.

The remaining simplification is narrower:

```text
Move hosted invocation semantics out of apps/cloudflare and into packages/assistant-runtime.
Leave apps/cloudflare as the container/platform/transport adapter.
Leave packages/assistant-engine as the Warm Codex process owner.
```

This is a hard-cut ownership cleanup, not a new lifecycle subsystem.

Completion note: the hard cut is landed. Cloudflare calls the package-owned
hosted invocation facade, bridge construction is internal/test-only,
runtime wake and current-lease boundaries are required, and checkpoint lease
validation includes workspace version. Verification passed with focused
assistant-runtime tests, full Cloudflare node tests, Cloudflare
`verify:parallel`, workspace boundary checks, repo `pnpm typecheck`, and
`git diff --check`.

---

## Current architecture on `main`

Current steady state is effectively:

```text
UserRunner DO
  -> warm RunnerContainer
    -> container-entrypoint
      -> apps/cloudflare/src/hosted-workspace-invocation.ts
        -> apps/cloudflare/src/runtime-bridge-workspace.ts
          -> packages/assistant-runtime/runHostedWorkspaceRuntimeJobInProcess(...)
            -> packages/assistant-engine hosted Warm Codex
```

The old per-invocation Node child path is already gone from active production source. Warm Codex is already owned by assistant-engine. RunnerContainer and container-entrypoint already own lifecycle, wake routing, abort handling, process cleanup, and warm-container recycling.

The remaining problem is that `apps/cloudflare` still owns too much hosted runtime behavior:

```text
runtime job option construction
checkpoint snapshot orchestration
idle_shutdown checkpoint semantics
mailbox import bridge behavior
lease checks during checkpoint
runtime wake interruption during snapshot/checkpoint
direct call into runHostedWorkspaceRuntimeJobInProcess(...)
```

Those are Murph hosted runtime semantics, not Cloudflare platform concerns.

---

## Final target

```text
UserRunner DO
  -> warm RunnerContainer
    -> container-entrypoint active invocation slot
      -> Cloudflare adapter
          routes, request parsing, active slot, abort, wake route,
          platform ports, mailbox decoder, process cleanup
      -> assistant-runtime runHostedWorkspaceInvocation(...)
          hosted invocation assembly, mailbox/checkpoint bridge,
          idle_shutdown checkpoint semantics, runtime wake/checkpoint interaction
      -> assistant-engine Warm Codex
          app-server process, RPC state, turn correlation, expected root snapshot
```

The key invariant:

```text
Cloudflare owns transport and lifecycle.
assistant-runtime owns hosted invocation semantics.
assistant-engine owns Codex process semantics.
```

---

## Non-goals

Do not add:

```text
feature flag or dual path
new Cloudflare runtime service wrapper
generic managed-process registry
new queue/scheduler/demand owner
long-lived CLI bridge
new Warm Codex lifecycle path
cross-invocation Codex authority redesign
Temporal workflow changes
write-fence protocol changes
runtime wake protocol changes
```

This migration should delete ownership ambiguity. It should not introduce another manager.

---

## Hard-cut success criteria

After the cut:

```text
apps/cloudflare no longer imports runHostedWorkspaceRuntimeJobInProcess.
apps/cloudflare no longer constructs HostedWorkspaceRuntimeJobOptions.
apps/cloudflare no longer owns checkpoint/mailbox runtime bridge semantics.
apps/cloudflare/src/runtime-bridge-workspace.ts is deleted or adapter-only.
assistant-runtime exports package-owned runHostedWorkspaceInvocation(...).
Cloudflare passes explicit platform, vaultRoot, mailbox decoder, wake signal, lease reader, and abort signal.
Warm Codex remains assistant-engine-owned.
RunnerContainer/container-entrypoint lifecycle behavior is unchanged.
No runtime flag, fallback matrix, or parallel invocation path is introduced.
```

---

## The most important correction to the previous draft

Do **not** pass a separate `authority` object to the package invocation API.

The job already carries:

```text
job.request.attemptId
job.request.leaseGeneration
job.request.userId
job.request.workspaceVersion
```

Duplicating those fields as a separate `HostedInvocationAuthority` creates a stale-field hazard where `job.request` and `authority` can disagree. The package should derive immutable starting authority from `job.request`.

If mutable authority is needed after checkpoints, pass a **lease reader** capability:

```ts
type HostedInvocationLeaseReader = () =>
  | HostedInvocationLease
  | null
  | Promise<HostedInvocationLease | null>;
```

That reader reflects the active write-fenced lease after Cloudflare platform checkpoint callbacks update the current workspace version.

---

## Package API

Create a focused package module, preferably with a dedicated public subpath:

```text
packages/assistant-runtime/src/hosted-runtime/invocation.ts
```

Add package export:

```json
{
  "exports": {
    "./hosted-invocation": {
      "types": "./dist/hosted-invocation.d.ts",
      "import": "./dist/hosted-invocation.js",
      "default": "./dist/hosted-invocation.js"
    }
  }
}
```

Use a small API:

```ts
export interface HostedInvocationLease {
  attemptId: string;
  leaseGeneration: string;
  userId: string;
  workspaceVersion: string;
}

export interface HostedWorkspaceMailboxPayloadDecoder {
  decode(
    input: HostedWorkspaceMailboxPayloadDecodeInput,
  ): Promise<HostedWorkspaceMailboxPayloadDecodeResult>;
}

export interface HostedWorkspaceInvocationInput {
  job: HostedAssistantWorkspaceRuntimeJobInput;
  platform: HostedRuntimePlatform;
  vaultRoot: string;
  mailboxPayloadDecoder: HostedWorkspaceMailboxPayloadDecoder;
  runtimeWakeSignal: RuntimeWakeSignal;
  readCurrentLease: (() =>
    | HostedInvocationLease
    | null
    | Promise<HostedInvocationLease | null>);
  snapshotDiagnosticsHashSecret?: string | null;
  signal?: AbortSignal | null;
}

export async function runHostedWorkspaceInvocation(
  input: HostedWorkspaceInvocationInput,
): Promise<HostedWorkspaceInvocationResult>;
```

Why this shape:

```text
job.request is the immutable invocation authority.
readCurrentLease is the mutable write-fence/current-version view.
vaultRoot is the only root the runtime bridge needs directly.
platform owns artifact/workspace/mailbox/device/effects ports.
mailboxPayloadDecoder hides Cloudflare-specific decrypt/web-control transport.
runtimeWakeSignal is the single wake source; package code can derive consumePendingRuntimeWake from it.
signal is the host abort boundary.
```

Avoid a large `HostedInvocationScope` bag unless a field has an actual owner and consumer.

---

## New package internals

Start with **two** new internal modules, not four:

```text
packages/assistant-runtime/src/hosted-runtime/invocation.ts
packages/assistant-runtime/src/hosted-runtime/invocation-bridge.ts
```

Split a third module only if the file becomes too large:

```text
packages/assistant-runtime/src/hosted-runtime/snapshot-bridge.ts
```

Avoid creating a file-per-concept taxonomy up front. Fewer files are easier to maintain until size forces a split.

Move from `apps/cloudflare/src/runtime-bridge-workspace.ts` into assistant-runtime:

```text
createHostedWorkspaceRuntimeBridgeJobOptions
createHostedRuntimeBridgeLeaseFromWorkspaceRequest
idle_shutdown-only checkpoint request enforcement
checkpoint lease validation
mailbox import bridge construction
snapshot session orchestration
snapshot lifecycle/metric log construction
runtime wake interruption during snapshot/checkpoint
localWorkspaceCleanForWarmReuse behavior
```

The package-owned `runHostedWorkspaceInvocation(...)` owns the bridge option
assembly. The public invocation facade stays narrow; bridge construction stays
internal, with test-only access through a dedicated testkit subpath.

```ts
export async function runHostedWorkspaceInvocation(
  input: HostedWorkspaceInvocationInput,
): Promise<HostedWorkspaceInvocationResult> {
  const jobOptions = createHostedWorkspaceRuntimeBridgeJobOptions({
    consumePendingRuntimeWake: () => input.runtimeWakeSignal.consumePending(),
    platform: input.platform,
    request: input.job.request,
    runtime: input.job.runtime ?? {},
    vaultRoot: input.vaultRoot,
    decodeMailboxPayload: input.mailboxPayloadDecoder,
    readCurrentLease: input.readCurrentLease,
    snapshotArchiveBuilder: input.snapshotArchiveBuilder,
    snapshotDiagnosticsHashSecret: input.snapshotDiagnosticsHashSecret ?? null,
  });

  return await runHostedWorkspaceRuntimeJobInProcess(input.job, {
    ...jobOptions,
    runtimeWakeSignal: input.runtimeWakeSignal,
    signal: input.signal ?? null,
  });
}
```

The bridge should derive:

```ts
consumePendingRuntimeWake: () => input.runtimeWakeSignal.consumePending()
```

Do not pass both `runtimeWakeSignal` and `consumePendingRuntimeWake` from Cloudflare. That duplicates one source of truth.

---

## What must stay in Cloudflare

Keep Cloudflare-specific transport and lifecycle in `apps/cloudflare`:

```text
container-entrypoint.ts
runner-container.ts
runtime-platform.ts
runtime-bridge-mailbox-payload-decode.ts
runner-env.ts
hosted-env-policy.ts
runner-native-parser-toolchain.ts
internal-hosts.ts
web-control-plane.ts
runner-outbound/*
```

Specifically, do not move these into assistant-runtime:

```text
createCloudflareHostedProviderFetch
readCloudflareHostedProviderFetchBaseUrls
createCloudflareHostedMailboxPayloadDecoder
Cloudflare web-control base URLs and allowlists
write-fence HTTP/header transport
Cloudflare R2/direct upload transport implementation
container /proc cleanup
expected Warm Codex root cleanup
RunnerContainer lifecycle
```

### Important simplification: delete the legacy decoder fallback from the package path

`runtime-bridge-workspace.ts` currently contains a legacy mailbox decrypt fallback that can read hosted worker env, build crypto env, call web-control, and fetch ingress root keys. In the current direct hosted path, Cloudflare passes an explicit decoder and sets `requireMailboxPayloadDecoder: true`.

The package-owned invocation should require an explicit `mailboxPayloadDecoder`. Do not move the legacy decrypt fallback into assistant-runtime. If any non-Cloudflare tests use the fallback, convert them to pass a fake decoder.

This keeps assistant-runtime from learning Cloudflare web-control crypto transport.

---

## Snapshot bridge relocation

The snapshot bridge is the riskiest part of the move because it currently uses helper modules under `apps/cloudflare`:

```text
workspace-snapshot-local.ts
workspace-snapshot-cleanup.ts
legacy-workspace-snapshot-materialization.ts
hosted-bundle-validation.ts
hosted-runtime-redaction.ts
```

Do not let assistant-runtime import these through relative paths or app package paths.

Use one of these approaches:

### Preferred

Move runtime-generic helpers into package-owned modules:

```text
packages/assistant-runtime/src/hosted-runtime/snapshot-bridge.ts
packages/runtime-state/src/node/... if the helper is generic archive/runtime-state logic
```

### Acceptable first cut

If a helper is still Cloudflare-specific, keep it behind a narrow capability passed from Cloudflare:

```ts
export interface HostedWorkspaceSnapshotArchiveBuilder {
  buildEncryptedSnapshot(input: HostedWorkspaceSnapshotArchiveBuildInput):
    Promise<HostedWorkspaceSnapshotArchiveBuildResult>;
  cleanupTemporaryDirectory(path: string): Promise<void>;
}
```

But do not pass a broad service object. Prefer moving generic code.

Preserve exact snapshot invariants:

```text
idle_shutdown-only checkpoint construction
lease check before snapshot planning
lease check before direct object upload
runtime wake check before web checkpoint
lease check before web checkpoint
snapshot session abort on pre-checkpoint failure
legacy refs materialization/cleanup behavior
localWorkspaceCleanForWarmReuse calculation
metadata-only lifecycle/metric logs
temporary directory cleanup
```

---

## Cloudflare adapter after migration

Rename the Cloudflare wrapper to make ownership explicit:

```text
apps/cloudflare/src/cloudflare-hosted-workspace-invocation.ts
```

or keep the filename but make the function name explicit:

```ts
runCloudflareHostedWorkspaceInvocation(...)
```

The adapter should only:

```text
resolve warmRoot / vaultRoot
ensure warm launcher directories and permissions
clear browser-vault warm source state
build/validate runtime launch spec from request + frozen supervisor env
rebind native parser toolchain to container-image paths
create RuntimeWakeSignal
build Cloudflare HostedRuntimePlatform
build Cloudflare mailbox payload decoder
call assistant-runtime runHostedWorkspaceInvocation(...)
assert/parse result
```

It should not:

```text
construct HostedWorkspaceRuntimeJobOptions
call runHostedWorkspaceRuntimeJobInProcess
own checkpoint snapshot orchestration
own mailbox import behavior
own lease validation semantics
own snapshot lifecycle logs
own runtime wake/checkpoint semantics
```

Target adapter shape:

```ts
const result = await runHostedWorkspaceInvocation({
  job,
  platform,
  vaultRoot,
  mailboxPayloadDecoder: decodeMailboxPayload,
  runtimeWakeSignal,
  readCurrentLease: () => currentLease,
  snapshotDiagnosticsHashSecret:
    job.diagnostics?.workspaceSnapshotPathHashSecret ?? null,
  signal: options.signal ?? null,
});
```

---

## Warm launcher roots

Current code still creates:

```text
home
cache
tmp
hf-home
```

Do not delete these in this migration. They were preserved intentionally as non-lifecycle side effects of the old runner. Removing them is a separate root audit.

For this hard cut:

```text
keep warm root hashing
keep safe 0700 directory creation
keep vaultRoot = warmRoot/durable/vault
do not add new root concepts
```

After the package-owned invocation cut is stable, separately audit whether `home`, `cache`, `tmp`, and `hf-home` still have users. Delete unused roots only with focused tests.

---

## Import-boundary policy

Current `main` already has a boundary rule that prevents most Cloudflare source from importing assistant-engine or operator-config internals directly, except the narrow hosted Codex lifecycle import in `container-entrypoint.ts`.

Preserve and extend this approach:

```text
apps/cloudflare may import assistant-runtime hosted-invocation surface.
apps/cloudflare may import assistant-engine hosted-codex-lifecycle only from container-entrypoint.
assistant-runtime must not import apps/cloudflare.
assistant-runtime should use explicit focused operator-config subpaths, not broad root barrels.
```

Add source guards:

```text
apps/cloudflare does not import runHostedWorkspaceRuntimeJobInProcess
apps/cloudflare does not import HostedWorkspaceRuntimeJobOptions
apps/cloudflare does not import @murphai/runtime-state/node snapshot planning directly
apps/cloudflare/src/runtime-bridge-workspace.ts is absent or adapter-only
packages/assistant-runtime/src does not import apps/cloudflare
packages/assistant-runtime/src does not import Cloudflare internal-host/web-control files
```

---

## Hard-cut implementation order

### Step 1: Add package API and exports

Add:

```text
packages/assistant-runtime/src/hosted-runtime/invocation.ts
packages/assistant-runtime/src/hosted-invocation.ts       // public re-export if preferred
package.json export "./hosted-invocation"
package.json export "./hosted-checkpoint-bridge"          // web checkpoint bridge only
package.json export "./hosted-invocation-testkit"         // bridge construction tests only; blocked in non-test files
```

Keep the first implementation thin and tested.

### Step 2: Move bridge semantics

Move runtime-generic parts of `runtime-bridge-workspace.ts` into assistant-runtime.

Delete or avoid moving:

```text
legacy mailbox decrypt fallback
Cloudflare web-control env reading
Cloudflare callback signing
Cloudflare internal host allowlists
```

### Step 3: Move snapshot helpers or introduce narrow archive capability

Move generic snapshot orchestration and helpers to package code. If a helper cannot move without importing Cloudflare, define a narrow capability instead of a service object.

### Step 4: Update Cloudflare adapter

Replace:

```ts
createHostedWorkspaceRuntimeBridgeJobOptions(...)
runHostedWorkspaceRuntimeJobInProcess(...)
```

with:

```ts
runHostedWorkspaceInvocation(...)
```

Keep runtime env projection and parser toolchain rebinding in Cloudflare for this cut.

### Step 5: Delete or reduce `runtime-bridge-workspace.ts`

The file should either be gone or renamed/reduced to Cloudflare-only adapter glue.

Do not keep a semantically heavy `runtime-bridge-workspace.ts` in `apps/cloudflare`; it will attract future runtime behavior back into the app.

### Step 6: Add static boundary tests

Add tests for the import and source guards above.

### Step 7: Add package behavior tests

Add focused package tests for:

```text
package invocation creates equivalent HostedWorkspaceRuntimeJobOptions
runtime wake interrupts snapshot/checkpoint
idle_shutdown-only snapshot enforcement
lease mismatch before snapshot
lease mismatch before direct upload
lease mismatch before web checkpoint
snapshot session abort before checkpoint
localWorkspaceCleanForWarmReuse
mailbox conversation import decode path
mailbox decode mismatch behavior
metadata-only snapshot logs
temporary directory cleanup
```

### Step 8: Run existing lifecycle tests

Run:

```text
apps/cloudflare container-entrypoint tests
apps/cloudflare hosted-workspace-invocation tests
assistant-runtime hosted-runtime tests
assistant-engine Warm Codex tests
workspace-boundary import policy tests
hosted-local smoke/E2E if available
```

### Step 9: Hard cut deploy

No runtime flag. No fallback path.

Rollback:

```text
redeploy previous known-good image
destroy affected warm containers
preserve durable checkpoint truth
```

---

## Definition of done

```text
Cloudflare:
  owns routes, active slot, wake route, abort, platform ports, decoder, cleanup.

assistant-runtime:
  owns hosted invocation assembly, mailbox bridge, checkpoint bridge, runtime semantics.

assistant-engine:
  owns Warm Codex process state.

apps/cloudflare:
  does not construct HostedWorkspaceRuntimeJobOptions.
  does not call runHostedWorkspaceRuntimeJobInProcess.
  does not own checkpoint/mailbox semantics.
  does not import runtime-state/node snapshot archive planning.
  does not expose Cloudflare web-control crypto to assistant-runtime.

assistant-runtime:
  exports runHostedWorkspaceInvocation(...)
  accepts explicit platform, vaultRoot, decoder, wake signal, lease reader, abort signal.
  does not import apps/cloudflare.
```

---

## Final simplifications versus the previous guide

```text
Removed duplicate HostedInvocationAuthority input.
Removed ManagedProcessRegistry language; Warm Codex already has expected-root hooks.
Removed feature flag / dual-path rollout.
Removed memory-threshold recycle from this migration; count-based recycle already exists.
Removed old Node child deletion steps; already done on main.
Removed Codex authority redesign; separate future project.
Removed broad HostedInvocationScope bag.
Reduced proposed new files from four to two initially.
Required explicit mailbox decoder; no legacy Cloudflare decrypt fallback in package code.
Kept warm launcher root deletion out of scope.
```

---

## Final recommendation

Ship this as a focused Milestone 3 hard cut:

```text
Move hosted invocation semantics into assistant-runtime.
Keep Cloudflare transport/lifecycle only.
Keep Warm Codex untouched.
Delete or shrink the Cloudflare runtime bridge owner.
```

This is worthwhile because it removes the last major ownership ambiguity left after direct runtime and Warm Codex. It is not worthwhile if it becomes a framework rewrite, a second lifecycle owner, or a broad Cloudflare/runtime service abstraction.
Status: completed
Updated: 2026-06-02
Completed: 2026-06-02
