I’d keep the plan’s core architecture exactly as-is, but I would make **nine concrete adjustments** before landing. The plan is directionally strong: hard-cut to Temporal as scheduler, Cloudflare as execution adapter, web as ingress/status owner, and Murph runtime as business-logic owner.  

## 1. Do not put full demand/workspace/result objects into Temporal history

The current plan has `HostedRuntimeDemand` carrying `workspace: HostedWorkspaceState | null`, and the workflow stores `lastDemand`. I would slim this down.

Temporal records Activity inputs and return values in Workflow History, and the docs explicitly warn to avoid large Activity inputs/outputs because they are stored and replayed. ([Temporal Docs][1]) Also, Murph’s `HostedWorkspaceState` includes fields we do not need Temporal to know, and `HostedWorkspaceInvocationResult` can include `redactedStatus`.  

Change the demand/result contracts to projections:

```ts
export interface HostedRuntimeDemandWorkspaceProjection {
  nextWakeAt: string | null;
  nextWakeReason: string | null;
  version: string | null;
}

export type HostedRuntimeDemand =
  | {
      kind: "run";
      reason: HostedWorkspaceInvocationReason;
      source:
        | "mailbox_backlog"
        | "manual"
        | "browser_vault_refresh"
        | "device_sync_recovery"
        | "workspace_wake"
        | "runtime_result_wake"
        | "lag_recovery";
      mailboxLag: HostedMailboxLaneLag[];
      workspace: HostedRuntimeDemandWorkspaceProjection | null;
      requiresAiUsageDecision: boolean;
    }
  | {
      kind: "idle";
      nextWakeAt: string | null;
      mailboxLag: HostedMailboxLaneLag[];
      workspace: HostedRuntimeDemandWorkspaceProjection | null;
    }
  | {
      kind: "blocked";
      reason:
        | "ai_usage_denied"
        | "ai_usage_gate_unavailable"
        | "user_not_active"
        | "hosted_runtime_not_configured";
      retryAt: string | null;
      mailboxLag: HostedMailboxLaneLag[];
      workspace: HostedRuntimeDemandWorkspaceProjection | null;
    };
```

And replace workflow `lastDemand: HostedRuntimeDemand | null` with debug-only fields:

```ts
lastDemandKind: "run" | "idle" | "blocked" | null;
lastDemandSource: string | null;
lastDemandNextWakeAt: string | null;
lastMailboxLagLaneCount: number;
```

This keeps Temporal as orchestration metadata only.

## 2. Do not persist `aiUsageAllowDecision` in Workflow History

The plan currently lets `readRuntimeDemand` return `aiUsageAllowDecision`, then passes it through the workflow to `ensureCloudflareExecution`. That stores the signed decision in Temporal history. It is probably not catastrophic, but it is unnecessary.

Better:

```txt
readRuntimeDemand:
  returns requiresAiUsageDecision: true/false
  returns blocked if usage denied/unavailable

ensureCloudflareExecution activity:
  if requiresAiUsageDecision:
    fetch fresh signed decision from web inside the Activity
    pass it to Cloudflare
```

Activity-local data is not recorded as Workflow History unless it is returned. This keeps the signed allow decision out of workflow state while preserving web as usage/product owner. It also matches the plan’s own separation: web owns usage policy, Temporal owns orchestration, Cloudflare runs. 

## 3. Preserve runtime-result `nextWakeAt`; it is not always checkpointed

This is the most important codebase-specific correction.

The plan says Temporal should re-read web/runtime status after every attempt and use `workspace.nextWakeAt`. That is correct for durable workspace wakes, but not sufficient for **runtime-result scheduling metadata**.

The hosted runtime protocol explicitly says retryable mailbox import blockers do **not** advance watermarks and that the runtime result carries the next fast mailbox retry wake; when no local import state changed, that wake is scheduling metadata only and must not force a workspace checkpoint. 

So if Cloudflare strips/ignores runtime result `nextWakeAt`, Temporal can miss a fast retry that was intentionally **not** persisted to `HostedWorkspace.nextWakeAt`.

Adjustment:

```ts
export type HostedRuntimeEnsureExecutionResponse =
  | {
      kind: "runtime_completed";
      action: "started" | "replaced";
      runtimeAttemptId: string;
      runtimeStatus: HostedWorkspaceInvocationStatus;
      runtimeResultNextWakeAt: string | null;
    }
  | {
      kind: "runtime_wake_sent";
      runtimeAttemptId: string;
      recommendedRecheckAt: string | null;
    };
```

