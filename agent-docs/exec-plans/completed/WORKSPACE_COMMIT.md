I re-reviewed the fixes you landed. Directionally: **yes, the system is now much closer to the intended architecture.** The remaining work is mostly naming/surface-area cleanup, not a big correctness rewrite.

## Browser vault vs dashboard replica

This is the key distinction:

**Browser vault** is the concrete implementation: an encrypted, browser-readable replica object plus session protocol. In code, this is things like `HostedBrowserVaultReplicaRef`, `browserVaultReplicaRef`, `/api/browser-vault/session`, the browser decryption session, and the client query object.

**Dashboard replica** is the architectural role: “the derived read model the website uses to show health/dashboard data.” In today’s implementation, the dashboard replica is implemented as a browser-vault replica.

So:

```txt
canonical workspace / vault
  = source of truth

browser-vault replica
  = encrypted artifact stored for browser use

dashboard replica
  = what that artifact is doing architecturally:
    a derived read model for the website
```

That’s why the plan says: “A checkpoint commits durable portable workspace state. A browser-vault replica materializes dashboard-readable derived data.” 

My recommendation: use **BrowserVaultReplica** for storage/encryption/session-specific code, and use **DashboardReplica** for orchestration/coordinator code. The object can still be a browser-vault replica; the service that schedules/refreshed it should be named around the product/architecture role.

## Review of your landed fixes

### Looks good

The web session route now schedules stale/missing replica refreshes with `void scheduleBrowserVaultRefreshBestEffort(...)`, so stale/empty session responses are no longer blocked on the Cloudflare schedule call. The helper also catches internally, which keeps refresh scheduling best-effort. 

The web publish path now retries one same-source CAS conflict. That directly fixes the “metadata-only version race” issue: first update can lose the version guard, then it rereads, rechecks source hash, and retries once.  The commit added tests for success-after-metadata-race, stale-source-after-race, missing workspace after reread, and second conflict. 

Missing workspace publish is now treated as stale/obsolete refresh work rather than throwing a server error. The internal route returns `{ published: false, workspace: null }` with 404, and the shared publish response type/parser now allows `workspace: null`. 

The warm refresh path landed. `refreshHostedBrowserVaultReplica` now checks the current committed source hash, skips if already fresh, tries a warm root when the warm marker matches, falls back to cold restore otherwise, and writes the replica inside the runtime boundary.  The warm marker helper is source-hash-only and lives in assistant-runtime, which is the right minimal shape. 

The Cloudflare runtime platform now supports browser-vault refresh writes without pretending they are normal workspace checkpoint writes. It accepts `browserVaultRefreshSourceStateHash`, writes refresh-source headers for replica writes, and accepts 404/409 on publish so stale/missing derived work does not explode as a foreground failure. 

Pending refreshes are no longer stranded. The Durable Object schedules a continuation alarm when it cannot start immediately, tries pending refreshes on quiet alarms, retries after failure, and drains the latest pending refresh after an active invocation or active refresh completes. The tests cover pending refresh after invocation and latest-pending-wins after active refresh. 

The stale warm marker cleanup fix is important and correct: before launching a new child, the isolated runner clears the warm browser-vault source marker for the user vault root, and tests cover both successful cleanup and fail-closed cleanup failure. 

### Remaining concerns

The biggest remaining issue is **conceptual sprawl**, not a clear bug. “browser-vault refresh” currently appears in web session scheduling, Cloudflare DO coordination, container calls, runtime platform authorization, storage limits, warm markers, and publish handling. Each piece is defensible, but the orchestration layer is now hard to reason about because the implementation name is doing architectural work.

One subtle operational concern: `void scheduleBrowserVaultRefreshBestEffort(...)` is correct for latency, but in a serverless runtime it may be dropped if the platform freezes execution immediately after the response. Since the runner also schedules refresh after workspace changes, this is not catastrophic. Still, for the web-session stale/missing fallback trigger, I’d prefer a tiny wrapper that uses a platform-supported after-response hook if available, falling back to fire-and-forget. Do not re-await it on the response path.

I also want one explicit test that a **pending nudge blocks direct refresh scheduling** when no in-process invocation lock exists but Durable Object state has `pendingNudge = true`. The code path likely handles this through the start boundary, but the tests I saw cover active invocation / active refresh draining more clearly than “pending nudge already set, schedule called, refresh does not start.” Given this is an invariant, it deserves a focused test.

## Clean simplification plan

The simplification should not change behavior first. It should introduce clearer boundaries, then move code behind those boundaries.

### Step 1: Lock vocabulary

Use this naming rule:

```txt
WorkspaceCommit
  durable source-of-truth commit
  writes snapshotRef
  increments workspace.version

DashboardReplica
  derived website read model
  scheduled/refreshed asynchronously
  source-hash scoped
  does not increment workspace.version

BrowserVaultReplica
  concrete encrypted artifact/session format
  implementation of DashboardReplica today
```

