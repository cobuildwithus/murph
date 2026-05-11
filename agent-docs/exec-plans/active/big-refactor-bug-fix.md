No. The previous version was still not the absolute minimum.

The absolute simplest long-term architecture is:

```txt
Cloudflare UserRunner = wake scheduler + one lease authority
Cloudflare RunnerContainer = start container + POST job + lifecycle hook
Murph runtime = all runtime semantics
Workspace checkpoint = idle-before-shutdown only
Mailbox/effect evidence = correctness between checkpoints
```

Everything else should be deleted unless it directly supports one of those four jobs.

## The final minimal architecture

```txt
Ingress
  append mailbox row
  call UserRunner.requestWake(userId)

UserRunner DO
  store next desired wake time
  store failure backoff
  store one active write fence
  start one drain loop
  invoke RunnerContainer

RunnerContainer
  ensure container is listening
  POST job to local runtime
  remember, in memory only, whether warm runtime is dirty
  on idle/activity expiry:
    if dirty, run idle-shutdown checkpoint
    then allow shutdown

Container runtime
  run normal Murph runtime
  call platform callbacks through one stable callback route
  return result

Cloudflare callback route
  validate UserRunner write fence
  dispatch to existing web/effects/mailbox/artifact handlers
```

That is it.

No foreground checkpoint. No Cloudflare-managed runtime residue. No scheduled idle checkpoint state in UserRunner. No per-invocation outbound sidecar setup. No container durable active-operation storage.

## The core deletion

Delete the current split state machine:

```txt
wakePending
retryAt
nextWakeAt
idleCheckpoint
deferredCheckpointRequired
container active operation
outbound proxy token
installed outbound handler state
```

Replace it with this minimal runner state:

```ts
type RunnerState = {
  userId: string;

  // Desired runtime wake time. Set by mailbox nudges or runtime nextWakeAt.
  wakeAt: string | null;

  // Failure not-before gate. Does not mean work exists.
  backoffUntil: string | null;
  failureCount: number;

  active: {
    attemptId: string;
    generation: string;
    workspaceVersion: string | null;
    expiresAt: string;
  } | null;

  lastErrorAt: string | null;
  lastErrorCode: string | null;
};
```

Optional diagnostics like `lastInvocationAt` are fine, but they are not part of the architecture.

This replaces three concepts:

```txt
wakePending + retryAt + nextWakeAt
```

with two:

```txt
wakeAt + backoffUntil
```

The rule becomes obvious:

```ts
runtimeDueAt = max(wakeAt, backoffUntil ?? wakeAt)
```

If `wakeAt` is null, there is no runtime work due.

## Minimal UserRunner behavior

### On nudge

```ts
wakeAt = now;
syncAlarm(max(wakeAt, backoffUntil ?? wakeAt));
kickDrainOnlyIfDueNow();
```

A nudge does not clear backoff. So a new message cannot create a retry storm during infrastructure failure.

### On begin runtime attempt

```ts
active = newWriteFence();
wakeAt = null; // consume current due wake
```

If another nudge arrives while the attempt is active, it sets `wakeAt = now`. Completion will see it and loop once more.

### On runtime success

```ts
active = null;
backoffUntil = null;
failureCount = 0;
wakeAt = earliest(existingWakeAtFromConcurrentNudge, result.nextWakeAt);
syncAlarm(wakeAt);
```

Do **not** schedule an idle checkpoint here. That belongs to the container lifecycle, not the UserRunner scheduler.

### On runtime failure

```ts
active = null;
failureCount += 1;
backoffUntil = now + backoff(failureCount);
wakeAt = wakeAt ?? now; // work still exists
syncAlarm(max(wakeAt, backoffUntil));
```

This single rule fixes the current bug where `wakePending=true` bypasses `retry_at`.

## Minimal due-work logic

```ts
function readDueWork(record: RunnerState, now: number) {
  if (record.active) {
    return {
      kind: "idle",
      alarmAt: record.active.expiresAt,
    };
  }

  if (!record.wakeAt) {
    return {
      kind: "idle",
      alarmAt: null,
    };
  }

  const dueAt = maxIso(record.wakeAt, record.backoffUntil);

  if (Date.parse(dueAt) > now) {
    return {
      kind: "idle",
      alarmAt: dueAt,
    };
  }

  return {
    kind: "runtime",
    reason: record.backoffUntil ? "retry" : "wake",
  };
}
```

No separate `idle_checkpoint` due work. No `wake_pending` branch. No ordering bug.

## Minimal RunnerContainer behavior

The container should become this:

```txt
ensure container ready
send job
receive response
remember dirty state in memory
return response
```

Delete this pre-dispatch chain:

```txt
installOutboundHandlers()
setOutboundByHosts(...)
writeRunnerActiveOperation(...)
runnerOutboundProxyState
installedRunnerOutboundProxyState
ownsInternalWorkerProxyToken
per-invocation proxy token
container durable active-operation storage
```