Do **not** include `redactedStatus`. Do include the slim `runtimeResultNextWakeAt`.

Then workflow state gets:

```ts
runtimeResultWakeAt: string | null;
```

Demand priority becomes:

```txt
1. mailboxLag > 0
2. manualRunRequested
3. browserVaultRefreshRequested
4. deviceSyncRecoveryRequested
5. lagRecoveryObserved
6. runtimeResultWakeAt <= now        → reason "retry", source "runtime_result_wake"
7. workspace.nextWakeAt <= now       → reason "nudge", source "workspace_wake"
8. idle until min(runtimeResultWakeAt, workspace.nextWakeAt)
```

This keeps next-wake calculation in Murph runtime, while moving the scheduling of that wake to Temporal.

## 4. Version-gate flag clearing so signals cannot be lost during awaits

The plan’s workflow mutates flags, then clears them after demand/execution. There is a subtle race:

```txt
workflow starts readRuntimeDemand activity
new signal arrives while activity is running
activity returns idle based on older flag set
workflow clears flags
new manual/browser/device signal is lost
```

Temporal signal handlers can mutate workflow state, and Activity awaits allow other workflow work to interleave. That is canonical Temporal behavior, not a bug in Temporal. The docs call out that message handlers and the main workflow can interleave around awaits. ([Temporal Docs][2])

Add version-gated clearing:

```ts
const versionBeforeDemand = signalVersion;
const demand = await readRuntimeDemand(...);

if (signalVersion !== versionBeforeDemand) {
  // A signal arrived while demand was being read.
  // Do not clear anything derived from the older read.
  continue;
}
```

Same after execution:

```ts
const versionBeforeExecution = signalVersion;
const execution = await ensureCloudflareExecution(...);

if (signalVersion === versionBeforeExecution) {
  clearConsumedFlagsAfterRun(demand);
} else {
  // New signal arrived during execution. Keep flags; re-read demand.
}
```

This preserves the “tiny coalesced state” design without needing arrays or complex dedupe.

## 5. Replace `condition(() => false, ms)` with `sleep(ms)`

The plan uses:

```ts
await condition(() => false, ACTIVE_WAKE_SETTLE_MS);
```

Use:

```ts
await sleep(ACTIVE_WAKE_SETTLE_MS);
```

Temporal’s TypeScript docs say `sleep()` is the recommended timer primitive, and durable timers can sleep for long periods without tying up the worker process. ([Temporal TypeScript SDK][3])

So import `sleep` from `@temporalio/workflow`.

## 6. Do not use a 1-second active-wake recheck by default

The plan’s `ACTIVE_WAKE_SETTLE_MS = 1_000` is too aggressive for Murph’s runtime model.

The runtime can accept a wake, import new mailbox rows, and keep the active invocation dirty until the runtime-owned idle/deadline/scheduled-wake checkpoint succeeds. The protocol says the active invocation remains dirty until that runtime-owned checkpoint, and mailbox lag remains based on checkpointed imported watermarks. 

If Temporal rechecks every second while an active runtime is legitimately waiting for its idle checkpoint, it can keep sending redundant active wakes.

Adjustment:

```ts
export type HostedRuntimeEnsureExecutionResponse =
  | {
      kind: "runtime_wake_sent";
      runtimeAttemptId: string;
      recommendedRecheckAt: string | null;
    }
  | ...;
```

Cloudflare can set `recommendedRecheckAt` from execution policy, not business logic:

```txt
now + idleCheckpointDelayMs + small margin
```

Or make Temporal use a config:

```txt
HOSTED_ACTIVE_WAKE_RECHECK_MS = idleCheckpointDelayMs + 5_000
```

This is not Cloudflare scheduling. It is just transport-level “don’t hammer the active container while the runtime owns the checkpoint window.”

## 7. Add stale workspace wake guard

The current Cloudflare local ensure loop has an `ignoredWorkspaceWakeAt` style behavior to avoid repeatedly servicing the same stale workspace wake. The hard cut removes that loop, so Temporal needs a tiny orchestration-level replacement.

Add to workflow state:

```ts
ignoredWorkspaceWakeKey: string | null;
```

Build key:

```ts
function workspaceWakeKey(workspace: {
  version: string | null;
  nextWakeAt: string | null;
  nextWakeReason: string | null;
}): string | null {
  if (!workspace.nextWakeAt) return null;
  return [
    workspace.version ?? "0",
    workspace.nextWakeAt,
    workspace.nextWakeReason ?? "",
  ].join(":");
}
```

