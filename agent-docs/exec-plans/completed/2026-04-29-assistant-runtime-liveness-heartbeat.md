# Assistant Runtime Liveness Heartbeat

## Goal

Add a small runtime-level liveness primitive so long-running hosted assistant work can prove it is still alive while Cloudflare Durable Object in-memory state may have been lost.

Success criteria:

- A live 2+ minute assistant/provider turn is not duplicated by persisted-only `in_flight` orphan recovery.
- A dead child still recovers promptly, around the last liveness proof plus the orphan grace window.
- The primitive is not Cloudflare-specific, but Cloudflare is the first consumer.
- No heartbeat data flows through hosted web, Postgres, mailbox, workspace checkpoints, runtime logs, receipts, prompts, or user-facing timelines.

## Review Findings

Three stress-review passes changed the shape of the plan:

- Do not wire this only through `sendAssistantMessageLocal`; notification turns and other hosted execution paths can have separate provider work.
- Do not write heartbeat ticks into assistant receipts or status. That would add durable churn and contend with real runtime writes.
- Do not start in `assistant-engine` unless a broader non-hosted need appears. The immediate reusable seam is an `assistant-runtime` liveness supervisor and optional runtime platform port.
- Do not treat stale lease rejection as a soft warning. A definitive stale/unauthorized heartbeat response should stop the child path before more mutable side effects.
- Do not reschedule pending nudges all the way to hard timeout after heartbeat. Heartbeats should keep moving the orphan-check alarm to `min(now + orphanGrace, hardTimeout)`.
- Start the heartbeat before workspace read/restore/env prep, not only around the later run loop. The Durable Object has already marked `in_flight` by then.
- Do not rely on clearing `active_invocation_orphan_observed_at` alone. Without a persisted liveness timestamp, recovery becomes about last heartbeat plus two grace windows.
- Add an explicit Cloudflare runner-control internal route/host; the existing artifact/results/web-control hosts do not provide this path.

## Final Shape

### 1. Generic Runtime Helper

Create a small helper in `packages/assistant-runtime`, for example:

```ts
export interface RuntimeLivenessPort {
  touch(input: {
    requestId: string;
    signal?: AbortSignal | null;
  }): Promise<
    | { ok: true }
    | {
        ok: false;
        reason:
          | "stale_attempt"
          | "stale_generation"
          | "wrong_user"
          | "no_active_invocation"
          | "malformed_request"
          | "unauthorized";
      }
  >;
}

export function startRuntimeLivenessHeartbeat(input: {
  intervalMs?: number;
  port?: RuntimeLivenessPort | null;
  requestId: string;
  signal?: AbortSignal | null;
  touchTimeoutMs?: number;
  onRejected?: (reason: string) => void;
  onError?: (error: unknown) => void;
}): { stop(): Promise<void> };
```

Behavior:

- Default interval: 15-20 seconds.
- One in-flight touch at a time; skip a tick if the previous touch is still running.
- Best-effort on transient transport errors; network/5xx style failures throw and retry on the next tick.
- Definitive stale/rejected response triggers cancellation/fail-closed behavior.
- Each touch has a short timeout, and `stop()` is bounded so cleanup cannot hang behind a stuck heartbeat fetch.
- Timer is always stopped in `finally`.
- Node timers should be `unref()` where available.
- Payload stays structural only: no prompt text, message text, vault path, user identifiers, auth headers, or secrets.

### 2. Hosted Runtime Integration

Add an optional liveness port to `HostedRuntimePlatform`:

```ts
runtimeLivenessPort?: RuntimeLivenessPort | null;
```

Wrap the whole hosted workspace job in `packages/assistant-runtime/src/hosted-runtime.ts`. The supervisor should run while workspace read, restore/import, provider calls, tools, checkpoints, effects, and cleanup are awaiting.

Start the supervisor immediately after validating required ports and the request lease, before `workspacePort.read()`, workspace restore, artifact materialization, and environment preparation. The Durable Object has already persisted `in_flight` before the container reaches this code, so these earlier awaited phases also need liveness coverage.

Rejected heartbeat handling must have a concrete stop path. The first implementation should at least:

- mark the hosted runtime invocation as stale
- prevent later mutable platform calls such as checkpoints, artifacts, and effects from succeeding after the rejection
- reject the top-level hosted runtime job as stale as soon as practical

If practical in the same patch, wire a narrow abort signal through the hosted runtime path and race long awaits against the stale-heartbeat rejection.

This keeps the primitive in assistant runtime and avoids Cloudflare concepts in assistant engine.

### 3. Cloudflare Consumer

In `apps/cloudflare/src/runtime-platform.ts`, implement `runtimeLivenessPort` using an explicit internal runner-control route, for example:

```txt
POST http://runner-control.worker/internal/active-invocation/heartbeat
```

