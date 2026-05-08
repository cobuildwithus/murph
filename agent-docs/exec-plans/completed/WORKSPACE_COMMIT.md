# Working Workspace Commit + Async Dashboard Replica

Status: completed
Updated: 2026-05-08

## Goal

Land one simple hosted persistence model:

```txt
bootstrap/no base      -> full/base seed
correctness barrier    -> working workspace commit
idle/off-path work     -> full/base compaction
legacy base+hot        -> restore compatibility only
dashboard freshness    -> async browser-vault replica refresh
```

North star:

```txt
A checkpoint commits durable portable workspace state.
A browser-vault replica materializes dashboard-readable derived data.
The two are related, but never the same operation.
```

Do not build a new journal system. Do not make browser-vault part of foreground durability.

## Final Mental Model

```txt
WorkspaceCommit
  correctness / durability
  foreground when needed
  CASes snapshotRef

DashboardReplica
  derived read model
  async/background
  updates browserVaultReplicaRef only

FullSnapshot
  seed or compaction
  cold restore optimization
```

Delete the old mental model:

```txt
reason -> hot/full/layered/fallback/browser-vault/codex-special-case
```

Replace it with:

```txt
does this need durable correctness?
  yes -> working commit

does the website need fresher derived data?
  yes -> schedule browser-vault refresh

are we idle?
  yes -> full/base compaction
```

## Core Invariants

```txt
1. Local Murph owns semantics.
2. Working commits persist the effective portable workspace.
3. Browser-vault is derived from committed workspace state.
4. Browser-vault refresh never blocks assistant response, delivery, or next-message import.
5. Full/base snapshots are seed/compaction only.
6. Legacy base+hot is restore compatibility only.
7. Checkpoint reason is an observability label, not a durability policy.
```

## Commit Kinds

Use this policy exactly:

```txt
current snapshot has no base:
  full_seed

reason is idle_shutdown:
  full_compaction, unless pending_nudge

reason is any correctness barrier:
  working_commit

reason is metadata-only:
  reuse snapshotRef and CAS metadata

legacy layered base+hot:
  restore compatibility only
  next correctness barrier writes working ref

browser-vault refresh:
  separate async derived-data refresh
```

Correctness barriers:

```txt
import
active_turn_input
active_turn_acceptance
outbox_sending
outbox_receipt
activation_bootstrap after base exists
canonical_runtime_commit
assistant_runtime_commit
provider_cleanup
system_mailbox_receipt
```

## Browser-Vault Final Design

### Replace the old browser-vault rule

Do not use this as the final rule:

```txt
working commit -> force-clear every browserVaultReplicaRef forever
```

That is safe, but it gives poor dashboard UX because the website cannot reflect phone/model writes until full compaction or another refresh mechanism.

Use this instead:

```txt
working commit:
  must not create or publish a browser-vault replica inline
  may leave the previous browserVaultReplicaRef in place as stale derived data
  schedules async refresh after successful commit

browser-vault refresh:
  generates a new replica from the latest committed workspace
  publishes browserVaultReplicaRef only if the committed source state still matches
```

This keeps the assistant path fast while allowing read-your-writes dashboard freshness shortly after commit.

Materialized-view framing applies here: browser-vault is a copy of query results derived from committed workspace state. Updating that view inline would make foreground writes more expensive, so the source commit must happen first and the derived view refresh separately.

### Source identity

Define one helper:

```ts
function readBrowserVaultSourceStateHash(
  snapshotRef: HostedExecutionSnapshotRefState,
): string | null {
  return readHostedExecutionSnapshotDeltaRef(snapshotRef)?.hash
    ?? readHostedExecutionSnapshotBaseRef(snapshotRef)?.hash
    ?? null;
}
```

Source identity:

```txt
full/base ref:
  sourceStateHash = base.hash

working ref:
  sourceStateHash = delta.hash
```

The browser-vault session handler already effectively uses `delta.hash ?? base.hash` to compare the workspace snapshot and replica source hash. Keep that shape, but name it `browser-vault source state hash` in code/docs so nobody treats the delta bundle alone as the whole vault.

### Browser-vault publish API

Add a narrow publish path separate from checkpointing:

```ts
publishHostedBrowserVaultReplicaRef({
  userId,
  expectedSourceStateHash,
  replicaRef,
})
```

