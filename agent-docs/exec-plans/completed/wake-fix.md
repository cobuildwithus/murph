I’m **not positive that my first version was the exact best implementation shape**. After stress-testing against the code, I’d sharpen it.

I am much more confident about the **core invariant**:

> **Mailbox lag is durable truth. Cloudflare wake acceptance is never completion. Cloudflare should reconcile, not decide.**

But given your constraint — **Cloudflare should be a very thin runner over the Murph runtime** — I would **not** add much durable scheduler state to Cloudflare. The best long-term architecture is even simpler:

> **Web/runtime is the scheduler-of-record. Cloudflare is only a lease, alarm, retry, and container runner.**

That means the web/runtime layer owns:

```ts
mailbox high-water
checkpointed imported seq
workspace.nextWakeAt
workspace.nextWakeReason
workspace.version
```

Cloudflare owns only:

```ts
active write fence
runtime retry/backoff
one operational alarm
container wake/start
```

No semantic “work completed” state should live in Cloudflare.

---

## What the code confirms

The architecture direction is right because the durable truth already exists.

`computeHostedMailboxLaneLag` computes lag from mailbox high-water versus checkpointed imported seq in workspace redacted status. That is exactly the durable completion condition we want. It does **not** depend on whether a nudge, IPC wake, alarm, or workflow was accepted. 

The web runtime status route already exposes this to Cloudflare by reading workspace state, reading mailbox max seq by lane, and returning `mailboxLag` plus workspace `nextWakeAt` / `nextWakeReason`. So Cloudflare does not need to invent its own durable mailbox queue. 

The runtime also already starts by importing mailbox before running the assistant foreground pass. That part is structurally good. The runtime reads/restores workspace, prepares runtime, performs initial mailbox import, and then runs the foreground pass.  

So the target architecture is not a huge rewrite. It is mostly a **scheduler authority cleanup**.

---

## What the code contradicts in my first answer

The main thing I would revise: I would **not** split Cloudflare into durable `assistantNextWakeAt` plus mailbox lag state.

Cloudflare should not own `assistantNextWakeAt` durably at all. The hosted workspace table already owns `nextWakeAt`, `nextWakeReason`, `redactedStatusJson`, `checkpointedAt`, and versioned checkpointing. The web store updates those fields during workspace checkpoint. 

So the better architecture is:

```txt
Web/runtime:
  durable scheduler state

Cloudflare:
  operational runner state
```

Cloudflare can cache or alarm on a wake time, but that wake time should be a **projection**, not truth.

---

## The concrete current bug pattern in code

There are three real problems.

### 1. `wake_at` is overloaded

Cloudflare’s `RunnerStateStore` has a single `wake_at`. It is used for generic nudges, runtime schedule, retry interaction, and runtime result scheduling. `markWakePending`, `scheduleNextWake`, failure handling, and write-fence preemption all write to the same field.  

That would be survivable if it were only an alarm cache. But `normalizePreferredWakeAt` clamps past values to now:

```ts
return new Date(Math.max(parsedMs, Date.now())).toISOString()
```

So a stale assistant wake can become an immediate Cloudflare wake repeatedly. 

The subtle fix is not “never run past wakes.” A due assistant wake may be valid once. The bug is:

```txt
same stale assistant wake survives a runtime pass
→ Cloudflare normalizes it to now again
→ loop
```

So the correct rule is:

```txt
Past mailbox/retry wake: operationally okay.
Past assistant wake after a completed runtime pass: stale/invalid, do not clamp forever.
```

That distinction cannot be represented by generic `normalizePreferredWakeAt`.

---

### 2. Demand ordering still lets scheduled/runtime state preempt mailbox lag

`readRunnerProgressDemand()` currently checks Cloudflare state first:

```ts
if writeFence -> active-runtime
else if due runtime wake -> scheduled-runtime
else check mailbox backlog
```

That means mailbox lag is only consulted after no active write fence and no due scheduled runtime. 

That ordering is almost exactly the issue class you described. If a stale scheduled wake is due, Cloudflare may choose scheduled runtime before it even asks whether mailbox lag exists. If a write fence is active, Cloudflare wakes the active runtime and returns “processing ensured,” but it still has not proven the mailbox checkpoint advanced. 

The correct ordering is not:

```txt
active runtime
scheduled runtime
mailbox backlog
```

It should be:

```txt
read web/runtime demand first
mailbox lag exists? that is the demand
then decide whether to wake active runtime or start runtime
```

Active write fence is a **transport condition**, not a demand class.

---

### 3. Wake acceptance is explicitly best-effort