Wire this host through the same internal proxy-token infrastructure used by the existing internal hosts.

The internal request should contain only:

- `attemptId`
- `leaseGeneration`
- `requestId`

No hosted web route or app DB involvement.

### 4. Runner DO Lease Touch

Add a narrow user runner DO method, such as:

```ts
recordActiveInvocationHeartbeat(input: {
  attemptId: string;
  leaseGeneration: string;
  userId: string;
}): Promise<
  | {
      ok: true;
      nextAlarmAt: string | null;
    }
  | {
      ok: false;
      reason:
        | "stale_attempt"
        | "stale_generation"
        | "wrong_user"
        | "no_active_invocation";
    }
>;
```

Implementation should reuse the same validation semantics as `ownsActiveInvocationLease`:

- active attempt id matches
- lease generation matches
- user id matches

On valid heartbeat:

- write `active_invocation_last_heartbeat_at = now`
- clear `active_invocation_orphan_observed_at`
- do not update `active_invocation_started_at`
- do not bump lease generation
- do not mutate pending mailbox/workspace state
- do not authorize final writes; checkpoint/artifact fencing remains the write authority

Add one explicit metadata column, such as `active_invocation_last_heartbeat_at`.

This is intentionally small but important: using only `active_invocation_orphan_observed_at` is ambiguous. If heartbeat merely clears that field, the next alarm has to observe the orphan again, which delays recovery to roughly last heartbeat plus two grace windows. The runner needs a persisted last-liveness timestamp so stale recovery can clear at last heartbeat plus the orphan grace.

### 5. Alarm Rule

Current Cloudflare Durable Object alarm semantics matter: each object has one alarm, and `setAlarm()` replaces the existing alarm.

When `pendingNudge` is true and heartbeat proves liveness:

- schedule the next alarm at `min(now + orphanGraceMs, activeInvocationStartedAt + runnerTimeoutMs)`
- each later heartbeat pushes that orphan-check alarm forward
- if the child dies after a heartbeat, the pending nudge recovers at about last heartbeat plus orphan grace
- hard timeout remains the absolute ceiling

Stale recovery should use:

- hard timeout first: `activeInvocationStartedAt + runnerTimeoutMs`
- otherwise, if `active_invocation_last_heartbeat_at` exists, clear at `lastHeartbeatAt + orphanGraceMs`
- otherwise, use the current first-observation behavior with `active_invocation_orphan_observed_at`

When the active invocation completes and `pendingNudge` remains true, existing completion logic should still schedule the immediate follow-up drain.

## Tests

Focused tests should cover:

- Runtime liveness helper starts, ticks, stops, skips overlapping touches, and cleans up timers.
- Runtime liveness helper treats transient errors as retryable, bounds stuck touches, and treats stale/rejected responses as cancellation.
- Hosted runtime starts heartbeat before delayed workspace read/restore work and stops it on success/failure.
- Cloudflare runtime platform sends heartbeat through the internal proxy with current lease values, including after checkpoint version changes.
- Runner-control heartbeat route requires the internal proxy token and rejects malformed/stale payloads with typed non-retryable reasons.
- Runner state store accepts valid heartbeat and rejects stale attempt, stale generation, wrong user, and wrong workspace version.
- Runner alarm behavior pushes pending orphan-check alarm to `last heartbeat + orphanGrace`, capped by hard timeout.
- Heartbeat during a simulated long provider wait prevents 45s duplicate takeover.
- Heartbeat stops, child dies, and pending nudge recovers at the next orphan-check alarm.
- Multiple user messages during an active invocation coalesce through `pendingNudge` and drain immediately after completion.

## Implementation Status

Implemented in this checkout.

- Added `RuntimeLivenessPort` and `startRuntimeLivenessHeartbeat` in assistant-runtime.
- Wired hosted workspace runtime jobs to start heartbeat before workspace read, wait for the first accepted touch, guard mutable platform calls after stale rejection, and pass cancellation into hosted assistant automation and mailbox import callbacks.
- Added Cloudflare `runner-control.worker` heartbeat proxy route using the internal proxy-token path.
- Added a typed non-retryable `malformed_request` heartbeat rejection for malformed runner-control heartbeat payloads.
- Added runner DO heartbeat recording, persisted `active_invocation_last_heartbeat_at`, and stale persisted-only recovery based on last heartbeat plus the orphan grace window.
- Kept heartbeat payloads structural only: attempt id, lease generation, and request id.

Review repair pass:

- Made `RuntimeLivenessPort.touch` abortable and abort each timed-out/stopped touch so a stuck heartbeat request cannot overlap later ticks.
- Removed workspace version from heartbeat authority. Heartbeats now prove invocation liveness by attempt, lease generation, and user only; workspace-version fencing remains on checkpoints/artifact and other write boundaries.
- Changed pending-nudge scheduling so active invocations with heartbeat proof schedule orphan checks at `lastHeartbeatAt + orphanGrace`, capped by hard timeout, even when the current DO isolate still has an in-memory invocation lock.
- Added stale active-lock recovery so an expired invocation lease can clear the local invocation lock and allow a replacement run instead of rescheduling to the hard timeout forever.
- Made stale completion/failure calls report whether they actually owned the lease; stale old invocations no longer schedule follow-up alarms or retries.
- Made runner alarms respect `nextWakeAt` when `pendingNudge` is true, so stale/retried alarms do not run pending work early and overwrite a heartbeat-derived orphan-check alarm.
- Silenced generic internal-request logging for heartbeat requests and disabled heartbeat fetch failure logging on the generic upstream helper.
- Classified heartbeat control-route `4xx` responses as definitive malformed heartbeat rejection instead of retryable transport errors.
- Threaded the liveness abort signal into post-checkpoint assistant delivery and provider cleanup so Telegram sends and Linq cleanup check liveness before and after external side effects and pass the abort signal to provider calls.
- Added active-lease validation headers to hosted email sends and validates them on the runner effects route before committing the send.

Final audit repair pass:

- Kept the heartbeat `inFlight` flag tied to the underlying `port.touch()` promise instead of the timeout wrapper, so abort-ignoring ports cannot accumulate overlapping touches.
- Moved hosted runtime heartbeat startup after required mailbox/workspace port and budget validation, while still starting before `workspacePort.read()`.
- Wrapped `createCheckpointSnapshot` with runtime liveness assertions before and after snapshot creation.
- Made every successful `ownsActiveInvocationLease` refresh `active_invocation_last_heartbeat_at` and clear orphan observation, so write-boundary lease checks also extend liveness.
- Added just-in-time liveness proofs before and after post-checkpoint Telegram sends, hosted email sends, and Linq provider cleanup.
- Added focused regression coverage for abort-ignoring heartbeat touches, no heartbeat on invalid runtime config, lease-ownership heartbeat refresh, and post-checkpoint liveness proof wiring.

Current verification:

- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts test/hosted-runtime-liveness.test.ts test/hosted-runtime-workspace-entrypoint.test.ts test/hosted-runtime-callbacks.test.ts test/hosted-runtime-provider-cleanup.test.ts test/hosted-runtime-workspace-assistant-phase.test.ts --no-coverage` passed.
- `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts test/runner-state-store.bundle-slots.test.ts test/user-runner-alarm.test.ts --no-coverage` passed.
- `pnpm --dir packages/assistant-runtime typecheck` passed.
- `pnpm --dir apps/cloudflare typecheck` passed.
- `pnpm typecheck` passed.
- Scoped `git diff --check` over the heartbeat/liveness files passed.
- `pnpm verify:acceptance` remains red on unrelated dirty-tree failures in Cloudflare deploy artifact validation, CLI coverage, and setup wizard coverage.
- Raced long hosted runtime awaits against liveness abort for workspace read, restore, runtime-env prep, and the main hosted workspace run.

Verified:

- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts test/hosted-runtime-liveness.test.ts test/hosted-runtime-workspace-entrypoint.test.ts --no-coverage`
- `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts test/runner-outbound.test.ts test/runner-platform.test.ts test/user-runner-alarm.test.ts test/runner-state-store.bundle-slots.test.ts --no-coverage`
- `pnpm --dir packages/assistant-runtime typecheck`
- `pnpm --dir apps/cloudflare typecheck`
- `pnpm typecheck`
- `git diff --check` on the heartbeat implementation files

Additional verification notes:

- `pnpm --dir packages/assistant-runtime test` and scoped `bash scripts/workspace-verify.sh test:diff ...` are currently blocked by unrelated in-flight assistant-runtime Linq audio/document E2E tests in this dirty checkout (`hosted-runtime-linq-audio-e2e.test.ts`, `hosted-runtime-linq-document-preservation-e2e.test.ts`, and one parser setup expectation in `hosted-runtime-conversation-event.test.ts`). The heartbeat-focused tests above pass.
- `pnpm --dir apps/cloudflare test:node` reached unrelated deploy artifact fixture fingerprint expectations after this dirty checkout regenerated Health Commons artifacts. The heartbeat-focused Cloudflare tests above pass.

## Non-Goals

- No assistant receipt/status heartbeat writes.
- No app/web route, hosted product DB state, or Postgres heartbeat truth.
- No workspace checkpoint reuse as heartbeat.
- No prompt/message/vault payload in heartbeat.
- No broad heartbeat event/history/log stream. The only persisted liveness state should be the runner DO metadata needed for correctness.
- No broad assistant-engine refactor in the first pass.
