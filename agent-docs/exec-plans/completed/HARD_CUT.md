Yeah. I agree with the hard cut: **idle-only checkpointing, minimal Cloudflare, browser vault fully background/derived.** The current code is still carrying too many halfway architectures.

The clearest contradiction I found: the completed plan says the bridge should reject every checkpoint reason except `idle_shutdown`, no longer import/call the working-delta writer, and make production snapshot construction idle-shutdown-only.  But live `runtime-bridge-workspace.ts` still imports working snapshot helpers, accepts `activation_bootstrap`, and calls `createWorkingDeltaSnapshot(...)` on the idle path when base/current refs exist.  That is not the hard cut.

## The hard-cut target

Cloudflare should do exactly this:

```text
nudge arrives
  -> mark user has pending work
  -> if no invocation is active, invoke container

container invocation
  -> restore vault/workspace
  -> import mailbox/device dirty work
  -> run local Murph until idle/budget
  -> return status/next wake/deferred dirty bit

when foreground invocation is idle
  -> schedule one idle checkpoint alarm

idle checkpoint alarm
  -> if new work arrived, run foreground work instead
  -> otherwise invoke container with idle_shutdown_checkpoint
  -> runtime writes one full/base workspace snapshot
  -> if no new work arrived, destroy warm container
```

Browser vault:

```text
successful idle checkpoint
  -> best-effort background browser-vault replica refresh
  -> failure never affects runner state, checkpoint state, reply state, or alarms
```

That is it.

## Non-negotiable invariants

1. **No foreground snapshot construction.** Mailbox import, active-turn input, assistant runtime commits, outbox state, provider cleanup, system mailbox receipts, and canonical writes can mark local state dirty, but they cannot build/publish a workspace snapshot.

2. **Only idle shutdown writes hosted workspace snapshots.** The only live Cloudflare bridge checkpoint reason allowed to build a snapshot is `idle_shutdown`.

3. **Idle checkpoint writes full/base only.** No new working `{base, delta}` refs. No hot refs. No path-scoped foreground deltas. Legacy working/hot refs can stay readable for restore compatibility, but production must not create them.

4. **Cloudflare owns coordination, not runtime semantics.** No mailbox progress truth, no outbox truth, no assistant completion truth, no browser-vault correctness, no checkpoint recovery truth.

5. **One scheduler. One alarm. One state machine.** Current code persists `pending_nudge`, `next_wake_at`, `idle_shutdown_checkpoint_due_at`, `deferred_checkpoint_required`, `in_flight`, `active_invocation_*`, retry state, and browser-vault pending state in the same runner store.  That should be collapsed.

6. **Browser vault cannot share the critical runner alarm loop.** Today `BrowserVaultRefreshCoordinator` reads runner state, sets alarms, yields to runner alarms, aborts for foreground work, and retries through the same Durable Object scheduling system.  That is too entangled.

7. **The container does not own durable lifecycle policy.** Today `RunnerContainer` has its own activity expiry, durable activity liveness record, active invocation count, renewal loop, browser-vault refresh invocation, and warm-shell stop behavior.  The Durable Object should own checkpoint-before-destroy; container activity expiry should be fallback cleanup only.

## Hard-cut plan

### Phase 0 — Add red tests before deleting code

Add these tests first so the simplification has teeth.

For `runtime-bridge-workspace.ts`:

```text
idle_shutdown checkpoint produces direct full/base bundle ref
idle_shutdown never produces working {base, delta}
idle_shutdown never calls snapshotHostedPortableWorkspaceDelta
activation_bootstrap is rejected by bridge snapshot creation
all foreground reasons are rejected by bridge snapshot creation
legacy working refs remain restorable but are never produced
```

For `HostedUserRunner`:

```text
nudge while idle starts one foreground invocation
nudge while active only marks pending work and does not create a second invocation
foreground idle schedules exactly one idle_checkpoint alarm
idle_checkpoint alarm invokes container with idle_shutdown_checkpoint
new nudge before idle checkpoint cancels checkpoint and runs foreground
new nudge during idle checkpoint prevents destroy and schedules/runs foreground
idle checkpoint success destroys warm container only if pendingWork=false
browser-vault refresh failure cannot affect runner alarm/state
```

