# Idle Shutdown Base Checkpoint Plan

Last verified: 2026-05-06

## Goal

Collapse routine full-checkpoint complexity by taking one full/base hosted
workspace checkpoint at the end of a warm runner session, after the runner has
gone quiet and immediately before intentionally destroying the warm container.

Success means:

- successful user turns do not run a full/base snapshot just because a turn
  completed;
- repeated user activity pushes the idle checkpoint out instead of snapshotting
  stale minute-zero state;
- the full/base snapshot still runs through the existing active invocation
  lease, checkpoint CAS, R2 bundle write, and web checkpoint path;
- after a successful idle-shutdown checkpoint, the runner destroys the warm
  container instead of leaving `sleepAfter` to extend by another full idle TTL;
- hot checkpoints remain only where they are correctness fences until separate
  proof lets us remove or demote them.

## Verdict

Use the second plan's authority model, with one correction: after the
pre-sleep full checkpoint completes and no user work arrived meanwhile,
explicitly destroy the warm container.

Do not put full snapshot work directly in
`RunnerContainer.onActivityExpired()`. Cloudflare's Container docs say
`onActivityExpired()` is called when `sleepAfter` expires and an override must
call `stop()` or `destroy()` or the timer renews. The same docs describe
`sleepAfter` as activity-based, so a checkpoint request sent through the
container would itself renew activity. The repo's checkpoint path also requires
an active invocation lease before snapshot, before bundle write, before the web
checkpoint, and after the web checkpoint. Running snapshot work in the
container idle hook would duplicate that authority path or weaken it.

The desired behavior should instead be:

```text
normal invocation completes idle
  -> schedule one idle_shutdown_checkpoint alarm for idleTtl - safetyMargin

new user activity before that alarm
  -> clear/push out the idle checkpoint
  -> run normal drain

idle_shutdown_checkpoint alarm fires and is still current
  -> start a normal lease-scoped invocation reason=idle_shutdown_checkpoint
  -> restore/reuse warm local workspace
  -> run one full checkpoint reason=idle_shutdown
  -> if no pending nudge appeared, destroy the warm container
```

This gives the product behavior the shutdown-hook plan wanted while preserving
the repo's existing trust and recovery boundaries.

## Final Revised Plan

The final shape after code review and five-agent stress testing is:

```text
normal invocation completes idle with hot/layered state
  -> schedule one idle_shutdown_checkpoint alarm for idleTtl - safetyMargin

fresh user activity before that alarm
  -> clear the idle checkpoint fields
  -> preserve/schedule the normal pending nudge path

idle_shutdown_checkpoint alarm fires
  -> consume only that due idle alarm candidate
  -> preflight current workspace version, nextWakeAt, base-only state, and pending work
  -> begin a normal invocation lease with reason=idle_shutdown_checkpoint
  -> re-check pending work after the awaited preflight/lease gap
  -> run checkpoint-only assistant-runtime path with checkpoint reason=idle_shutdown
  -> if no pending work is visible after completion, destroy the warm container
```

The stress review changed the plan in three important ways:

- idle checkpoint scheduling now re-reads Durable Object state after awaited
  web reads so a fresh nudge cannot be overwritten by a stale idle scheduler;
- idle checkpoint invocation re-checks pending nudges after the lease starts
  and skips the full checkpoint if the expiry became stale;
- idle checkpoint failures keep retry state on the idle checkpoint path and
  respect the existing max-attempt cap instead of becoming normal drain alarms.
- the checkpoint-only runtime path performs an extra liveness touch before
  snapshot construction and races snapshot request creation against liveness so
  late user input cannot be committed as an idle checkpoint;
- warm-container cleanup re-reads runner state after destroy returns and
  preserves any freshly scheduled nudge/recovery alarm instead of clearing it.

## Evidence Read

Cloudflare docs checked:

- Container Interface:
  <https://developers.cloudflare.com/containers/container-class/>
- Container lifecycle architecture:
  <https://developers.cloudflare.com/containers/platform-details/architecture/>
- Durable Object alarms:
  <https://developers.cloudflare.com/durable-objects/api/alarms/>
- Durable Object known issues:
  <https://developers.cloudflare.com/durable-objects/platform/known-issues/>

Repo code checked:

- `apps/cloudflare/src/runner-container.ts`
- `apps/cloudflare/src/user-runner.ts`
- `apps/cloudflare/src/user-runner/runner-state-store.ts`
- `apps/cloudflare/src/user-runner/runner-state-schema.ts`
- `apps/cloudflare/src/user-runner/runner-runtime-alarm-scheduler.ts`
- `apps/cloudflare/src/runtime-bridge-workspace.ts`
- `apps/cloudflare/src/runtime-bridge-checkpoint.ts`
- `apps/cloudflare/src/runtime-platform.ts`
- `apps/cloudflare/src/container-entrypoint.ts`
- `apps/web/app/api/internal/hosted-workspace/checkpoint/route.ts`
- `apps/web/src/lib/hosted-workspace/store.ts`
- `packages/hosted-execution/src/runtime-control.ts`
- `packages/hosted-execution/src/parsers/runtime-control.ts`
- `packages/assistant-runtime/src/hosted-runtime.ts`
- `packages/assistant-runtime/src/hosted-runtime/mailbox-checkpoint.ts`
- `packages/assistant-runtime/src/hosted-runtime/workspace-runner.ts`
- `packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts`
- `packages/assistant-runtime/src/hosted-runtime/workspace-restore.ts`
- `agent-docs/references/hosted-runtime-protocol.md`

## Current Shape

`RunnerContainer` already has the right lifecycle skeleton for warm-shell
expiration:

- `sleepAfter` is derived from `HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS`;
- `noteRunnerActivity()` updates `lastRunnerActivityAt` and calls
  `renewActivityTimeout()` when available;
- `onActivityExpired()` checks `activeInvocationCount` and elapsed idle time,
  treats stale expiries as renew-and-return, and otherwise destroys the warm
  shell best-effort;
- successful invocations keep the shell warm only when the outbound proxy token
  expires cleanly.

`HostedUserRunner` is the right owner for scheduling:

- nudge acceptance persists `pending_nudge` before starting or scheduling work;
- Durable Object alarms are already the retry/backstop path;
- active invocation leases live in `runner_meta`;
- `beginInvocation()`, `bindInvocationWorkspaceVersion()`,
  `completeInvocation()`, and `failInvocation()` define the lease lifecycle;
- liveness heartbeats surface `pendingNudge` to the active runtime.

The checkpoint bridge is intentionally lease-scoped:

- full snapshots call `snapshotHostedExecutionContext()` and write
  `cloudflare-workspace-snapshots/${hash}.bundle`;
- hot snapshots call `snapshotHostedAssistantRuntimeHotState()` and write
  `cloudflare-workspace-hot-state/${hash}.bundle`;
- every checkpoint validates the current lease across snapshot and commit
  boundaries;
- web checkpoint CAS remains the workspace-version fence.

The current full/hot mapping is:

```text
full:
  maintenance
  system_mailbox_receipt

hot:
  import
  active_turn_input
  active_turn_acceptance
  outbox_sending
  outbox_receipt
```

That is the complexity to simplify, but it should be simplified after the new
idle-shutdown full checkpoint exists and is proven.

Five review-only subagents stress-tested this plan against the current code.
The final design below incorporates the shared findings: first-class invocation
reason instead of optional intent, minimal runner state, explicit alarm
classification, usage-gate bypass before lease/container work, checkpoint-only
runtime branching before mailbox/Codex setup, redacted-status preservation, and
stricter deploy ordering.

## Recommended Design

### 1. Add Explicit Invocation And Checkpoint Reasons

Add a first-class invocation reason:

```ts
"idle_shutdown_checkpoint"
```

This is intentionally simpler and safer than an optional `intent` field. The
current parsers drop unknown optional request fields, so an old warm container
could ignore `intent: "idle_shutdown_checkpoint"` and run a normal drain. A new
required invocation reason fails closed on old code instead of silently doing
assistant/mailbox work.

Keep scheduler cause visible in logs with an internal alarm due kind, not in the
runtime request shape:

```text
Durable Object alarm due kind: idle_shutdown_checkpoint
Workspace invocation request reason: idle_shutdown_checkpoint
```

Add a checkpoint reason:

```ts
"idle_shutdown"
```

Map only that new reason to full initially, keeping existing mappings unchanged
until behavior is proven:

```text
idle_shutdown -> full
maintenance -> full for now
system_mailbox_receipt -> full for now
```

Later, demote or delete the broad full reasons after targeted tests prove no
non-hot state would be lost.

