Yes — incoming work should always beat idle checkpointing.

And with that constraint, I’d make one important correction to the migration plan:

> **Idle checkpoint should be warm-only compaction. It should not cold-start or restore a workspace just to checkpoint.**

The current code restores before the idle checkpoint branch because `runHostedWorkspaceRuntimeJobInProcess()` uses one shared hosted-runtime entrypoint and calls `restoreHostedWorkspaceRuntimeJobWorkspace(...)` before it branches into `runHostedWorkspaceIdleShutdownCheckpoint(...)`. That is understandable as a defensive implementation, but it is not the minimal architecture. 

The minimal long-term rule should be:

```text
foreground work:
  may cold start
  may restore workspace
  may run mailbox/assistant/outbox

idle checkpoint:
  must use existing warm container/workspace
  must skip if warm workspace is unavailable
  must yield immediately if foreground work arrives
```

If the warm container is already gone, there is nothing useful for idle checkpointing to preserve. The next foreground invocation can restore from the last durable checkpoint. Idle checkpoint is compaction/durability polish, not correctness authority.

## Final target architecture

```text
Web
  append mailbox row
  nudge runner

RunnerStateStore
  one pending-work signal
  one active lease
  one alarm
  one lifecycle transition function

HostedUserRunner
  execute returned decisions only

RunnerContainer
  warm process/filesystem cache only
  no durable lifecycle policy
  report container_stopped fact

Assistant runtime
  foreground: restore/import/run/reply
  idle checkpoint: checkpoint existing warm workspace only

Workspace store
  durable checkpoint truth
```

The two hard invariants:

```text
1. pending foreground work always wins over idle checkpoint work
2. idle checkpoint never creates or restores a workspace just to checkpoint
```

## Migration guide versus current code

### Phase 1: Make pending work the only priority signal

Current code still has both `pending_nudge` and `pending_work` in the runner schema, plus separate mirror fields for `next_wake_at` and idle checkpoint due state. 

Target:

```ts
pendingWork: {
  present: boolean;
  generation: number;
}
```

Keep DB columns during migration, but collapse the mental model:

```text
pending_nudge === pending_work === foreground work exists
```

Migration steps:

1. Rename callsite concepts from “nudge” to “pending work” where possible.
2. Keep `pending_nudge` column as a compatibility mirror for now.
3. Make every state transition set/clear both together.
4. Stop adding new behavior that distinguishes `pendingNudge` from `pendingWork`.

This matters because “nudge” sounds like a transport event, while the runner only needs to know: **is there foreground work that must run?**

### Phase 2: Move foreground priority into `RunnerStateStore`

Current code has foreground-priority logic split across `nudgeHostedRunner()`, `recordActiveInvocationHeartbeat()`, `preemptActiveIdleShutdownCheckpointForPendingNudge()`, and stale recovery. You can see the current nudge path computing active state, active idle checkpoint state, preferred wake time, preemption, and immediate drive behavior in `apps/cloudflare/src/user-runner.ts`. 

Target: one state-store method:

```ts
markPendingWorkAndDecide(input: {
  nowMs: number;
  readyTimeoutMs: number;
  heartbeatStaleMs: number;
  runnerTimeoutMs: number;
}): RunnerDecision;
```

Core behavior:

```ts
if (!active) {
  return { kind: "start", reason: "foreground" };
}

if (active.reason === "idle_checkpoint") {
  clearActiveLease();
  preservePendingWork();
  return {
    kind: "start",
    reason: "foreground",
    preempted: "idle_checkpoint",
  };
}

if (active is recoverable) {
  clearActiveLease();
  preservePendingWork();
  return { kind: "start", reason: "foreground" };
}

return {
  kind: "wait",
  wakeAt: active.nextRecoveryAt,
  reason: "active_foreground_protected",
};
```

Then `nudgeHostedRunner()` becomes simple:

```ts
const decision = await stateStore.markPendingWorkAndDecide(...);
return executeRunnerDecision(decision);
```

Delete or deprecate:

```ts
clearActiveIdleShutdownCheckpointForForegroundNudge()
preemptActiveIdleShutdownCheckpointForPendingNudge()
resolvePendingNudgeDrainContinuationWakeAt() outside state store
local nudge-specific recovery math
```

### Phase 3: Make heartbeat return an instruction, not just facts

Current runtime liveness now has the right foreground fix: when fresh input appears during normal foreground work, the hosted runtime throws `HostedForegroundInputAvailableError` and returns `status: "scheduled"`. 

Keep that behavior, but simplify the API.