For E2E:

```text
message -> foreground reply path -> idle checkpoint -> cold restore -> no duplicate reply
message -> foreground local state dirty -> container death before idle checkpoint -> replay is safe/idempotent
idle checkpoint writes full/base snapshot from effective restored state
browser-vault replica missing/failing does not block reply or checkpoint
```

The existing tests currently encode a lot of complex behavior around pending nudges, alarms, retries, active invocation follow-ups, and user deletion.  Keep the user-deletion coverage, but replace most scheduler tests with the simpler state machine.

---

### Phase 1 — Hard-cut the checkpoint writer

Modify `apps/cloudflare/src/runtime-bridge-workspace.ts`.

Delete production working-delta writer imports and code:

```ts
buildHostedExecutionWorkingSnapshotRef
snapshotHostedPortableWorkspaceDelta
readHostedPortableWorkspaceDeltaManifestFromBundle // only keep if restore compatibility needs it elsewhere
createWorkingDeltaSnapshot
HostedWorkspaceBridgeWorkingDeltaSnapshotInput
HostedWorkspaceCheckpointCommitKind entries for "working_delta" / "working_unchanged"
HostedWorkspaceCheckpointSnapshotMode "delta"
HostedWorkspaceCheckpointPolicy "working_delta"
```

Change:

```ts
type HostedWorkspaceFullCheckpointRequest =
  HostedWorkspaceCheckpointRequest & { reason: "activation_bootstrap" | "idle_shutdown" };
```

to:

```ts
type HostedWorkspaceIdleCheckpointRequest =
  HostedWorkspaceCheckpointRequest & { reason: "idle_shutdown" };
```

Change `requireHostedWorkspaceBridgeFullCheckpointRequest` to:

```ts
function requireHostedWorkspaceBridgeIdleCheckpointRequest(
  request: HostedWorkspaceCheckpointRequest,
): HostedWorkspaceIdleCheckpointRequest {
  if (request.reason !== "idle_shutdown") {
    throw new Error("Hosted workspace snapshot construction is idle-shutdown only.");
  }

  return {
    ...request,
    reason: "idle_shutdown",
  };
}
```

Change `createHostedWorkspaceBridgeCheckpointSnapshot` to:

```text
read current committed snapshot state if present
read effective preserved state if current snapshot exists
always call createFullSnapshot(...)
if no prior base/current snapshot exists, commitKind = "full_seed"
otherwise commitKind = "full_compaction"
```

No more:

```ts
if (request.reason === "idle_shutdown" && base && manifest && current && preserved) {
  return await createWorkingDeltaSnapshot(...);
}
```

Also remove “idle shutdown snapshot skip” for committed-state unavailable unless it is truly “nothing exists yet.” If state is dirty and the committed state cannot be read, fail and retry. Silent skip is the wrong failure mode for “save before shutdown.”

Keep legacy full/working/hot **restore** support. Delete legacy production.

---

### Phase 2 — Remove `activation_bootstrap` from the live runner checkpoint path

`runtime-control.ts` still lists many checkpoint reasons, including `activation_bootstrap`, foreground reasons, and `idle_shutdown`.  Keep the enum initially for compatibility, but change live producer behavior:

```text
foreground path: never snapshot
idle_shutdown path: full/base snapshot
new user with no workspace: start from empty/template local workspace, first idle checkpoint writes first base
```

In `packages/assistant-runtime/src/hosted-runtime.ts`, foreground currently has a special exception where `workspacePort.checkpoint` allows `activation_bootstrap`, and the foreground checkpoint builder can build a snapshot for `activation_bootstrap`.  Remove that exception.

Target foreground `workspacePort.checkpoint`:

```ts
async checkpoint(request) {
  throw new Error("Foreground hosted runner must not checkpoint workspace.");
}
```