The idle invocation reason must bypass the hosted AI usage gate in
`HostedUserRunner`. This is a compaction/durability operation, not paid model
work, and it must still run when the usage gate is denied or temporarily
unavailable.

### 2. Persist One Pending Idle Checkpoint

Add only the minimum Durable Object state to `runner_meta`:

```text
idle_shutdown_checkpoint_due_at TEXT
idle_shutdown_checkpoint_workspace_version TEXT
```

The persisted state is execution coordination only. It belongs in the runner
Durable Object, not web-owned product state, because it does not describe user
truth or mailbox progress.

Coalesce to at most one pending idle checkpoint per runner. Do not create a
queue.

Track schema version in a small `runner_schema_meta` table rather than
`PRAGMA user_version`. The Workers SQLite runtime rejects the relevant PRAGMA
with `SQLITE_AUTH`, so the table keeps additive migrations explicit while
staying compatible with Durable Objects.

### 3. Schedule From Idle Completion

After a normal drain invocation completes successfully:

- if `pendingNudge` is false;
- if runtime result is `status: "idle"`;
- after re-reading the web workspace, if the workspace has no earlier
  `nextWakeAt`;
- if the current snapshot is not already a plain full/base snapshot for the
  current workspace state;

then set:

```text
idle_shutdown_checkpoint_due_at =
  now + runnerIdleTtlMs - idleShutdownSafetyMarginMs
idle_shutdown_checkpoint_workspace_version =
  post-run web workspace version
```

Start with:

```text
idleShutdownSafetyMarginMs = 60_000
```

Make the safety margin env-configurable with conservative bounds. If the
configured idle TTL is too short for the margin, clamp the margin rather than
scheduling in the past.

Do not add min-interval or last-success state in the first implementation.
Duplicate suppression should come from clearing the two pending fields, matching
the due workspace version, and skipping when the current workspace already has a
base/full snapshot with no hot layer.

### 4. Clear Or Push On New Activity

When `nudgeHostedRunner()` accepts user work, clear the pending idle checkpoint
fields before scheduling the normal nudge wake.

This is the key example behavior:

```text
00:00 user texts
00:20 runner finishes
      schedule idle checkpoint for about 04:20 if ttl=5m and margin=1m

03:00 user texts again
      clear idle checkpoint
      run normal drain

03:20 runner finishes
      schedule fresh idle checkpoint for about 07:20

07:20 idle checkpoint fires
      if still idle, run full checkpoint and destroy the container
```

The checkpoint happens just before intentional destruction, not after the
minute-zero turn.

### 5. Teach The Alarm To Pick Due Work

Durable Objects support one alarm per object, so keep one scheduler that picks
the earliest due event from:

- pending nudge/retry recovery;
- runtime-returned `nextWakeAt`;
- `idle_shutdown_checkpoint_due_at`.

When the alarm fires, classify why it was due:

```text
pending nudge due -> reason=alarm
runtime nextWakeAt due -> reason=alarm
idle checkpoint due -> reason=idle_shutdown_checkpoint
```

Skip the idle checkpoint if any stale condition is true:

- `pendingNudge` is true;
- `inFlight` is true;
- due workspace version no longer matches the current web workspace version;
- the web workspace has an earlier `nextWakeAt`;
- the current workspace snapshot is already full/base-only.

Implement this as an atomic runner-state helper, not as a loose boolean layered
on the current alarm path. Replace the alarm entry's `clearNextWakeIfDue()` plus
`dueWake` boolean with a helper like:

```ts
consumeDueRunnerAlarm(now): {
  kind: "none" | "drain" | "idle_shutdown_checkpoint";
  idleWorkspaceVersion?: string;
  record: RunnerStateRecord;
}
```

It should clear only the consumed due field. This prevents a stale idle alarm
from becoming a current-version normal drain or full checkpoint.

Idle checkpoint lease start must not consume `pending_nudge`. Today
`beginInvocation()` clears `pending_nudge`; add a narrow
`consumePendingNudge` option or idle-specific begin helper and use
`consumePendingNudge: false` for `idle_shutdown_checkpoint`. After the lease is
started and after the checkpoint returns, re-read state; if a nudge is present,
schedule the normal drain and do not destroy the warm container.

### 6. Add A Checkpoint-Only Runtime Path