Rules:

```txt
- replicaRef.sourceBundleHash must equal expectedSourceStateHash
- current readBrowserVaultSourceStateHash(snapshotRef) must equal expectedSourceStateHash
- updateMany uses the row version read inside the transaction only as an optimistic race guard
- update browserVaultReplicaRef only
- do not increment workspace.version
- do not change snapshotRef
```

Not incrementing `workspace.version` is important. Browser-vault is derived state; publishing it should not cause workspace CAS conflicts with real working commits.
Do not require the originally scheduled workspace version to still match. Metadata-only checkpoints can advance `workspace.version` without changing durable workspace content, and a replica is still valid when the current source state hash is unchanged.

### Background refresh algorithm

After a successful working commit:

```txt
1. preserve durable correctness path
2. continue assistant flow / delivery / next nudge
3. mark or schedule browser-vault refresh for sourceStateHash H
4. run refresh only when it does not block foreground work
```

Refresh has two paths:

```txt
warm path:
  use existing local vault in the runner container
  generate browser-vault replica
  write encrypted replica
  publish ref if sourceStateHash still matches

cold path:
  restore committed snapshotRef to temp root
  generate browser-vault replica
  write encrypted replica inside the runtime boundary
  return only replicaRef, byteLength, and status across the container boundary
  publish ref if sourceStateHash still matches
```

Warm path gives effectively immediate dashboard updates when the container is still alive. Cold path gives recovery when the warm refresh was missed.
Browser-vault replica writes are capped at 50 MiB; oversized detached refreshes degrade with `refresh_failed_too_large`, clear the pending refresh, and must not hot-loop or block foreground work.

### Scheduling

Use two triggers, but keep the implementation small:

```txt
after successful working commit:
  runner schedules low-priority dashboard refresh

when browser session route sees stale/missing replica:
  web best-effort asks Cloudflare to schedule dashboard refresh
```

Avoid a new table unless the existing coordination surface truly cannot carry this. Use Durable Object coordination metadata if needed:

```ts
pendingBrowserVaultRefresh: {
  sourceStateHash: string;
} | null
```

That is coordination state, not a journal. Use one replaceable pending slot, not a queue: latest source state wins.

### Browser session response semantics

Current client/server already support `empty`, `not_modified`, and `ready` browser-vault session states. Extend the response with freshness metadata:

```ts
type BrowserVaultFreshness = "fresh" | "stale";

type BrowserVaultSessionResponse =
  | {
      state: "empty";
      freshness: "stale";
      refreshPending: boolean;
      workspaceVersion: string | null;
    }
  | {
      state: "not_modified";
      replicaRef: HostedBrowserVaultReplicaRef;
      freshness: BrowserVaultFreshness;
      refreshPending: boolean;
      workspaceVersion: string;
    }
  | {
      state: "ready";
      replicaRef: HostedBrowserVaultReplicaRef;
      encryptedReplica: HostedCipherEnvelope;
      replicaAad: BrowserVaultReplicaAad;
      replicaKeyEnvelope: HostedBrowserSessionKeyEnvelope;
      freshness: BrowserVaultFreshness;
      refreshPending: boolean;
      workspaceVersion: string;
    };
```

Add a request feature flag before returning stale replicas:

```ts
{
  browserPublicKeyJwk,
  knownReplicaRef,
  acceptStaleReplica: true,
}
```

Session route behavior:

```txt
replicaRef.sourceBundleHash === currentSourceStateHash:
  freshness = fresh
  return ready / not_modified

replicaRef exists but source hash is stale and acceptStaleReplica === true:
  freshness = stale
  return stale ready / stale not_modified
  schedule refresh best-effort

replicaRef exists but source hash is stale and acceptStaleReplica !== true:
  return empty + refreshPending=true
  schedule refresh best-effort

no replicaRef:
  return empty + refreshPending=true
  schedule refresh best-effort
```

Do not return stale data as fresh. That is the important read-your-writes UX guard.
Do not return stale replicas to older cached browser clients that did not opt in with `acceptStaleReplica`.

### Website UX

```txt
fresh:
  show dashboard normally

stale:
  show existing dashboard
  show small "Syncing latest changes..." indicator
  poll refresh every 1-2 seconds for a short window
  refresh on window focus

empty + refreshPending:
  show "Preparing dashboard..." or skeleton
  poll briefly

fresh new replica arrives:
  swap query client
  clear syncing state
```