When demand source is `workspace_wake` and execution completes, set:

```ts
ignoredWorkspaceWakeKey = workspaceWakeKey(demand.workspace);
```

When demand endpoint sees the same key, return idle instead of hot-looping. Clear the ignored key when:

```txt
- workspace version changes
- workspace nextWakeAt changes
- mailboxLag appears
- any explicit signal arrives
```

This is not business logic. It is a loop-prevention guard around a stale exported wake projection.

## 8. Do not reuse current “clear fence” methods unchanged

This is a concrete codebase issue.

Current `clearWriteFenceIfCurrent()` always writes `wake_at` if `wakeAt` is omitted or null, and `clearWriteFenceAfterFailure()` always writes `backoff_until` and `wake_at` defaults.  That is exactly the semantic scheduling state the migration is trying to delete.

So Batch 2B should not call:

```ts
clearWriteFenceIfCurrent({ wakeAt: null })
clearWriteFenceAfterFailure({ retryAt: null })
```

unless those methods are changed first.

Add execution-only methods instead:

```ts
async clearWriteFenceForReplacement(input: {
  attemptId: string;
  generation: string;
  userId: string;
  error?: unknown;
  finishedAt?: string | null;
}): Promise<{ cleared: boolean; record: RunnerStateRecord }>;
```

and:

```ts
async clearWriteFenceAfterTransportFailure(input: {
  error: unknown;
  finishedAt?: string | null;
  token: RunnerWriteFenceToken;
}): Promise<{ failed: boolean; record: RunnerStateRecord }>;
```

These methods should:

```txt
- clear active fence
- update last_error_at / last_error_code if useful
- optionally increment a transport failure counter if you keep it for observability
- NOT set wake_at
- NOT set backoff_until
- NOT schedule retry
```

Then the only alarm is the active-fence watchdog.

## 9. Make `ensureCloudflareExecution` Activity timeout env-derived, not hardcoded to 15 minutes

The plan’s `startToCloseTimeout: "15 minutes"` is too arbitrary.

Current Cloudflare runtime invocation uses an env runner timeout, and the runtime itself may wait for idle/deadline/checkpoint. If Temporal’s Activity timeout is shorter than the Cloudflare runner timeout, Temporal can retry while the prior container run is still valid.

Use:

```txt
ensureCloudflareExecution.startToCloseTimeout =
  CLOUDFLARE_RUNNER_TIMEOUT_MS + safety margin
```

and:

```txt
readRuntimeDemand.startToCloseTimeout = short, e.g. 10s–30s
```

Temporal docs require Activity timeouts, and Activity executions can be retried; they also emphasize idempotency because retries can happen. ([Temporal Docs][4])

For this migration, I would keep the Activity synchronous and simple, but explicitly document:

```txt
ensureCloudflareExecution is at-least-once.
Duplicate execution is allowed.
Correctness comes from runtime mailbox/checkpoint idempotency and web demand re-read.
```

Do not add a Cloudflare idempotency table unless duplicate no-op runs become a measured problem.

## 10. Prefer Activity exceptions over “failure response” unions

The plan defines `HostedRuntimeEnsureExecutionFailure`, but I would not make failure a success response.

Canonical Temporal shape:

```txt
business blocked state → demand.kind = "blocked"
transport failure      → Activity throws
```

Use `ApplicationFailure.create` inside activities when you need Temporal retry behavior, including `nonRetryable` or `nextRetryDelay`. Temporal’s docs show retry policy configuration and next retry delay via `ApplicationFailure.create`. ([Temporal Docs][4])

So contracts should not include:

```ts
HostedRuntimeEnsureExecutionFailure
```

unless it is only an HTTP error body for Cloudflare. The workflow should see thrown Activity failures, not `{ kind: "transport_retryable_failure" }`.

## 11. Keep the Workflow Type name exactly aligned with the exported function name

The plan uses:

```ts
export const HOSTED_USER_RUNTIME_WORKFLOW_TYPE =
  "hostedUserRuntimeWorkflow" as const;
```

That is fine only if the exported workflow function is exactly:

```ts
export async function hostedUserRuntimeWorkflow(...) {}
```

Temporal TypeScript’s Workflow Type is the Workflow function name; the docs say there is not a separate customization mechanism for TypeScript workflow type names. ([Temporal Docs][5])

So add a test or comment that the constant must match the exported function name. If a subagent renames the function, the string-based `signalWithStart` path breaks.