Add a dedicated restore-and-checkpoint-only primitive, not a wrapper around the
normal mailbox runner. In `runHostedWorkspaceRuntimeJobInProcess()`, branch on
the first-class invocation reason:

```ts
if (input.request.reason === "idle_shutdown_checkpoint") {
  return await runHostedWorkspaceIdleShutdownCheckpoint(...);
}
```

The branch point must be after:

- liveness heartbeat start and initial touch;
- workspace read;
- workspace version and user validation;
- local workspace restore/cache reuse.

The branch point must be before:

- mailbox port requirement for the normal path;
- mailbox budget setup and fetch/import;
- inbox sidecar rebuild;
- Codex runtime environment prep;
- CLI bridge startup;
- assistant phase;
- device-sync dirty pulls;
- outbox/provider cleanup;
- hosted usage recording.

The checkpoint-only path should:

- read and validate the workspace through the existing workspace port;
- restore/reuse the local warm workspace using the existing restore/cache
  path;
- create a snapshot-only checkpoint request with reason `"idle_shutdown"`;
- run the existing full snapshot builder;
- call the existing workspace checkpoint port;
- return `status: "idle"`.

Do not reuse mailbox checkpoint builders that require fake import state. The
idle checkpoint must not advance mailbox watermarks, invent mailbox import
results, or clear redacted status. Prefer omitting `redactedStatus` only if the
web callback preserves omitted status; otherwise pass through
`workspaceRead.workspace.redactedStatus`.

It should not:

- fetch or import mailbox rows;
- run assistant work;
- drain outbox sends;
- run provider cleanup;
- pull device-sync dirty state;
- record hosted AI usage;
- require the hosted AI usage gate.

This keeps the path small, testable, and composable.

### 7. Destroy After Successful Idle Checkpoint

After the idle-shutdown checkpoint invocation completes:

1. complete the idle invocation lease;
2. re-read runner state;
3. if `pendingNudge` is false and no active invocation exists, call
   an observable container-destroy helper;
4. if a nudge appeared while the snapshot was running, do not destroy; schedule
   the pending nudge continuation as the current code already does.

This avoids the main flaw in a simple pre-sleep invocation: container activity
would otherwise renew `sleepAfter` and keep the shell alive for another full
idle TTL after the checkpoint.

The existing exported `destroyHostedExecutionContainer()` swallows all errors.
For idle shutdown, keep cleanup best-effort but make the result observable in
logs/status so a destroy failure is visible and can be tested.

### 8. Keep `RunnerContainer.onActivityExpired()` Dumb

Leave `onActivityExpired()` as lifecycle cleanup only:

```text
if active invocation or stale idle expiry:
  renew/return
else:
  destroy warm shell
```

Do not add snapshot authority, workspace reads, or checkpoint callbacks there.
If the scheduled idle checkpoint fails or never runs, the container may still
sleep and the next wake restores from the latest durable checkpoint. That is a
durability/compaction miss, not a reason to weaken the trust boundary.

## Migration Sequence

1. Add shared contract/parser support for invocation reason
   `"idle_shutdown_checkpoint"` and checkpoint reason `"idle_shutdown"`.
   Include web route/store and Cloudflare proxy acceptance tests. Do not produce
   the new reason yet.
2. Add the assistant-runtime checkpoint-only path and map `"idle_shutdown"` to
   full snapshot policy. Prove it does not touch mailbox, assistant, outbox,
   provider cleanup, device dirty state, or usage.
3. Add the minimal runner state columns, projection helpers, schema migration
   seam, and atomic alarm classification.
4. Schedule/clear idle checkpoint state after normal drain completion and nudge
   acceptance.
5. Thread `"idle_shutdown_checkpoint"` through the Cloudflare runner invocation
   path, bypass the hosted AI usage gate for that reason, and ensure the idle
   lease does not consume `pending_nudge`.
6. On successful idle checkpoint completion, destroy the warm container if no
   pending nudge appeared; log destroy success/failure.
7. Add hosted-local scenario proof.
8. After production confidence, demote broad full checkpoint reasons:
   `maintenance` first, then `system_mailbox_receipt` only if activation
   bootstrap state has a separate full/base guarantee.

## Tests To Add

Cloudflare runner tests:

- normal successful drain schedules one idle checkpoint due time;
- a nudge clears a pending idle checkpoint;
- an idle checkpoint alarm skips when the web workspace version changed;
- an idle checkpoint alarm skips when `pendingNudge` is true;
- earliest-of alarm selection prefers the correct due work across normal
  `nextWakeAt` and idle checkpoint due time;
- idle checkpoint does not call the hosted AI usage gate, including when the
  gate would deny or fail;
- no idle checkpoint is scheduled when the normal result is `scheduled`,
  `budget_exhausted`, or otherwise not idle;
- successful idle checkpoint invokes the container with
  reason `idle_shutdown_checkpoint` and checkpoint reason `idle_shutdown`;
- successful idle checkpoint destroys the warm container when no nudge appeared;
- successful idle checkpoint does not destroy when a nudge appeared during the
  invocation;
- idle checkpoint failure records retry state but does not corrupt the current
  workspace ref;
- checkpoint committed but outbound proxy expiration or container destroy failed
  does not corrupt the workspace ref or loop redundant idle checkpoints;
- browser-vault replica publishing failure still lets the full checkpoint commit
  and the container shutdown proceed best-effort.

Assistant runtime tests:

- checkpoint-only reason restores workspace and performs one full checkpoint;
- checkpoint-only reason does not fetch mailbox, rebuild inbox sidecars, prepare
  Codex env, start the CLI bridge, run assistant phase, send outbox, pull
  device dirty state, run provider cleanup, or record usage;
- checkpoint-only reason does not advance mailbox watermarks or clear existing
  redacted status;
- liveness rejection during idle checkpoint aborts like other invocations.

Checkpoint policy tests:

- `"idle_shutdown"` maps to full;
- existing reason mappings stay pinned until deliberately changed.

Contract/deploy tests:

- old/missing invocation reason behavior still drains normally for existing
  reasons;
- unknown idle reason fails closed in old-parser compatibility tests;
- web route/store and Cloudflare proxy accept checkpoint reason
  `"idle_shutdown"` before any producer sends it.

Hosted-local scenario proof:

- user message, idle checkpoint due, full snapshot written, warm container
  destroyed, next wake restores from the new base snapshot;
- user message during idle checkpoint leaves container alive or immediately
  re-drives work without losing the checkpoint CAS boundary.

## Open Questions

- Should the first implementation skip idle checkpointing for workspaces whose
  latest snapshot is already a full/base ref with the same workspace version?
  Recommendation: yes.
- Should failed idle checkpoints retry before container destruction?
  Recommendation: retry through normal runner retry policy only while the alarm
  can run before idle expiry; do not keep a container alive indefinitely for a
  compaction failure.
- When can `maintenance` stop meaning full?
  Recommendation: only after tests prove provider cleanup, device-sync dirty
  acks, and no-progress assistant passes do not rely on non-hot paths.
- Should successful full idle checkpoints update the local base restore cache
  when the warm container remains alive because a nudge arrived during the
  checkpoint? Recommendation: treat this as a first-version performance edge
  unless the hosted-local scenario shows repeated full bundle downloads.

## Non-Goals

- No checkpointing in `onStop()`.
- No independent checkpoint authority inside `RunnerContainer`.
- No second queue for idle checkpoints.
- No removal of correctness hot checkpoints in the same change.
- No change to mailbox import watermarks, outbox terminal evidence, or hosted
  usage ownership.

## Deployment Concerns

This changes the hosted runtime/checkpoint contract and must be deployed in a
fail-closed order:

1. Deploy shared package, web route/store, and Cloudflare proxy support for
   checkpoint reason `"idle_shutdown"` plus invocation reason
   `"idle_shutdown_checkpoint"`, with no producer emitting it.
2. Deploy assistant-runtime/container code that understands
   `"idle_shutdown_checkpoint"` and runs the checkpoint-only path.
3. Enable Cloudflare scheduling behind one explicit rollout flag so production
   can stop emitting the new reason quickly if container version skew appears.
   If the first version ships without a flag, the operational fallback is to
   set the idle-checkpoint safety margin beyond the idle TTL so the producer
   cannot schedule the idle checkpoint.
4. Only later rely on `idle_shutdown` metrics or demote existing full reasons.

Old web/control-plane callbacks currently reject unknown checkpoint reasons, and
old containers may reject the new invocation reason. The producer must not emit
either until the consumers are deployed.
Status: completed
Updated: 2026-05-06
Completed: 2026-05-06