Expected behavior:

```txt
phone/model write commits
user opens website immediately
website either already shows new data
or shows old data clearly marked syncing
then updates within seconds
```

## Required Architecture Changes

### 1. Working foreground commits must not publish browser-vault

Foreground working commit returns:

```ts
{
  snapshotRef: workingRef,
  // no new browserVaultReplicaRef
}
```

It must not generate browser-vault. It must not call browser-vault sidecar writes. It must not wait for dashboard projection.

The previous `browserVaultReplicaRef` may remain in the workspace row as stale derived data. The session route decides freshness by comparing source hashes.

### 2. Add async browser-vault refresh publish path

Add a separate mutation from workspace checkpoint:

```ts
publishBrowserVaultReplicaRef(...)
```

It does not increment workspace version. It only updates the derived read-model ref if current workspace state still matches.

This avoids turning dashboard refresh into another checkpoint reason.

### 3. Split full seed from full compaction

Use two named paths:

```ts
createFullSeed()
createFullCompaction()
```

Policy:

```txt
createFullSeed:
  writes base bundle only
  no browser-vault
  foreground only when no base exists

createFullCompaction:
  writes base bundle
  may regenerate browser-vault
  idle/off-path only
```

A first foreground message should not pay dashboard sidecar latency.

### 4. Remove remote lease checks from file walking

Remote Durable Object lease checks belong at publication boundaries only:

```txt
before local commit build:
  remote lease check

during file scan/delta build:
  no remote Durable Object calls
  local abort signal only

before R2 write or web checkpoint:
  remote lease check

after stale lease:
  discard unpublished bundle/ref
```

Foreground working commits must not pass remote `assertSnapshotLive` into per-file walkers.

### 5. Build working deltas directly

Do not implement a working commit by creating a full current snapshot and diffing it.

Add or finish:

```ts
snapshotHostedPortableWorkspaceDelta({
  baseManifest,
  currentVaultRoot,
  currentOperatorHomeRoot,
  artifactRefProvider,
  artifactSink,
  materializedArtifactPaths,
})
```

It scans current portable files, compares to base manifest, and emits one delta bundle directly.

### 6. Externalized artifact deletion must be explicit

Rules:

```txt
If base artifact was not materialized locally:
  carry it forward unless a known live-path/prune decision says deleted.

If base artifact was materialized locally:
  if file exists and hash matches -> carry/reuse
  if file exists and hash changed -> upsert new artifact
  if file missing -> tombstone
```

The builder needs:

```ts
materializedArtifactPaths: Set<"root:path">
```

or equivalent manifest-prune signal.

### 7. Replace working deltas, never chain them

If current ref is:

```ts
{ schema: "murph.hosted-execution-working-snapshot.v1", base, delta }
```

the next working commit writes:

```txt
{ base, delta: replacementDelta }
```

Never:

```txt
base + delta1 + delta2
```

Always diff current live effective workspace against the original base manifest.

### 8. Allow metadata-only checkpoints

Some checkpoint requests only update wake/status metadata.

Use:

```ts
type WorkingCommitResult =
  | { kind: "changed"; snapshotRef: HostedExecutionWorkingSnapshotRef }
  | { kind: "unchanged"; snapshotRef: HostedExecutionSnapshotRef };
```

No empty delta bundle.

### 9. Keep mailbox rollback semantics

Mailbox import remains:

```txt
fetch mailbox rows
write local import state
checkpoint
rollback local state if checkpoint fails
```

Do not replace this with a journal.

### 10. Keep outbox side-effect ordering

Do not change:

```txt
prepare delivery side effects
checkpoint outbox_sending
send provider messages after checkpoint
checkpoint outbox_receipt / provider_cleanup after delivery
```

Only change the checkpoint primitive underneath.

### 11. Treat R2 writes as content-addressed pre-CAS objects

```txt
R2 write before CAS is allowed.
CAS conflict leaves content-addressed orphan.
Background sweeper may clean it later.
Foreground path never waits for cleanup.
```

### 12. Restore cache must be disposable and manifest-verified

For working refs, cache hit only if:

```txt
base snapshot hash matches
base snapshot size matches
base manifest hash matches
delta snapshot hash matches
delta manifest/effective manifest hash matches
```