The current incident happened in exactly that Cloudflare-only pre-dispatch seam: container ready, but runtime request never sent. That seam should not exist.

Target hot path:

```ts
const token = await ensureContainerReady(input);

emit("Hosted execution container sending runner request.");

const response = await containerFetch(
  "http://container/internal/workspace-invocation",
  {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      job,
      callbackBaseUrl,
    }),
    signal,
  },
  RUNNER_PORT,
);
```

That is the correct thin-runner shape.

## Minimal idle checkpoint model

The idle checkpoint should not be scheduled by UserRunner.

It should be owned by the warm container lifecycle:

```txt
runtime foreground job returns deferredCheckpointRequired=true
RunnerContainer records in memory:
  warmRuntimeDirty = true
  lastWorkspaceVersion
  checkpointNextWakeAt

container becomes idle
RunnerContainer.onActivityExpired fires
if warmRuntimeDirty:
  run idle-shutdown checkpoint against the warm runtime
then allow container shutdown
```

This deletes all durable idle checkpoint scheduling state from UserRunner:

```txt
idle_checkpoint_due_at
idle_checkpoint_workspace_version
idle_checkpoint_next_wake_at
deferred_checkpoint_required
deferred_checkpoint_mailbox_status_json
runIdleCheckpointIfWarm as scheduled due work
scheduleIdleCheckpoint
clearIdleCheckpoint
finishIdleCheckpoint
```

The checkpoint is now exactly what you said it should be:

```txt
the thing that runs right before the warm container shuts down
```

Not a second scheduled job competing with runtime wakes.

## How idle checkpoint gets authority

Keep one authority: the UserRunner write fence.

For the idle checkpoint, `RunnerContainer.onActivityExpired` asks UserRunner for a short-lived idle-checkpoint lease just-in-time:

```ts
const lease = await userRunner.beginIdleCheckpointLease({
  userId,
  workspaceVersion,
  expiresAt: now + runnerTimeoutMs,
});

try {
  await containerFetch("/internal/workspace-invocation", {
    job: {
      reason: "idle_shutdown_checkpoint",
      attemptId: lease.attemptId,
      leaseGeneration: lease.generation,
      workspaceVersion,
      checkpointNextWakeAt,
    },
  });
} finally {
  await userRunner.finishIdleCheckpointLease(lease);
}
```

This adds no new moving piece. It reuses the same write-fence concept. It replaces a durable scheduled checkpoint state machine with a just-in-time lease.

If you can authorize idle checkpoint writes using existing expected workspace version plus worker/container auth, you can avoid even this RPC. But if write-fence validation is already the security model, keep the just-in-time lease. It is the smallest safe compromise.

## Minimal callback architecture

Do not use per-invocation `setOutboundByHosts`.

Use one stable callback route:

```txt
/__murph/runtime-callback/users/:userId/:targetHost/*
```

Runtime internal fetch becomes:

```txt
internal host URL
  -> callbackBaseUrl/users/:userId/:targetHost/path
  -> attach write-fence headers
```

Callback route does:

```ts
assertAllowedTargetHost(targetHost);

await requireRunnerRuntimeWriteFence({
  env,
  request,
  userId,
});

return handleRunnerOutboundRequest({
  env,
  userId,
  request: rewriteToTargetHost(request, targetHost),
});
```

Write paths still require workspace version.

This deletes:

```txt
dynamic outbound handler installation
internalWorkerProxyToken
ownsInternalWorkerProxyToken
outbound handler params
installed outbound handler cache
```

One route replaces an entire Cloudflare sidecar state machine.

## Final ownership boundaries

### UserRunner owns only this

```txt
wakeAt
backoffUntil
active write fence
alarm
```

It does not know:

```txt
deferred checkpoint state
idle checkpoint due state
runtime residue
container active operation
outbound handler install state
warm runtime dirtiness
assistant progress
mailbox lag merging
```

### RunnerContainer owns only this

```txt
container start/readiness
container POST request
warm dirty flag in memory
idle-before-shutdown checkpoint hook
```

It does not own durable active operation state.

### Runtime owns this

```txt
mailbox import
assistant pass
outbox/effects
dirty warm state
idle-shutdown snapshot
```

### Durable stores own correctness

```txt
mailbox = canonical input
effect/outbox evidence = canonical side-effect record
workspace checkpoint = compaction snapshot at idle shutdown
```

## Important correctness implication

With only idle-before-shutdown checkpointing, this must be true:

```txt
If Cloudflare kills the warm container before idle checkpoint,
the system can cold-restore from the last checkpoint and replay mailbox/effect evidence safely.
```

If that is not true, the architecture is not crash-safe. The fix should not be another checkpoint. The fix should be idempotent replay from the durable mailbox and durable side-effect evidence.