Target foreground snapshot builder:

```ts
async createRequest(requestInput) {
  throw new Error("Foreground hosted runner must not build workspace checkpoint snapshots.");
}
```

New-user bootstrap options:

```text
preferred: web creates deterministic initial HostedWorkspace outside runner
acceptable: first foreground run restores null workspace as empty/template and first idle checkpoint creates base
not acceptable: Cloudflare runner produces activation_bootstrap checkpoint
```

---

### Phase 3 — Replace runner state with one minimal state record

Current `runner_meta` schema is carrying too much: active invocation fields, active workspace version, `in_flight`, last error, last invocation, `deferred_checkpoint_required`, idle checkpoint due/version, next wake, pending nudge, retry count. 

Replace it with a v2 state shape like:

```ts
type RunnerAlarmKind = "work" | "idle_checkpoint";

type RunnerStateV2 = {
  schema: "murph.hosted-runner.v2";
  userId: string;

  active: null | {
    attemptId: string;
    leaseGeneration: number;
    reason: "work" | "idle_checkpoint";
    startedAt: string;
    expiresAt: string;
    workspaceVersion: string | null;
  };

  pendingWork: boolean;

  alarm: null | {
    kind: RunnerAlarmKind;
    dueAt: string;
    workspaceVersion: string | null;
  };

  retry: {
    count: number;
    lastErrorAt: string | null;
    lastErrorCode: string | null;
  };

  lastInvocationAt: string | null;
};
```

Delete these as first-class state concepts:

```text
next_wake_at
idle_shutdown_checkpoint_due_at
idle_shutdown_checkpoint_workspace_version
deferred_checkpoint_required
pending_nudge name/semantics
in_flight separate from active invocation
active_invocation_orphan_observed_at
pending browser-vault refresh slot in runner state
```

The scheduler should never compare two clocks. Today `consumeDueRunnerAlarm` chooses between `next_wake_at` and `idle_shutdown_checkpoint_due_at`, with a special deferred checkpoint override.  Delete that whole category.

New scheduler API:

```ts
readState(): RunnerStateV2
markPendingWork(): RunnerStateV2
beginInvocation(reason): Lease
completeInvocation(lease): RunnerStateV2
failInvocation(lease, error): RunnerStateV2
scheduleAlarm(kind, dueAt, workspaceVersion?): RunnerStateV2
clearAlarm(kind?): RunnerStateV2
consumeDueAlarm(now): null | { kind, workspaceVersion }
```

`RunnerRuntimeAlarmScheduler` should no longer compute earliest of two possible runner alarms. It should just set/delete the one stored alarm. Today it computes earliest of `nextWakeAt` and `idleShutdownCheckpointDueAt`. 

---

### Phase 4 — Rewrite `HostedUserRunner` around three operations

`HostedUserRunner` should shrink to:

```ts
bindUser(userId)
nudge(userId)
alarm()
runInvocation(kind)
```

#### `nudge(userId)`

```ts
async nudge(userId: string) {
  state.bindUser(userId)
  state.markPendingWork()

  if (state.active) {
    // active runtime heartbeat will see pendingWork=true
    scheduleAlarm("work", state.active.expiresAt)
    return { accepted: true, alreadyRunning: true }
  }

  scheduleAlarm("work", now)
  startDetachedDrive("work")
  return { accepted: true, alreadyRunning: false, immediateDriveStarted: true }
}
```

No browser-vault abort. No usage-gate fetch. No checkpoint preemption logic. No pending drive queue.

#### `alarm()`

```ts
async alarm() {
  const due = state.consumeDueAlarm(now)
  if (!due) return

  if (state.active) {
    scheduleAlarm(due.kind, state.active.expiresAt)
    return
  }

  if (due.kind === "idle_checkpoint" && state.pendingWork) {
    scheduleAlarm("work", now)
    startDetachedDrive("work")
    return
  }

  startDetachedDrive(due.kind)
}
```

#### `runInvocation("work")`