Simpler initial option:

```txt
disable working-ref restore cache
restore cleanly for working refs until correctness is proven
```

### 13. Pending nudge preempts optional work

When `pending_nudge` is true:

```txt
skip browser-vault refresh
skip idle compaction
skip diagnostics/status-only commit
skip best-effort cleanup not required for side-effect safety
```

Do not skip:

```txt
outbox_sending working commit before provider send
outbox_receipt/failure working commit after provider send
```

### 14. Canonical payload uploads are not durability

```txt
canonical payload artifact uploaded
+ working commit CAS succeeds
= durable canonical write

canonical payload artifact uploaded
+ working commit CAS fails
= orphan payload only, no durable canonical write
```

No foreground compensating deletes.

### 15. Hot production must be unreachable

Keep legacy hot restore compatibility. Do not produce legacy hot refs for new correctness barriers.

Preferred:

```txt
remove legacy_hot from producer decision enum
```

### 16. Browser-vault refresh must stay source-state scoped

Use `sourceStateHash` as the freshness and dedupe contract:

```txt
refresh scheduling:
  sourceStateHash only

publish guard:
  current sourceStateHash equals expectedSourceStateHash
  replicaRef.sourceBundleHash equals expectedSourceStateHash

metadata-only checkpoints:
  do not schedule refresh
```

Do not add a browser-vault table, journal, checkpoint reason, or workspace-version publish requirement.

## Browser-Vault Edge Cases

### User writes new sauna session, opens site immediately

Expected:

```txt
working commit succeeds
dashboard refresh scheduled
site opens before refresh completes
session route returns stale existing replica + refreshPending
UI shows old data with syncing indicator
poll sees fresh replica
sauna session appears
```

### User writes new APOB number, warm container still alive

Expected:

```txt
working commit succeeds
warm background refresh runs from local vault
publishBrowserVaultReplicaRef succeeds
site opens and immediately receives fresh replica
```

### Refresh races with another working commit

```txt
refresh generated for source hash H1
workspace advances to source hash H2 before publish
publish source guard fails
refresh result discarded
new refresh may be scheduled for H2
```

No stale replica is published as fresh.
If only metadata changed and source hash remains H1, publish may still succeed because the replica is still derived from the current durable workspace content.

### Existing stale replica after working commit

Expected:

```txt
workspace row may still contain previous browserVaultReplicaRef
session route compares source hash
returns freshness = stale
does not return not_modified fresh
```

### No replica exists

Expected:

```txt
session route returns empty + refreshPending=true
web best-effort asks Cloudflare to refresh
UI shows preparing/syncing state
```

### User deletes data

Expected:

```txt
working commit tombstones/deletes canonical data
stale browser-vault may briefly show old dashboard with syncing indicator
fresh refresh removes deleted data
account/data deletion path still clears R2/rows directly
```

For ordinary self-visible health data, showing stale-with-syncing briefly is acceptable. Do not create a special delete-sensitive invalidation path unless this becomes a real product/legal requirement.

## Required Tests

### Working commit correctness

```txt
1. canonical add/edit/delete survives cold restore from working ref
2. canonical add/edit/delete survives idle compaction after working ref
3. assistant outbox intent survives working ref restore
4. outbox receipt/failure survives working ref restore
5. mailbox import watermarks survive working ref restore
6. system mailbox processed/recorded state survives working ref restore
7. externalized artifact unchanged is carried forward without upload
8. externalized artifact deletion creates tombstone
9. legacy base+hot restores, then next checkpoint emits working ref
10. existing working ref is replaced, not chained
```

### Latency and coordination

```txt
1. foreground working commit has <= 4 remote lease checks
2. foreground working commit never writes browser-vault
3. pending_nudge skips idle compaction
4. pending_nudge skips browser-vault refresh
5. no correctness reason emits legacy hot
6. no empty delta bundle is written for metadata-only checkpoint
```

### Browser-vault freshness