## 12. In ESM, be explicit about `workflowsPath`

The repo is ESM. Temporal docs show `workflowsPath: require.resolve('./workflows')`, and Workers on the same Task Queue must register the same Workflow and Activity types. ([Temporal Docs][6])

In an ESM package, use:

```ts
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const worker = await Worker.create({
  workflowsPath: require.resolve("./workflows/index.js"),
  taskQueue: HOSTED_USER_RUNTIME_TASK_QUEUE,
  activities,
});
```

Or use a prebuilt workflow bundle later. Keep the first implementation minimal, but do not write CJS-only worker setup in this ESM repo.

## 13. Make signal `source` less enum-heavy

The plan’s `mailbox_appended.source` enum is probably too specific:

```ts
source: "linq" | "telegram" | "email" | "device-sync" | ...
```

Murph already has provider/channel churn. A strict enum will create contract edits whenever a provider changes.

I would make it:

```ts
source: string;
```

with parser constraints:

```txt
- non-empty
- trimmed
- max length, e.g. 64
- safe chars: lowercase letters, numbers, ".", "-", "_", ":"
```

That is still pointer-only and safer long-term.

## 14. Slightly revise the final minimal contract

I’d make the final shared contracts look more like:

```ts
export interface HostedRuntimeDemandRequest {
  browserVaultRefreshRequested?: boolean;
  deviceSyncRecoveryRequested?: boolean;
  ignoredWorkspaceWakeKey?: string | null;
  lagRecoveryObserved?: boolean;
  manualRunRequested?: boolean;
  runtimeResultWakeAt?: string | null;
  userId: string;
}
```

```ts
export type HostedRuntimeEnsureExecutionResponse =
  | {
      action: "started" | "replaced";
      kind: "runtime_completed";
      runtimeAttemptId: string;
      runtimeResultNextWakeAt: string | null;
      runtimeStatus: HostedWorkspaceInvocationStatus;
    }
  | {
      kind: "runtime_wake_sent";
      recommendedRecheckAt: string | null;
      runtimeAttemptId: string;
    };
```

And workflow carry-forward state:

```ts
export interface HostedUserRuntimeWorkflowCarryForwardState {
  browserVaultRefreshRequested: boolean;
  deviceSyncRecoveryRequested: boolean;
  ignoredWorkspaceWakeKey: string | null;
  lagRecoveryObserved: boolean;
  latestMailboxPointer: HostedRuntimeMailboxPointer | null;
  mailboxSignalCount: number;
  manualRunRequested: boolean;
  runtimeResultWakeAt: string | null;
  signalVersion: number;

  lastDemandKind: "run" | "idle" | "blocked" | null;
  lastDemandSource: string | null;
  lastExecutionAt: string | null;
  lastExecutionErrorCode: string | null;
  lastExecutionKind: string | null;
}
```

## Net assessment

I would land the plan with these adjustments. The big conceptual architecture is right and canonical for Temporal: Workflows hold durable orchestration state, Signals wake/modify that state, durable timers model sleeps, Activities perform external IO, and Continue-As-New bounds long-lived workflow history. ([Temporal Docs][2])

The main changes are not philosophical; they are edge-case hardening:

```txt
- keep Temporal history slimmer
- preserve runtime-result nextWakeAt
- avoid losing signals during awaits
- avoid active wake storms
- avoid stale workspace wake loops
- do not reuse RunnerStateStore methods that secretly schedule wake/retry
- use Temporal Activity failure/retry idiom instead of failure response unions
```

With those changes, the migration is cleaner, smaller, and more faithful to the Murph runtime boundary.

[1]: https://docs.temporal.io/develop/typescript/activities/execution "Activity execution - TypeScript SDK | Temporal Platform Documentation"
[2]: https://docs.temporal.io/develop/typescript/message-passing "Workflow message passing - TypeScript SDK | Temporal Platform Documentation"
[3]: https://typescript.temporal.io/api/namespaces/workflow "Namespace: workflow | Temporal TypeScript SDK API Reference"
[4]: https://docs.temporal.io/develop/typescript/activities/timeouts "Activity Timeouts - TypeScript SDK | Temporal Platform Documentation"
[5]: https://docs.temporal.io/develop/typescript/workflows/basics "Workflow basics - TypeScript SDK | Temporal Platform Documentation"
[6]: https://docs.temporal.io/develop/typescript/workers/run-worker-process "Worker processes - TypeScript SDK | Temporal Platform Documentation"