```ts
begin active lease
clear pendingWork at invocation start
invoke container reason "nudge" or "alarm" // keep wire-compatible for now
on result:
  complete active
  if pendingWork:
    schedule work immediately
  else if result.status === "scheduled" || result.nextWakeAt is soon:
    schedule work at result.nextWakeAt
  else:
    schedule idle_checkpoint at now + idleCheckpointDelay
on failure:
  fail active
  schedule work retry
```

One subtlety: if foreground work changed local state and returned a future runtime wake, checkpoint should happen before the container is allowed to disappear. The simplest hard-cut rule is:

```text
after every successful foreground invocation that reaches idle, schedule idle_checkpoint before any long future wake
```

If `nextWakeAt` is immediate/near, run work. Otherwise checkpoint first, then let the checkpointed workspace’s `nextWakeAt` become the durable future wake.

#### `runInvocation("idle_checkpoint")`

```ts
if pendingWork:
  schedule work immediately
  return

begin active lease with reason idle_checkpoint
invoke container reason "idle_shutdown_checkpoint"
on success:
  complete active
  if pendingWork:
    schedule work immediately
  else:
    destroy container
    if result.nextWakeAt:
      schedule work at result.nextWakeAt
    else:
      clear alarm
on failure:
  fail active
  if pendingWork:
    schedule work immediately
  else:
    schedule idle_checkpoint retry
```

Do not run browser vault here. At most enqueue background refresh after success.

---

### Phase 5 — Make liveness match the simple state model

Keep only the liveness semantics needed for cancellation:

```text
foreground heartbeat:
  returns inputAvailable = pendingWork

idle checkpoint heartbeat:
  if pendingWork=true, abort idle checkpoint and return scheduled
```

The existing runtime already has a useful pattern: idle-shutdown detects input availability and returns `scheduled` rather than continuing checkpoint.  Keep that. Remove the state-store special cases that deny lease ownership based on pending nudge/deferred checkpoint. Lease ownership should be lease ownership; cancellation should be explicit liveness.

---

### Phase 6 — Fully detach browser-vault refresh

Delete `BrowserVaultRefreshCoordinator` from `HostedUserRunner`.

Delete from runner state:

```text
PENDING_BROWSER_VAULT_REFRESH_STORAGE_KEY
scheduleBrowserVaultRefresh()
readPendingBrowserVaultRefresh()
clearPendingBrowserVaultRefresh()
```

Add a separate background path:

```ts
class BrowserVaultReplicaBackgroundRefresh {
  scheduleAfterCheckpoint(userId, snapshotRef) {
    state.waitUntil(this.refreshLatestCommittedWorkspace(userId, snapshotRef))
  }
}
```

Rules:

```text
only runs after committed full/base checkpoint
reads latest committed HostedWorkspace
if source snapshot changed, publish latest replica or no-op
never writes runner alarm
never reads/writes runner pendingWork
never blocks destroy
failure only logs
retry handled by cron/manual/background queue, not runner DO
```

The current coordinator is careful, but it is careful in the wrong place. It reads runner alarms and tries to yield to earlier runner alarms.  The correct simplification is for browser-vault to not participate in that scheduling system at all.

---

### Phase 7 — Make the container a dumb adapter

Keep:

```text
ensure container ready
install outbound proxy
POST /internal/workspace-invocation
return parsed result
destroyInstance()
smokeHealth()
```

Remove or demote:

```text
durable activity liveness record
activity expiry renewing warm shell
activeInvocationCount as lifecycle policy
browser-vault refresh lifecycle coupled to runner invocation
container deciding whether warm shell should survive as correctness policy
```

`onActivityExpired` should become:

```ts
override async onActivityExpired() {
  await this.stopWarmContainer({ failClosed: false });
}
```

The Durable Object decides when to checkpoint and destroy. The container should not try to infer durable liveness from its own persisted activity record.

Keep outbound proxy lease authorization, because the runtime still needs Worker-owned routes for mailbox payload decode/artifact/provider effects.

---