Do **not** rename every browser-vault type. Keep concrete storage/session names:

```txt
HostedBrowserVaultReplicaRef
browserVaultReplicaRef
BrowserVaultProvider
/api/browser-vault/session
browserVaultReplicaPort
```

But rename orchestration concepts:

```txt
scheduleBrowserVaultRefreshForUser
  -> scheduleDashboardReplicaRefreshForUser

pendingBrowserVaultRefresh
  -> pendingDashboardReplicaRefresh

tryStartPendingBrowserVaultRefresh
  -> tryStartPendingDashboardReplicaRefresh

refreshHostedBrowserVaultReplica
  -> refreshDashboardReplicaFromCommittedWorkspace

browserVaultRefreshSourceStateHash
  -> dashboardReplicaSourceStateHash
```

The object remains a browser-vault replica. The coordinator becomes a dashboard-replica coordinator.

### Step 2: Centralize source-hash/freshness logic

Create one tiny module, probably in `packages/hosted-execution` if both web and Cloudflare use it:

```ts
// packages/hosted-execution/src/dashboard-replica.ts

export function readDashboardReplicaSourceStateHash(
  snapshotRef: HostedExecutionSnapshotRefState,
): string | null {
  return readHostedExecutionSnapshotDeltaRef(snapshotRef)?.hash
    ?? readHostedExecutionSnapshotBaseRef(snapshotRef)?.hash
    ?? null;
}

export function getDashboardReplicaFreshness(input: {
  replicaRef: HostedBrowserVaultReplicaRef | null;
  snapshotRef: HostedExecutionSnapshotRefState;
}): "fresh" | "stale" {
  const sourceStateHash = readDashboardReplicaSourceStateHash(input.snapshotRef);
  return input.replicaRef
    && sourceStateHash
    && input.replicaRef.sourceBundleHash === sourceStateHash
      ? "fresh"
      : "stale";
}

export function shouldScheduleDashboardReplicaRefresh(input: {
  currentReplicaRef: HostedBrowserVaultReplicaRef | null;
  currentSnapshotRef: HostedExecutionSnapshotRefState;
  previousSnapshotRef?: HostedExecutionSnapshotRefState | null;
}): { sourceStateHash: string } | null {
  const sourceStateHash = readDashboardReplicaSourceStateHash(input.currentSnapshotRef);
  if (!sourceStateHash) return null;
  if (input.currentReplicaRef?.sourceBundleHash === sourceStateHash) return null;

  if (input.previousSnapshotRef !== undefined) {
    const previous = readDashboardReplicaSourceStateHash(input.previousSnapshotRef);
    if (previous === sourceStateHash) return null;
  }

  return { sourceStateHash };
}
```

Then keep `readHostedBrowserVaultSourceStateHash` as a temporary alias if needed, but mark it as compatibility.

This reduces the recurring “delta hash vs base hash” confusion.

### Step 3: Extract a `DashboardReplicaCoordinator` from `HostedUserRunner`

Right now the Durable Object runner owns too many concerns. Extract the coordination pieces into a small class that has no assistant/checkpoint semantics:

```ts
class DashboardReplicaCoordinator {
  schedule(input: {
    sourceStateHash: string;
    userId: string;
  }): Promise<{ immediateRefreshStarted: boolean }>;

  tryStart(input?: {
    userId?: string | null;
  }): Promise<boolean>;

  abortForForegroundWork(input: {
    reason: "pending_nudge" | "workspace_invocation";
    userId: string;
  }): void;

  scheduleContinuation(input: {
    delayMs?: number;
    userId: string;
  }): Promise<boolean>;
}
```

It can still use `RunnerStateStore` and `RunnerRuntimeAlarmScheduler`, but `HostedUserRunner` should only call it:

```ts
await dashboardReplica.schedule(...);
dashboardReplica.abortForForegroundWork(...);
await dashboardReplica.tryStart(...);
```

That makes the invariant visible:

```txt
foreground runner work owns the runner
dashboard replica refresh runs only when quiet
latest source hash wins
```

### Step 4: Extract a `DashboardReplicaRefresher`

Move the refresh algorithm out of `node-runner.ts` into a dedicated runtime-side service:

```ts
async function refreshDashboardReplicaFromCommittedWorkspace(input: {
  sourceStateHash: string;
  userId: string;
  runtime: HostedAssistantRuntimeConfig | null;
  ports: {
    workspace: WorkspaceReadPort;
    browserVaultReplica: BrowserVaultReplicaWritePort;
    publish: BrowserVaultReplicaPublishPort;
  };
}): Promise<DashboardReplicaRefreshResult> {
  const workspace = await readWorkspace();

  if (!workspace) return { status: "workspace_missing" };
  if (sourceHash(workspace.snapshotRef) !== input.sourceStateHash) return { status: "stale_source" };
  if (workspace.browserVaultReplicaRef?.sourceBundleHash === input.sourceStateHash) {
    return { status: "already_fresh" };
  }

  const vaultRoot =
    await tryWarmRoot(input.sourceStateHash)
    ?? await coldRestore(workspace.snapshotRef);

  const replica = await createBrowserVaultReplicaFromVault(vaultRoot);
  const replicaRef = await writeBrowserVaultReplica(replica);
  const publish = await publishBrowserVaultReplicaRef({
    expectedSourceStateHash: input.sourceStateHash,
    replicaRef,
  });

  return classifyPublish(publish);
}
```