```txt
1. working commit schedules browser-vault refresh but does not wait
2. stale browser-vault ref returns freshness=stale only when `acceptStaleReplica=true`
3. stale browser-vault session triggers best-effort refresh schedule
4. fresh async replica publish succeeds when current `sourceStateHash` matches, even after metadata-only version changes
5. stale async replica publish is discarded after workspace source state advances
6. BrowserVaultProvider polls only while stale/refreshPending
7. BrowserVaultProvider stops polling after fresh
8. full/base compaction may publish fresh browser-vault
9. full/base seed does not publish browser-vault
10. old browser-vault replica is not treated as not_modified fresh after working commit
11. older clients without `acceptStaleReplica` receive `empty` for stale replicas
12. duplicate refresh schedules for the same `sourceStateHash` are deduped
```

### Rollback/deploy

```txt
1. web parses full, legacy layered, and working refs
2. Cloudflare parses full, legacy layered, and working refs
3. browser-vault session route handles missing freshness fields during deploy
4. once writer emits working ref, old pre-working builds are not valid rollback targets
5. CAS conflict after R2 write leaves no published bad pointer
```

## Implementation Shape

### Workspace commit bridge

```ts
async function createHostedWorkspaceCommit(input): Promise<{
  browserVaultReplicaRef?: HostedBrowserVaultReplicaRef | null;
  snapshotRef: HostedExecutionSnapshotRef;
}> {
  const current = await readCurrentWorkspace();

  const kind = resolveCommitKind({
    currentSnapshotRef: current.snapshotRef,
    pendingNudge: await maybeReadPendingNudge(),
    reason: input.request.reason,
  });

  switch (kind) {
    case "full_seed":
      return createFullSeed(input);

    case "working_commit":
      return createWorkingCommit(input, current);

    case "full_compaction":
      return createFullCompaction(input, current);

    case "metadata_only":
      return {
        snapshotRef: current.snapshotRef,
      };
  }
}
```

Assistant runtime should not know full/hot/working. It only says: checkpoint this correctness boundary.

### Dashboard refresh bridge

```ts
async function refreshBrowserVaultReplica(input: {
  source: "after_working_commit" | "browser_session_stale" | "idle_compaction";
  userId: string;
  sourceStateHash: string;
}): Promise<void> {
  const workspace = await readHostedWorkspace({ userId: input.userId });
  if (readBrowserVaultSourceStateHash(workspace?.snapshotRef ?? null) !== input.sourceStateHash) {
    return;
  }

  if (workspace.browserVaultReplicaRef?.sourceBundleHash === input.sourceStateHash) {
    return;
  }

  const vaultRoot = await restoreOrReuseCommittedWorkspace(workspace.snapshotRef);

  const replica = await createBrowserVaultReplica({
    sourceStateHash: input.sourceStateHash,
    vaultRoot,
  });

  if (measureReplicaBytes(replica) > 50 MiB) {
    return { status: "refresh_failed_too_large" };
  }

  const replicaRef = await browserVaultReplicaPort.write({ replica });

  await publishHostedBrowserVaultReplicaRef({
    expectedSourceStateHash: input.sourceStateHash,
    replicaRef,
    userId: input.userId,
  });
}
```

No assistant semantics. No checkpoint semantics. Just derived read-model refresh.

## Completion Gates

- No production correctness reason can emit legacy `base+hot`.
- No foreground correctness path writes or waits for browser-vault.
- Working commits write replacement deltas, not chains.
- Working commits can return unchanged metadata-only results without empty bundle writes.
- Foreground file scans do not perform remote Durable Object lease checks.
- Artifact deletion and carry-forward semantics are tested.
- Mailbox rollback and outbox side-effect ordering remain unchanged.
- Browser-vault session distinguishes fresh vs stale.
- Stale browser-vault replicas are returned only to clients that send `acceptStaleReplica: true`.
- Browser-vault refresh is async and source-hash guarded.
- Browser-vault publish does not increment workspace version.
- Browser-vault publish does not mutate `snapshotRef`, `checkpointedAt`, `nextWakeAt`, `nextWakeReason`, or `redactedStatus`.
- Metadata-only checkpoints do not schedule browser-vault refresh.
- Duplicate refresh schedules for the same `sourceStateHash` are deduped.
- Browser-vault refresh route schedules only; it never restores or generates a replica inline in the web request.
- Architecture docs state rollback to pre-working writer builds is unsafe after production emits working refs.

## Final One-Line Architecture

```txt
Local Murph writes vault.
Working commit makes it durable.
Async browser-vault refresh makes it visible on the website.
Idle compaction keeps restore cheap.
```
Completed: 2026-05-08
