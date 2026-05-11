You do **not** need Cloudflare logic around runtime priority. That was the wrong simplification direction.

The simplest shape is: **Cloudflare never decides foreground vs background.** It only records “runtime wake needed” and calls the Murph runtime. The Murph runtime already has the right context to prioritize: it imports mailbox, detects fresh conversation input, runs assistant phase, handles active-turn mailbox refresh, skips/defers maintenance when fresh input exists, and returns `nextWakeAt`. That logic is already in runtime code, especially `workspace-assistant-phase.ts`, `workspace-runner.ts`, and `turn-input.ts`.   

So the corrected invariant is:

```txt
Cloudflare does not know priority.
Cloudflare only preserves wake durability and invokes the runtime.
The runtime imports mailbox first and decides what to do.
Idle checkpoint is the only special Cloudflare-scheduled maintenance task.
```

## Why no Cloudflare priority

Cloudflare has the least context. It sees “a nudge happened,” but it does not know:

```txt
whether mailbox import will reveal fresh conversation input
whether assistant has active-turn input available
whether outbox delivery is pending
whether device sync is dirty but skippable
whether system mailbox work is due
whether an idle checkpoint is safe
```

The runtime knows all of that after restore/import. It already detects fresh conversation input and foreground assistant passes inside `workspace-assistant-phase.ts`. It also has active-turn mailbox refresh ports, so new input can be folded into active turns without Cloudflare understanding the turn state. 

Adding a Cloudflare `foreground | background` priority field is still extra scheduler logic. It would be better than the current mess, but still not minimal.

## Final migration guide

### Target architecture

```txt
Webhook / sweeper / timer
  -> UserRunner.nudge()
  -> wakePending = true
  -> alarm now
  -> Cloudflare invokes container.runRuntimeWake()
  -> Murph runtime imports mailbox first
  -> Murph runtime prioritizes internally
  -> runtime returns nextWakeAt + deferredCheckpoint info
  -> Cloudflare schedules next wake / idle checkpoint
```

Cloudflare keeps only:

```txt
wakePending
nextWakeAt
idleCheckpointIntent
activeWriteFence
retryAt
```

Cloudflare deletes:

```txt
foreground/background priority
heartbeat yield
stale heartbeat recovery
container-stopped lifecycle state
pending nudge vs pending work split
browser-vault refresh side scheduler
worker-version active invocation recovery
local active invocation recovery
eager destroy for ordinary preemption
```

The current Cloudflare runner schema is much larger than this: it tracks active invocation id, heartbeat timestamp, container stopped time, orphan observation, pending nudge, pending work, retry failure count, idle checkpoint mirror fields, and more.  That is the stuff to cut.

---

## Phase 1 — make every nudge identical

Change every wake source to the same Cloudflare action:

```ts
async function nudgeHostedRunner() {
  await stateStore.markWakePending();
  await clearIdleCheckpointIntent();
  await setAlarmNow();
  void kickDrain();
}
```

This applies to:

```txt
iMessage/Linq webhook
typing warmup
device-sync dirty sweeper
scheduled notification
manual run
retry
browser-vault refresh request
```

No Cloudflare priority field. No `reason: "foreground" | "background"`. No decision beyond “wake needed.”

Keep the existing nudge route API compatible temporarily, but ignore priority-ish semantics.

---

## Phase 2 — shrink runner state

Replace the current runner state with:

```ts
type RunnerState = {
  userId: string;

  wakePending: boolean;
  nextWakeAt: string | null;

  activeRun: {
    attemptId: string;
    generation: number;
    expiresAt: string;
    kind: "runtime" | "idle_checkpoint";
  } | null;

  idleCheckpoint: {
    dueAt: string;
    workspaceVersion: string;
    checkpointNextWakeAt: string | null;
  } | null;

  retry: {
    at: string | null;
    count: number;
    lastErrorCode: string | null;
  };
};
```

The `activeRun` is **not** scheduler state. It is only a write fence. Old containers may still exist, but their writes fail if generation/attempt does not match.

Delete or stop reading:

```txt
pending_nudge
pending_work
pending_nudge_generation
in_flight
active_invocation_last_heartbeat_at
active_invocation_orphan_observed_at
active_invocation_container_stopped_at
active_invocation_worker_version_id
active_invocation_consumed_pending_work
idle_shutdown_checkpoint_due_at mirror columns
deferred checkpoint mailbox status from runner state unless only needed for UI
```

---

## Phase 3 — one drain loop, one mutex

Cloudflare should have one in-memory mutex:

```ts
private drainRunning = false;

async function kickDrain() {
  if (this.drainRunning) return;

  this.drainRunning = true;
  try {
    while (true) {
      const state = await readState();

      if (state.wakePending || due(state.nextWakeAt) || due(state.retry.at)) {
        await runRuntimeWake();
        continue;
      }

      if (state.idleCheckpoint && due(state.idleCheckpoint.dueAt)) {
        await runIdleCheckpointIfWarm();
        continue;
      }

      await syncAlarm();
      return;
    }
  } finally {
    this.drainRunning = false;
  }
}
```

If a nudge arrives while the drain is running:

```txt
set wakePending = true
return immediately
```

No local stale recovery. No active-in-this-isolate branch explosion. The loop picks up the pending wake after the current bounded runtime call returns.

---

## Phase 4 — one normal runtime entrypoint

Cloudflare should call only one normal runtime method:

```ts
container.runRuntimeWake({
  userId,
  attemptId,
  generation,
  budgetMs,
});
```

The runtime does:

```txt
restore/open workspace
import mailbox first
detect fresh conversation input
run assistant/active-turn/outbox
run background lanes only when safe
return nextWakeAt
return whether idle checkpoint is needed
```

This is already the natural home for priority. `workspace-runner.ts` imports mailbox and runs assistant phase; `workspace-assistant-phase.ts` detects fresh conversation input and foreground assistant delivery; `turn-input.ts` supports active-turn mailbox refresh.   

The runtime should enforce:

```txt
import conversation mailbox before maintenance
skip system/device-sync maintenance when fresh conversation input exists
run background work only in bounded chunks
check mailbox again before any long background lane
return nextWakeAt instead of staying alive for background work
```

That replaces Cloudflare priority.

---

## Phase 5 — keep idle checkpoint, but make it the only special case

Idle checkpoint is worth keeping because foreground runs defer checkpointing and you want durability before container restart.

But it should be simple:

```txt
After runtime wake returns dirty/deferred checkpoint state:
  schedule idleCheckpoint.dueAt = now + quietWindow

On any new nudge:
  clear idleCheckpoint
  set wakePending = true

When idle checkpoint alarm fires:
  if wakePending: clear idleCheckpoint and run normal runtime wake
  else call warm-only idle checkpoint
```

The hosted runtime already has a warm-only idle checkpoint path: it reads current workspace, checks the requested version, tries to open the existing warm workspace, and skips if warm workspace is unavailable.  Keep that. Do not cold restore just to checkpoint.

Idle checkpoint entrypoint:

```ts
container.idleCheckpointIfWarm({
  userId,
  attemptId,
  generation,
  workspaceVersion,
  checkpointNextWakeAt,
});
```

Allowed outcomes:

```txt
checkpointed
skipped_not_warm
skipped_workspace_version_mismatch
```

All are terminal for the idle checkpoint intent.

---

## Phase 6 — delete heartbeat/liveness scheduler

Delete:

```txt
runner-liveness.ts
runtimeLivenessPort from Cloudflare platform
runtimeLivenessRequired
runner-control heartbeat route
recordActiveInvocationHeartbeat
resolveActiveInvocationRecoveryDecision
clearStaleInvocationIfExpired
heartbeat stale alarms
heartbeat yield
worker-version mismatch recovery
startup timeout recovery
```

Use only:

```txt
container call timeout
write fence generation
retry after failed runtime call
```

A live runtime does not need to prove liveness to Cloudflare every few seconds. It just needs to finish within a bounded budget, and any stale writes need to fail.

---

## Phase 7 — delete container-stopped lifecycle state

Delete:

```txt
recordActiveInvocationContainerStopped
active_invocation_container_stopped_at
abortActiveWorkspaceInvocationAfterContainerStop
container stopped recovery paths
```

A stopped container is not a separate state. It means:

```txt
runtime call failed
wakePending = true
retryAt = now + backoff
```

That is enough.

---

## Phase 8 — move browser-vault refresh out of UserRunner scheduling

Delete the UserRunner-side browser-vault refresh intent:

```txt
BROWSER_VAULT_REFRESH_INTENT_STORAGE_KEY
scheduleBrowserVaultRefreshForUser special scheduler
readExtraWakeAt
runPendingBrowserVaultRefreshBeforeFutureRunnerAlarm
```

Browser-vault refresh becomes normal runtime work:

```txt
external browser-vault refresh request -> append/mark runtime-visible work -> nudge runner
runtime decides when to refresh
```

This also lets `RunnerRuntimeAlarmScheduler` collapse. Today it exists partly to merge runner alarm with extra browser-vault wake time.  After removing that side channel, alarm scheduling is just earliest of:

```txt
wakePending ? now : null
nextWakeAt
retryAt
idleCheckpoint.dueAt
```

---

## Phase 9 — write fence only at mutable boundaries

Keep generation/attempt headers for:

```txt
workspace checkpoint
artifact writes
browser-vault replica writes
provider effects / outbox delivery
email/Linq/Telegram/WhatsApp sends
```

Do not use them for:

```txt
scheduling
heartbeat
stale recovery
foreground/background priority
container liveness
```

That is the biggest conceptual cleanup. A lease is a **write fence**, not a scheduler.

---

## Minimal final Cloudflare state machine

```ts
async function runRuntimeWake() {
  const run = createActiveRun("runtime");

  await updateState({
    wakePending: false,
    activeRun: run,
  });

  try {
    const result = await container.runRuntimeWake({
      attemptId: run.attemptId,
      generation: run.generation,
      userId,
    });

    await completeRun(run, {
      nextWakeAt: result.nextWakeAt ?? null,
      idleCheckpoint: result.deferredCheckpointRequired
        ? {
            dueAt: nowPlus(IDLE_CHECKPOINT_QUIET_MS),
            workspaceVersion: result.workspaceVersion,
            checkpointNextWakeAt: result.nextWakeAt ?? null,
          }
        : null,
      retry: emptyRetry(),
    });
  } catch (error) {
    await failRun(run, {
      wakePending: true,
      retry: nextRetry(error),
    });
  }
}
```

```ts
async function runIdleCheckpointIfWarm() {
  const state = await readState();

  if (!state.idleCheckpoint || state.wakePending) {
    await clearIdleCheckpoint();
    return;
  }

  const run = createActiveRun("idle_checkpoint");
  await setActiveRun(run);

  try {
    const result = await container.idleCheckpointIfWarm({
      attemptId: run.attemptId,
      generation: run.generation,
      userId,
      workspaceVersion: state.idleCheckpoint.workspaceVersion,
      checkpointNextWakeAt: state.idleCheckpoint.checkpointNextWakeAt,
    });

    await completeRun(run, {
      idleCheckpoint: null,
      nextWakeAt: result.nextWakeAt ?? state.nextWakeAt,
    });
  } catch {
    // Best effort. Do not block foreground.
    await completeRun(run, {
      idleCheckpoint: null,
    });
  }
}
```

## What this removes from the plan

No Cloudflare runtime priority section.

Replace it with one runtime invariant:

```txt
Runtime wake always imports mailbox before maintenance/background work.
Fresh conversation input suppresses system/device-sync/background lanes for that pass.
Background lanes are bounded and cooperative.
```

That is all. Cloudflare only sees wake/no-wake.

## Final invariant for the migration doc

```txt
Cloudflare is a durable wake executor and write-fence host.
Murph runtime is the scheduler.
Idle checkpoint is warm-only maintenance.
No heartbeat, no foreground/background Cloudflare priority, no container lifecycle state machine.
```

That is the absolute simplest shape I would aim for.
Status: completed
Updated: 2026-05-11
Completed: 2026-05-11
