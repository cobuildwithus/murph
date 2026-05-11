## Resolution note

Completed in this task. The callback-only provider-effects/browser-vault concern below is already resolved in the current runtime-platform implementation and covered by callback-only tests. Remaining items are deploy-skew cleanup notes, not blockers for this scoped fix.

I found one production-blocking issue and a handful of cleanup/simplification items. The fixes you just made addressed the earlier specific concerns: idle-checkpoint lease failures now remain best-effort and still shut down the container; callback-only web-control ports are now attached; write-fence write validation is now workspace-version strict; `pending_nudge` migration is covered; and nudge during backoff no longer starts a drain. Those are all materially better.

## Production-blocking issue

### Callback-only mode does not attach provider effect methods

`buildHostedExecutionRuntimePlatform()` now correctly treats `runtimeCallbackBaseUrl` as a proxy transport for web-control ports. It builds `mailboxPort`, `workspacePort`, `logPort`, issue export, usage recording, and device-sync through callback-only mode. The tests now cover raw email plus mailbox/workspace/log callback routing.  

But the provider effects are still gated only on `internalWorkerProxyToken && workspaceCheckpointBridge`:

```ts
const providerEffectsPort = input.internalWorkerProxyToken && input.workspaceCheckpointBridge
  ? createCloudflareRunnerProviderEffectsPort(...)
  : {};
```

And `browserVaultReplicaPort` has the same shape:

```ts
...(input.internalWorkerProxyToken && input.workspaceCheckpointBridge
  ? { browserVaultReplicaPort: ... }
  : {})
```

In the new production path, `RunnerContainer` sends:

```ts
internalWorkerProxyToken: null,
localInternalProxyBaseUrl: null,
runtimeCallbackBaseUrl,
```

to the container. 

That means callback-only runtime execution will not expose:

```txt
effectsPort.sendLinq
effectsPort.sendTelegram
effectsPort.sendWhatsApp
effectsPort.deleteLinqMessages
effectsPort.markLinqRead
effectsPort.send*ChatAction
browserVaultReplicaPort
```

Raw email still works because `readRawEmailMessage` is always attached and goes through `fetchImpl`, but provider sends are not attached. For iMessage/Linq/Telegram/WhatsApp replies, this is likely a hard production failure.

Minimal fix:

```ts
const hasRuntimeCallbackAuthority =
  Boolean(input.internalWorkerProxyToken || input.runtimeCallbackBaseUrl);

const providerEffectsPort =
  hasRuntimeCallbackAuthority && input.workspaceCheckpointBridge
    ? createCloudflareRunnerProviderEffectsPort({
        fetchImpl,
        timeoutMs,
        workspaceCheckpointBridge: input.workspaceCheckpointBridge,
      })
    : {};

...

...(hasRuntimeCallbackAuthority && input.workspaceCheckpointBridge
  ? {
      browserVaultReplicaPort: createCloudflareBrowserVaultReplicaPort({
        boundUserId: input.boundUserId,
        fetchImpl,
        timeoutMs,
        transport: hostedWebControlTransport,
        workspaceCheckpointBridge: input.workspaceCheckpointBridge,
      }),
    }
  : {})
```

Add one focused test:

```ts
it("attaches provider effects in callback-only mode", async () => {
  const fetchMock = vi.fn(async () =>
    new Response(JSON.stringify({ target: "linq:message:1" }), {
      headers: { "content-type": "application/json; charset=utf-8" },
      status: 200,
    })
  );

  const platform = buildHostedExecutionRuntimePlatform({
    boundUserId: "member_123",
    fetchImpl: fetchMock as typeof fetch,
    internalWorkerProxyToken: null,
    runtimeCallbackBaseUrl: "https://worker.example.test",
    workspaceCheckpointBridge: {
      readCurrentLease: () => ({
        attemptId: "runtime_write_123",
        leaseGeneration: "7",
        userId: "member_123",
        workspaceVersion: "6",
      }),
    },
  });

  expect(platform.effectsPort.sendLinq).toBeDefined();

  await platform.effectsPort.sendLinq!(/* minimal valid request */);

  const request = requireFetchRequest(fetchMock.mock.calls[0], "linq send");
  expect(request.url).toContain(
    "/__murph/runtime-callback/users/member_123/results.worker/",
  );
  expect(request.headers.get("x-hosted-runtime-attempt-id")).toBe("runtime_write_123");
  expect(request.headers.has("x-hosted-execution-runner-proxy-token")).toBe(false);
});
```