So stale checkpoint gap is acceptable only if this works:

```txt
checkpoint at seq 620
mailbox has seq 621-691
some effects may already have been sent
cold restore replays
no duplicate replies/effects
assistant state reconstructs correctly
```

That should be a required test.

## What to delete

### Delete from UserRunner state/store

```txt
wake_pending
retry_at as separate due-work category
next_wake_at as separate due-work category
idle_checkpoint_due_at
idle_checkpoint_workspace_version
idle_checkpoint_next_wake_at
deferred_checkpoint_required
deferred_checkpoint_mailbox_status_json
```

Replace with:

```txt
wake_at
backoff_until
active_*
failure_count
last_error_*
```

### Delete from UserRunner behavior

```txt
readDueWork ordering among wakePending/retry/nextWake/idleCheckpoint
scheduleIdleCheckpoint
runIdleCheckpointIfWarm as alarm work
finishIdleCheckpoint
syncDeferredCheckpointStateAfterInvocation
status merging deferred checkpoint state
nudge clearing idle checkpoint
```

### Delete from RunnerContainer

```txt
installOutboundHandlers
setOutboundByHosts in the invocation path
runnerOutboundProxyState
installedRunnerOutboundProxyState
expireOutboundProxyState
ownsInternalWorkerProxyToken
RUNNER_ACTIVE_OPERATION_STORAGE_KEY_PREFIX
writeRunnerActiveOperation
readRunnerActiveOperations
clearRunnerActiveOperation
active-operation storage-based activity expiry
```

Keep only in-memory active request cancellation.

### Delete from runtime platform

```txt
per-invocation proxy token requirement
dynamic outbound host mapping assumption
```

Replace with stable callback URL + write-fence headers.

## Final migration sequence

### PR 1 — Collapse runner state

Move to:

```txt
wakeAt
backoffUntil
active
failureCount
lastError
```

Implement:

```txt
requestWake()
beginAttempt()
completeSuccess()
completeFailure()
readDueWork()
readAlarmAt()
```

This removes the retry-loop class completely.

### PR 2 — Remove UserRunner-managed idle checkpoint scheduling

Stop scheduling idle checkpoint from `scheduleAfterRuntimeWake`.

Instead, runtime result flows back to `RunnerContainer`, which records in memory:

```ts
pendingIdleCheckpoint = result.deferredCheckpointRequired
  ? {
      userId,
      workspaceVersion,
      checkpointNextWakeAt: result.nextWakeAt ?? null,
    }
  : null;
```

No durable deferred checkpoint state.

### PR 3 — Move idle checkpoint to `RunnerContainer.onActivityExpired`

On activity expiry:

```txt
if no pending checkpoint:
  shutdown

if pending checkpoint and container warm:
  mint short idle checkpoint lease
  POST idle checkpoint job to warm runtime
  clear lease
  shutdown
```

If checkpoint fails, log and shut down. Do not loop forever. Correctness comes from replay.

### PR 4 — Delete pre-dispatch setup

Remove:

```txt
installOutboundHandlers
writeRunnerActiveOperation
per-invocation outbound proxy token
```

The only steps after readiness should be:

```txt
construct request
POST request
```

### PR 5 — Add/reuse stable callback route

Runtime callbacks use:

```txt
callbackBaseUrl + write-fence headers
```

No dynamic outbound mapping.

### PR 6 — Delete compatibility paths

After deploy stability:

```txt
legacy active invocation lease methods
idle checkpoint state columns
deferred checkpoint status columns
outbound proxy token code
container active-operation code
tests that assert wakePending immediate retry
```

## Final tests

You need only a few high-signal tests.

### Runner state

```txt
nudge sets wakeAt=now
failure sets backoffUntil=future and preserves wakeAt
nudge during backoff does not bypass backoff
success clears backoff and schedules result.nextWakeAt
nudge during active is preserved and causes another wake after completion
```

### Container dispatch

```txt
container ready -> sends runner request
no outbound handler install occurs
no active-operation storage write occurs
```

### Idle checkpoint

```txt
foreground result marks container dirty in memory
onActivityExpired runs idle checkpoint before shutdown
if checkpoint fails, shutdown still proceeds
if container reset happens before idle checkpoint, next wake cold-replays safely
```

### Replay safety

```txt
old checkpoint + mailbox backlog + existing effect evidence
cold restore
no duplicate outbound delivery
no missed reply
```

## Final answer

The absolute minimal architecture is:

```txt
UserRunner:
  wakeAt + backoffUntil + one active write fence

RunnerContainer:
  ready -> POST job
  on idle expiry -> run checkpoint if dirty -> shutdown

Runtime:
  all Murph logic

Checkpoint:
  idle-before-shutdown only

Correctness:
  durable mailbox + durable effect evidence + idempotent replay
```

Anything beyond that is probably accidental complexity.