Current heartbeat-ish result shape still exposes facts like `inputAvailable`, `pendingNudge`, and `nextAlarmAt`. The liveness helper supports `inputAvailable` / `pendingNudge` responses. 

Target:

```ts
type RuntimeInstruction =
  | { kind: "continue" }
  | { kind: "yield"; status: "scheduled"; nextWakeAt: string | null }
  | { kind: "abort"; reason: "stale_lease" | "container_stopped" | "hard_timeout" };
```

State-store heartbeat logic:

```ts
heartbeat(activeLease) {
  if stale lease:
    return { kind: "abort", reason: "stale_lease" };

  update lastHeartbeatAt;

  if active.reason === "idle_checkpoint" && pendingWork.present:
    clearActiveLease();
    preservePendingWork();
    return { kind: "yield", status: "scheduled", nextWakeAt: now };

  if active.reason === "foreground" && pendingWork.present:
    return { kind: "yield", status: "scheduled", nextWakeAt: now };

  return { kind: "continue" };
}
```

This removes policy from assistant-runtime. Runtime only obeys:

```text
continue
yield scheduled
abort
```

### Phase 4: Make idle checkpoint warm-only

This is the key correction.

Current runtime path restores/ensures workspace before idle checkpoint because it shares the foreground runtime entrypoint. 

Target:

```ts
if (request.reason === "idle_checkpoint") {
  const warm = await tryOpenExistingWarmWorkspace(...);

  if (!warm.ok) {
    return {
      status: "idle",
      idleCheckpointSkipped: "warm_workspace_unavailable",
    };
  }

  return runIdleCheckpointFromWarmWorkspace(warm);
}
```

Do **not** call the normal restore/download path for idle checkpoint.

The migration should introduce a separate helper:

```ts
tryOpenExistingWarmWorkspaceForIdleCheckpoint(input): 
  | { ok: true; vaultRoot: string; operatorHomeRoot: string; workspace: HostedWorkspaceState }
  | { ok: false; reason: "warm_workspace_missing" | "workspace_version_mismatch" };
```

It should only validate/reuse existing local state. It should not fetch a workspace bundle. It should not materialize artifacts. It should not rebuild sidecars. It should not prepare Codex runtime.

If this helper returns `ok: false`, the runner should clear the idle checkpoint alarm and stop. No retry. No error. No cold start.

Reason:

```text
idle checkpoint is compaction
foreground restore is correctness
```

### Phase 5: Prevent idle checkpoint from starting cold containers

Even if assistant-runtime becomes warm-only, the Cloudflare runner should avoid invoking the container in a way that starts a cold shell solely for idle checkpoint.

Add a warm-only container path:

```ts
invokeIdleCheckpointIfWarm(input):
  | { status: "idle"; idleCheckpointed: true }
  | { status: "idle"; idleCheckpointSkipped: "container_not_warm" }
  | { status: "scheduled"; nextWakeAt: string | null };
```

In `RunnerContainer`, this path must not call the normal `ensureContainerReady(...)` startup path. The current container code has a normal invocation path that ensures readiness and sends the runner request; that is correct for foreground work, but too heavy for idle checkpoint. 

Implementation rule:

```text
foreground invoke:
  ensure container ready

idle checkpoint invoke:
  only proceed if already warm/healthy
  otherwise return skipped
```

If Cloudflare’s container API does not expose a reliable “already warm” check without touching the container, use a DO-local warm marker from the last successful foreground invocation plus a short health check that does not intentionally start the container. If that cannot be guaranteed, prefer skipping idle checkpoint over cold-starting it.

### Phase 6: Collapse alarm state to one alarm

The actual alarm scheduler is already close to the right shape: it reads the stored runner alarm and applies one Durable Object alarm. 

Target persisted alarm:

```ts
alarm: null | {
  kind: "work" | "idle_checkpoint" | "recovery";
  dueAt: string;
  workspaceVersion?: string | null;
  checkpointNextWakeAt?: string | null;
}
```

State-store alarm consumption:

```ts
consumeDueAlarm(now) {
  if pendingWork.present:
    return decideStartForegroundOrWait();

  if alarm.kind === "idle_checkpoint":
    if active:
      return waitOrRecoverActive();

    if idle checkpoint stale:
      clear alarm;
      return wait;

    return { kind: "start", reason: "idle_checkpoint", warmOnly: true };

  if alarm.kind === "recovery":
    return recoverOrWait();

  return wait;
}
```

Important priority rule:

```ts
if (pendingWork.present) {
  // This wins even if the due alarm was idle_checkpoint.
  return foregroundDecision();
}
```

This eliminates “idle alarm fired at same time as nudge” ambiguity.

### Phase 7: Complete/fail behavior after idle checkpoint

After idle checkpoint returns:

```ts
if result.status === "scheduled":
  // fresh foreground work arrived
  complete/clear idle lease
  start foreground immediately
  do not destroy warm container

if result.idleCheckpointSkipped:
  clear idle alarm
  complete/clear idle lease
  do not retry
  optionally destroy if container is actually warm and no work exists

if result.idleCheckpointed:
  complete idle lease
  re-read state
  if pendingWork.present:
    start foreground immediately
    do not destroy
  else:
    destroy warm container
```

Foreground work wins before, during, and after idle checkpoint.

### Phase 8: Simplify schema after compatibility window

After deployed code no longer reads old fields as independent truth, migrate mentally first, physically later.

Keep temporarily:

```text
pending_nudge
pending_work
next_wake_at
idle_shutdown_checkpoint_due_at
idle_shutdown_checkpoint_workspace_version
in_flight
active_invocation_orphan_observed_at
```

But only write them as mirrors or not at all.

Eventually remove:

```text
in_flight                     // derivable from active_invocation_id
pending_nudge                 // replace with pending_work
next_wake_at                  // replace with alarm_due_at
idle_shutdown_checkpoint_*    // replace with alarm kind/workspaceVersion
active_invocation_orphan_observed_at // replace with startedAt + lastHeartbeatAt deadlines
```

Keep:

```text
active_invocation_id
active_invocation_started_at
active_invocation_expires_at
active_invocation_last_heartbeat_at
active_invocation_container_stopped_at
active_invocation_reason
active_workspace_version
lease_generation
alarm_kind
alarm_due_at
alarm_workspace_version
alarm_checkpoint_next_wake_at
pending_work
pending_nudge_generation or pending_work_generation
retry_failure_count
last_error_at
last_error_code
last_invocation_at
```

## Final desired code shape

`apps/cloudflare/src/user-runner.ts` should become mostly orchestration:

```ts
async nudgeHostedRunner(input) {
  const decision = await this.stateStore.markPendingWorkAndDecide(...);
  return this.executeDecision(decision, input);
}

async alarm() {
  const decision = await this.stateStore.consumeDueAlarm(Date.now());
  return this.executeDecision(decision);
}

async recordActiveInvocationHeartbeat(input) {
  const instruction = await this.stateStore.recordHeartbeatAndDecide(input);
  return instruction;
}
```

`apps/cloudflare/src/user-runner/runner-state-store.ts` owns the lifecycle policy:

```ts
markPendingWorkAndDecide()
consumeDueAlarm()
recordHeartbeatAndDecide()
claimInvocation()
completeInvocation()
failInvocation()
recordContainerStopped()
```

`packages/assistant-runtime/src/hosted-runtime.ts` splits early:

```ts
if (request.reason === "idle_checkpoint") {
  return runWarmOnlyIdleCheckpoint(...);
}

return runForegroundInvocation(...);
```

`apps/cloudflare/src/runner-container.ts` splits invocation modes:

```ts
invokeForeground() {
  ensureContainerReady();
  run();
}

invokeIdleCheckpointIfWarm() {
  if (!alreadyWarm()) return skipped;
  run();
}
```

## Tests that should define the migration

The migration is done when these pass:

```text
nudge while idle checkpoint pending:
  foreground starts, idle checkpoint cleared

nudge while idle checkpoint active:
  idle checkpoint yields scheduled, foreground starts, no container-destroy wait

nudge while foreground active:
  heartbeat returns yield scheduled, current job exits, latest mailbox state drives

idle checkpoint alarm with no warm container:
  skipped, no restore, no retry, no cold start

idle checkpoint alarm with warm container:
  snapshots existing local workspace, then destroys warm container if no pending work

pending work and idle checkpoint alarm due simultaneously:
  foreground wins

container stopped during active foreground:
  container_stopped fact recorded, next nudge recovers immediately

startup no heartbeat before ready timeout:
  protected

startup no heartbeat after ready timeout:
  recovered

heartbeat stale:
  recovered

hard timeout:
  recovered
```

## Bottom line

With your clarification, the final architecture is even simpler:

> **Idle checkpoint is warm-only, best-effort compaction. Foreground work is the only thing allowed to cold-start or restore. RunnerStateStore is the only lifecycle brain.**

That is the maintainable shape.