I would fix this before production.

## What looks fixed now

The idle checkpoint lifecycle is now properly best-effort. `onActivityExpired()` wraps the pending checkpoint in `try/catch/finally`, clears `pendingIdleCheckpoint` on failure, logs, and always proceeds to `stopWarmContainer({ failClosed: false })`. `runPendingIdleCheckpoint()` now catches begin-lease failure and catches finish-lease failure.  The new tests cover normal idle checkpoint, begin-lease failure, and finish-lease failure. 

The callback-only web-control path is fixed. `resolveHostedWebControlTransport()` now treats `runtimeCallbackBaseUrl` as `"proxy"` transport, and `createCloudflareHostedRuntimeFetch()` attaches write-fence headers and rewrites internal hosts to `/__murph/runtime-callback/users/:userId/:host/...`.  The test verifies mailbox/workspace/log callback routing and headers in callback-only mode. 

Write-fence write validation is now strict. `requireRunnerRuntimeWriteFenceWrite()` validates attempt id, generation, user id, and workspace version.  Artifact PUT, browser-vault write, provider effects, and workspace checkpoint now call this stricter function.   

The nudge/backoff behavior is now correct at the runner level. `nudgeHostedRunner()` marks wake, syncs alarm, reads due work, and only starts a drain when due work is actually runtime work.  There is also a test that nudging during retry backoff does not invoke the container and schedules the backoff alarm. 

The pending-nudge migration edge is fixed. The schema migration now includes `pending_nudge` in the outer condition and handles missing legacy active columns defensively.  The new store test covers `pending_nudge`-only migration into runtime due work. 

The production env guard for callback base URL is good. `HOSTED_EXECUTION_RUNNER_CALLBACK_BASE_URL` is now required, and production deploy preflight enforces that it equals `CF_PUBLIC_BASE_URL` and is a safe production URL.  

## Smaller correctness concerns

### 1. `scheduleBrowserVaultRefreshForUser()` still bypasses due-work gating

`nudgeHostedRunner()` now checks `readDueWork()` before starting an immediate drain, but the legacy `scheduleBrowserVaultRefreshForUser()` still calls `markWakePending()` and then unconditionally `kickDrain({ wait: false })`. 

It is marked as deploy-skew compatibility, so this may be acceptable short-term. But if any deployed caller still hits that method during infrastructure backoff, it can reintroduce unnecessary immediate drain attempts. It will not necessarily retry-storm at the container level because `runDrainLoop()` should return idle when backoff is active, but it is inconsistent and confusing.

Minimal fix:

```ts
async scheduleBrowserVaultRefreshForUser(input: { userId: string }) {
  await this.stateStore.bindUser(input.userId);
  const record = await this.stateStore.markWakePending({
    preferredWakeAt: new Date().toISOString(),
  });
  await this.syncAlarm(record);

  const due = await this.stateStore.readDueWork(Date.now());
  if (due.kind === "runtime") {
    this.kickDrain({ reason: "nudge", wait: false });
  }

  ...
}
```

Or better, just delegate to `nudgeHostedRunner()` after binding:

```ts
async scheduleBrowserVaultRefreshForUser(input: { userId: string }) {
  await this.stateStore.bindUser(input.userId);
  const result = await this.nudgeHostedRunner();
  return {
    accepted: true,
    scheduled: result.accepted,
    userId: input.userId,
  };
}
```

### 2. `readRunnerStateAlarmAt()` is still worth verifying directly

I could see `syncAlarm()` using `readRunnerStateAlarmAt(record)`, but the file output truncated before the helper definition. The behavior is indirectly covered by tests, but given production criticality, make sure the actual helper is exactly equivalent to:

```ts
if (record.writeFence) return record.writeFence.expiresAt;
if (!record.wakeAt) return null;
return latestIsoDate(record.wakeAt, record.backoffUntil);
```

Do not use `nextWakeAt` legacy projection separately. Do not prefer `wakeAt` over `backoffUntil`.

### 3. `finishIdleCheckpointLease()` schedules `nextWakeAt` even after best-effort checkpoint failure