The container wake path confirms this. `RunnerContainer.ensureProcessing()` calls `wakeRuntime()` for an active runtime; if the child accepts, Cloudflare returns `accepted`. But that only means the child accepted a runtime wake signal. 

The container entrypoint implements `/internal/runtime-wake` by calling `activeRuntimeWake?.()` and returning `x-runtime-wake-accepted`. That is an IPC/signal acceptance result, not a mailbox-import result. 

The isolated child runner makes this even clearer: when the child reports wake readiness, Cloudflare exposes a `sendWake()` callback; the comment says the wake is best-effort and “durable runner wake state remains pending.” 

And the runtime wake signal itself is intentionally coalescing. It can collapse bursts, hold a pending bit, resolve waiters, or be consumed later. That is good for runtime ergonomics, but it is not a durable completion primitive. 

So yes: `accepted` must stay a telemetry/status word, never a correctness word.

---

## The architecture I’d actually ship

### One sentence

**Cloudflare should call `reconcile()`, and `reconcile()` should derive demand from web/runtime status; mailbox lag beats assistant timers; active runtime wake acceptance only schedules a recheck; completion is only `mailboxLag === 0`.**

---

## Minimal model

### Web/runtime owns this

```ts
type WebSchedulerTruth = {
  workspaceVersion: string
  nextWakeAt: string | null
  nextWakeReason: "assistant" | "mailbox" | string | null
  mailboxLag: Array<{
    lane: "conversation" | "system"
    maxSeq: string
    importedSeq: string
    lag: string
  }>
}
```

This is basically already present through hosted runtime status.

Long term, I would make it even cleaner by adding a web-owned projection:

```ts
type RuntimeDemand =
  | { kind: "mailbox_backlog"; earliestWakeAt: string }
  | { kind: "assistant_timer"; wakeAt: string }
  | { kind: "idle"; nextWakeAt: string | null }
```

Then Cloudflare does not duplicate scheduler logic at all.

---

### Cloudflare owns this

```ts
type CloudflareRunnerState = {
  activeWriteFence: WriteFence | null
  retryBackoffUntil: string | null
  failureCount: number
}
```

That is it.

Cloudflare may still set one alarm, but the alarm is derived:

```ts
nextAlarmAt = min(
  activeWriteFence?.expiresAt,
  retryBackoffUntil,
  webDemand.nextWakeAt,
  shortRecheckAtIfMailboxLagAndActiveRuntime,
)
```

The alarm is not durable truth. It is just how Cloudflare gets called again.

---

## The key reconcile loop

I would want something like this, conceptually:

```ts
async function reconcileRunner(userId: string, trigger: RunnerTrigger) {
  const record = await stateStore.readState()
  const status = await readHostedRuntimeStatusFromWeb(userId)

  const mailboxBacklog = hasMailboxBacklog(status.mailboxLag)
  const now = Date.now()

  if (record.writeFence) {
    if (mailboxBacklog) {
      await wakeActiveRuntimeBestEffort(record.writeFence)

      // Important: accepted wake is not completion.
      // Keep checking until web status says lag is gone.
      await syncAlarmAt(new Date(now + 1_000).toISOString())

      return {
        kind: "processing-ensured",
        completion: "not-proven",
        demand: "mailbox_backlog",
      }
    }

    await syncAlarmAt(record.writeFence.expiresAt)
    return {
      kind: "processing-ensured",
      demand: "active_runtime",
    }
  }

  if (isBackoffActive(record, now)) {
    await syncAlarmAt(record.backoffUntil)
    return {
      kind: "retry-scheduled",
      demand: mailboxBacklog ? "mailbox_backlog_blocked_by_backoff" : "retry",
    }
  }

  if (mailboxBacklog) {
    return await startRuntime({
      reason: "mailbox",
    })
  }

  const assistantWake = resolveValidAssistantWake(status.workspace)

  if (assistantWake?.due) {
    return await startRuntime({
      reason: "wake",
    })
  }

  await syncAlarmAt(assistantWake?.futureAt ?? null)

  return {
    kind: "caught-up",
    demand: "idle",
  }
}
```

The important part is that `record.writeFence` changes **how** Cloudflare services demand. It does not decide **whether** demand exists.

---

## The biggest code change

I would change `readRunnerProgressDemand()` first.

Current conceptual ordering:

```ts
const due = await stateStore.readDueWork(now)

if (due.record.writeFence) return activeRuntime
if (due.kind === "runtime") return scheduledRuntime

return readMailboxBacklogDemand(due.record)
```

Better conceptual ordering:

```ts
const due = await stateStore.readDueWork(now)
const webStatus = await readHostedRuntimeStatusFromWeb(due.record.userId)

if (hasMailboxBacklog(webStatus.mailboxLag)) {
  return {
    kind: "mailbox-backlog",
    record: due.record,
    webStatus,
  }
}

if (due.record.writeFence) {
  return {
    kind: "active-runtime",
    record: due.record,
    webStatus,
  }
}

if (due.kind === "runtime") {
  return {
    kind: "scheduled-runtime",
    reason: due.reason,
    record: due.record,
    webStatus,
  }
}

return null
```

Then, in the active write-fence branch:

```ts
if (record.writeFence && demand.kind === "mailbox-backlog") {
  const wake = await ensureActiveRuntimeProcessing(...)

  // Even if wake.kind === "accepted":
  await syncAlarmAt(new Date(Date.now() + 1_000).toISOString())

  return processingEnsuredButNotComplete
}
```

That one change directly addresses the observed issue:

```txt
message appended
direct nudge accepted
active write fence exists
IPC wake accepted
foreground import may or may not happen
Cloudflare rechecks durable lag
```

Instead of:

```txt
IPC accepted
Cloudflare assumes enough happened
message waits for stale cadence
```

---

## The second biggest code change

Stop letting stale assistant wakes enter Cloudflare’s generic `wake_at`.

Right now runtime completion calls `scheduleAfterRuntimeWake`, which writes `result.nextWakeAt` through `stateStore.scheduleNextWake`; that eventually uses `normalizePreferredWakeAt`, which clamps past dates to now.  

I would replace this:

```ts
await this.scheduleAfterRuntimeWake({ result })
```

with this:

```ts
await this.reconcileAfterRuntimeWake()
```

Where `reconcileAfterRuntimeWake()` reads web status again and derives the next alarm from authoritative workspace state.

Even better: validate stale assistant wakes at the web/runtime checkpoint boundary. If the runtime checkpoints:

```ts
nextWakeReason: "assistant"
nextWakeAt <= checkpointedAt
```

then either clear it or mark it invalid unless there is a very explicit “run immediately again” reason. The workspace checkpoint path is already where `nextWakeAt`, `nextWakeReason`, and `redactedStatusJson` are durably written. 

---

## What I would not do

I would **not** build a more elaborate Cloudflare scheduler.

I would not add:

```ts
cloudflareMailboxHighWater
cloudflareImportedSeq
cloudflareAssistantNextWakeGeneration
cloudflarePerLaneDemandState
cloudflareWakeReasonStateMachine
```

That makes Cloudflare thicker and creates a second scheduler.

The runtime/web side already has the meaningful durable facts. Cloudflare should ask web:

```txt
what is the durable demand?
```

Then Cloudflare should do the least possible thing to get the runtime to process it.

---

## What about the foreground import loop?

The code confirms your suspicion: the foreground conversation mailbox import loop is started around the assistant foreground phase and stopped in `finally`. It waits on `runtimeWakeSignal`, imports the conversation lane with reason `active_turn_input`, and notifies active turn input availability.  

But I would **not** try to make correctness depend on proving that this loop is alive.

That is the tempting but wrong fix:

```txt
make wake ack come from the foreground importer itself
```

That may reduce false positives, but it is still edge-triggered. It still has races around checkpointing, loop teardown, process death, and coalescing.

The durable fix remains:

```txt
after a wake, check mailbox lag
```

If the loop imported and checkpointed the message, lag goes to zero. If it did not, lag remains nonzero and Cloudflare keeps reconciling.

---

## Final recommendation

I’d ship this architecture:

```txt
1. Web/runtime owns scheduler truth.
2. Cloudflare owns only runner lease, retry, and alarm mechanics.
3. Every Cloudflare nudge/alarm/completion calls reconcile.
4. Reconcile reads web status before deciding demand.
5. mailboxLag > 0 always preempts assistant timers.
6. If runtime is active and mailboxLag > 0, wake active runtime but schedule short recheck.
7. accepted wake is never completion.
8. stale assistant nextWakeAt is validated/cleared by web/runtime, not generically clamped by Cloudflare.
9. one Cloudflare alarm remains, but it is derived from web demand plus retry/fence expiry.
```

So, adjusted answer:

> **Yes, I’m confident this is the simplest durable long-term direction. But the cleanest version is not “Cloudflare becomes a better scheduler.” It is “Cloudflare stops being a scheduler.”**

Cloudflare should be a runner adapter. Murph runtime/web should own the durable scheduler truth.
Status: completed
Updated: 2026-05-17
Completed: 2026-05-17