This service should not know about nudges, alarms, mailbox imports, assistant phases, or checkpoint reasons.

### Step 5: Keep the web session service thin

The web browser-vault session route should only do:

```txt
1. auth / consent
2. read workspace
3. compute freshness
4. return empty / stale / fresh session
5. ask DashboardReplicaRefreshClient to schedule best-effort
```

In code:

```ts
const freshness = getDashboardReplicaFreshness({ snapshotRef, replicaRef });

if (freshness === "stale") {
  scheduleDashboardReplicaRefreshAfterResponse(...);
}
```

This makes `/api/browser-vault/session` a browser-session endpoint, not a refresh coordinator.

### Step 6: Split full seed and full compaction names

The current runtime bridge behavior is close, but I would still make the API names match the architecture:

```ts
createFullSeedSnapshot(...)
createWorkingCommitSnapshot(...)
createFullCompactionSnapshot(...)
```

Even if `createFullSeedSnapshot` and `createFullCompactionSnapshot` share an internal helper, the public shape should prevent future regressions like “first foreground message pays browser-vault sidecar latency.”

### Step 7: Delete or isolate legacy names

After the above extraction, audit for names that keep re-teaching the old model:

```txt
latest-hot
hot-state checkpoint
browser-vault checkpoint
working snapshot legacy
```

Keep legacy restore compatibility, but make production producer names impossible to misuse.

I’d especially avoid phrases like “browser-vault checkpoint.” That phrase is the old model leaking back in. It is either:

```txt
WorkspaceCommit
```

or:

```txt
DashboardReplicaRefresh
```

not both.

## Proposed target file layout

A maintainable end state could look like:

```txt
packages/hosted-execution/src/dashboard-replica.ts
  source hash / freshness / scheduling decision helpers

apps/web/src/lib/browser-vault/session-handler.ts
  browser session protocol only

apps/web/src/lib/dashboard-replica/refresh-client.ts
  best-effort Cloudflare schedule client

apps/cloudflare/src/dashboard-replica/coordinator.ts
  Durable Object pending slot, quiet-start, continuation, preemption

apps/cloudflare/src/dashboard-replica/refresher.ts
  read workspace, warm/cold restore, generate, write, publish

apps/cloudflare/src/browser-vault-store.ts
  encrypted browser-vault artifact storage only

packages/assistant-runtime/src/hosted-runtime/browser-vault-replica.ts
  createBrowserVaultReplica + warm marker implementation only
```

The dependency direction should be:

```txt
browser session -> dashboard refresh client -> Cloudflare coordinator
Cloudflare coordinator -> dashboard refresher
dashboard refresher -> browser-vault artifact store + web publish API
workspace commit path -> maybe schedules dashboard refresh, but never runs it inline
```

## Tests to add before refactor

Before moving code, add these guard tests so the refactor has rails:

```txt
1. pending_nudge already true + refresh schedule request -> pending slot remains, refresh does not start
2. active invocation + refresh schedule request -> pending slot remains, continuation alarm set, refresh does not start
3. quiet alarm + pending refresh + no nudge -> refresh starts
4. refresh result written + publish 404 missing workspace -> pending refresh clears, no hot loop
5. refresh result refresh_failed_too_large -> pending refresh clears or backs off exactly as intended, no hot loop
6. web stale session uses after-response/best-effort scheduling and returns immediately
7. after working commit schedules refresh only when sourceStateHash changes
8. metadata-only workspace update does not schedule dashboard refresh
```

## My recommended next implementation order

1. **Add `dashboard-replica` helper module** with source hash and freshness helpers. Low risk, high clarity.
2. **Rename only orchestration functions**, leaving storage/session types alone. This removes most of the conceptual confusion quickly.
3. **Extract `DashboardReplicaCoordinator` from `HostedUserRunner`** without changing behavior.
4. **Extract `DashboardReplicaRefresher` from `node-runner.ts`** without changing behavior.
5. **Split full seed/full compaction function names** in the workspace bridge.
6. **Run deletion pass** on legacy aliases and confusing names after tests are green.

The clean one-line mental model I’d keep in the architecture docs:

```txt
WorkspaceCommit makes the vault durable.
DashboardReplicaRefresh makes committed vault data visible on the website.
BrowserVaultReplica is the encrypted artifact format used by that dashboard replica.
```
Status: completed
Updated: 2026-05-08
Completed: 2026-05-08