In `runPendingIdleCheckpoint()`, if the idle checkpoint POST fails, `nextWakeAt` remains `pending.checkpointNextWakeAt`, and `finishIdleCheckpointLease()` is still called with that value. 

That is probably acceptable because the idle checkpoint is best-effort and correctness comes from replay. But be aware of the semantic: a failed checkpoint still releases the fence and preserves the runtime’s requested next wake. It does not retry the idle checkpoint. That matches the minimalist design, but it should be intentional.

### 4. Idle checkpoint uses foreground runtime config

`pendingIdleCheckpoint` stores the previous foreground `job` and reuses its runtime config for the idle checkpoint, changing only the request fields.  This is simple and probably fine. The older code had a distinct idle-checkpoint runtime config. Reusing foreground config means the idle checkpoint sees forwarded/user env that it likely does not need. It is not a blocker, but if you want stricter minimal privilege later, build the idle checkpoint job with only the config required for snapshotting. I would not add that complexity before production unless there is a concrete secret-exposure concern.

## Simplifications/deletions still available

These do not block production, but they are the next cleanup pass if the deploy-skew window has expired or if you can hard-cut.

### Delete legacy active-invocation compatibility

Still present:

```txt
ownsActiveInvocationLease
recordActiveInvocationWorkspaceCheckpoint
recordActiveInvocationHeartbeat
recordActiveInvocationContainerStopped
RunnerActiveInvocationLease* types
LEGACY_ACTIVE_INVOCATION_COMPATIBILITY_DELETE_AFTER
```

They are explicitly marked for deletion after 2026-05-25. 

### Delete no-op idle/deferred checkpoint APIs from `RunnerStateStore`

These are now no-ops:

```txt
scheduleIdleCheckpoint
clearIdleCheckpoint
markDeferredCheckpointRequired
clearDeferredCheckpointRequired
clearIdleCheckpointMetaSync
```

They exist only for compatibility.  Delete after skew.

### Delete legacy proxy-token path after callback-only is fully deployed

Still present:

```txt
internalWorkerProxyToken
localInternalProxyBaseUrl
HOSTED_EXECUTION_RUNNER_PROXY_TOKEN_HEADER
ownsInternalWorkerProxyToken
requireRunnerInternalProxyAuthorization
local internal proxy path in hosted runtime fetch
```

The final minimum is:

```ts
{
  job,
  runtimeCallbackBaseUrl,
}
```

not:

```ts
{
  internalWorkerProxyToken: null,
  localInternalProxyBaseUrl: null,
  runtimeCallbackBaseUrl,
  job,
}
```

Right now keeping the fields is acceptable for deploy skew. After production proves callback-only mode, delete them.

### Delete `invokeIdleCheckpointIfWarm`

The new architecture runs idle checkpoint from `RunnerContainer.onActivityExpired()`, not via UserRunner due work. `invokeIdleCheckpointIfWarm` now looks like compatibility residue. It can go after the old callers are gone. 

### Delete stale liveness/heartbeat tests or keep them explicitly as historical skipped tests

`runner-outbound.test.ts` still contains many skipped heartbeat tests.  For a clean long-term architecture, skipped tests around deleted behavior are noise. I would either delete them or move them into a short-lived legacy file with the same deletion date.

### Delete unused `RunnerDrainInput` fields

`RunnerDrainInput` still has:

```ts
dueWake?: unknown;
idleCheckpointWorkspaceVersion?: string | null;
```

These are not part of the current minimal design. Remove them. 

## Final production-readiness call

I would **not deploy until the provider-effects callback-only bug is fixed**. That is the only thing I see that looks likely to break actual replies.

After fixing that, this is production-ready from the architecture review perspective, assuming CI passes and the production env contains the new required callback base URL. The shape is now close to the target:

```txt
UserRunner:
  wakeAt + backoffUntil + one write fence

RunnerContainer:
  ready -> POST job
  remember dirty warm state
  on activity expiry -> best-effort idle checkpoint -> shutdown

Runtime:
  all Murph logic

Callback route:
  write-fence validated internal transport
```

The remaining complexity is mostly deploy-skew compatibility and can be deleted in one scheduled cleanup pass.
Status: completed
Updated: 2026-05-12
Completed: 2026-05-12