### Phase 8 — Remove synchronous usage-gate dependency from runner start

The current runner resolves an AI usage gate before non-idle invocation, and `HostedRunnerNudgeRequest` includes a signed allow decision shape.  For the minimal Cloudflare runner, avoid a live web call before the container can even start.

Hard-cut choice:

```text
web owns usage gate before append/nudge
Cloudflare may verify a signed allow-decision locally if provided
Cloudflare must not synchronously call web just to start the runner
runtime/provider layer enforces spend if needed before model call
```

This removes another reason the runner can accept a nudge but not actually start quickly.

---

### Phase 9 — Update protocol docs to match the code, not the other way around

The protocol doc already says the bridge no longer writes foreground working commits, `idle_shutdown` is the only new checkpoint snapshot producer, and foreground paths must not fall back to full/working/hot snapshots.  Keep that, but make it sharper:

```text
Cloudflare runner state is not correctness state.
Cloudflare runner state contains only active invocation, pending work, one alarm, retry metadata.
Only idle_shutdown may publish workspace snapshotRef.
All live idle_shutdown snapshots are full/base bundles.
Browser-vault refresh is background-only and cannot share runner alarm state.
```

Also update the completed plan, because it currently says the desired thing, but the code still contradicts it.

## Files to delete or heavily rewrite

### Rewrite

```text
apps/cloudflare/src/user-runner.ts
apps/cloudflare/src/user-runner/runner-state-store.ts
apps/cloudflare/src/user-runner/runner-state-schema.ts
apps/cloudflare/src/user-runner/runner-state-helpers.ts
apps/cloudflare/src/user-runner/runner-runtime-alarm-scheduler.ts
apps/cloudflare/src/runtime-bridge-workspace.ts
packages/assistant-runtime/src/hosted-runtime.ts
```

### Delete from runner critical path

```text
apps/cloudflare/src/browser-vault-refresh/coordinator.ts
```

Replace with a background-only refresh module.

### Keep, but simplify

```text
apps/cloudflare/src/runner-container.ts
```

Keep invocation/outbound proxy/destroy. Remove durable activity-liveness policy and critical-path browser-vault lifecycle coupling.

## The simplified final flow

```text
web appends mailbox item
web nudges Cloudflare

Cloudflare:
  pendingWork = true
  if !active:
    run work

work invocation:
  restore
  import mailbox
  run Murph
  return idle/scheduled/failed

Cloudflare after work:
  if pendingWork:
    run work again
  else:
    schedule idle_checkpoint

idle checkpoint:
  restore current warm/effective workspace
  full/base snapshot
  CAS web HostedWorkspace
  enqueue background browser-vault refresh
  destroy container if no pendingWork
```

## Migration / deploy shape

I would do this as one hard-cut release:

```text
reader compatibility remains:
  full/base restore stays
  legacy working restore stays
  legacy hot restore stays

producer hard cut:
  foreground produces no snapshots
  idle_shutdown produces full/base only
  browser-vault producer is background-only
```

No long-lived feature flag that keeps both models alive. No gradual “sometimes working delta, sometimes full.” That’s how this got complex.

Rollback is safer than the previous working-ref cut because this hard cut removes producer variants rather than introducing a new snapshot schema. Old refs remain readable.

## What I would not do

I would not add a better abstraction over the existing scheduler. I would not add another capability system. I would not keep `deferred_checkpoint_required` as a separate durable bit. I would not let browser-vault refresh use the same Durable Object alarm. I would not keep `activation_bootstrap` in Cloudflare runner snapshot construction. I would not let idle shutdown create working deltas.

The core fix is deletion:

```text
delete foreground snapshot producers
delete working-delta production
delete browser-vault from runner scheduler
delete dual-alarm arbitration
delete container durable lifecycle policy
```

That gets Cloudflare back to what you wanted: **a minimal runner that spins up a user’s vault, does work, snapshots full state when idle before shutdown, and can be spun up again.**
Status: completed
Updated: 2026-05-10
Completed: 2026-05-10
