Below is the migration guide I’d give the subagents. It assumes a **greenfield hard cut**: no production Vercel Workflow coexistence, no direct web-to-Cloudflare nudge fallback, and no attempt to preserve Cloudflare’s current semantic scheduler. Temporary internal compatibility/test shims are allowed only when they are not reachable as production scheduler routes and are documented as deprecated. The architecture target is the one we converged on: **Murph runtime owns business logic, web owns ingress/product/status, Temporal owns orchestration/scheduling/wakeups, Cloudflare owns container execution only**. This matches the repo’s existing hosted-runtime direction: web owns hosted product/control facts and mailbox/workspace status; Cloudflare owns runner coordination/container invocation; `packages/assistant-runtime` restores local runtime state, imports mailbox rows, runs assistant/device work, and checkpoints.

# 0. North-star architecture

## Final ownership split

```txt
apps/web
  Owns:
    - webhook verification
    - provider payload parsing/minimization
    - mailbox append + dedupe
    - device-sync dirty state
    - hosted member/billing/usage/product facts
    - hosted workspace metadata
    - runtime status endpoint: mailboxLag + slim workspace wake projection
    - redacted runtime logs/status

Temporal
  Owns:
    - one workflow per hosted user/workspace
    - signal-with-start after mailbox append / explicit wake requests
    - durable sleeps from runtimeResultWakeAt / workspace wake projection
    - retry/backoff of execution adapter calls
    - “wake accepted is not completion” loop
    - continue-as-new for bounded history

apps/cloudflare
  Owns:
    - per-user Durable Object routing
    - active runtime write fence / lease generation
    - container name resolution
    - container invoke/wake
    - runtime callback authorization
    - R2/snapshot transport plumbing
    - cleanup/destroy on user deletion

packages/assistant-runtime
  Owns:
    - all Murph/Codex business logic
    - mailbox import semantics
    - AssistantInputEvent staging
    - active turn admission
    - Codex invocation
    - assistant automation/timer logic
    - device-sync runtime execution
    - outbox/provider cleanup
    - checkpoint timing
    - nextWakeAt / nextWakeReason projection
```

## One sentence

**Temporal decides when to ask Murph to run. Cloudflare runs or wakes the container. Murph runtime decides what work actually means and what wake should happen next.**

Temporal should not know how assistant automations work, how Codex is invoked, how provider cleanup works, how outbox retries are selected, or how device-sync reconciliation works. Those are runtime/web responsibilities.

# 1. Hard-cut invariants

Every subagent must preserve these.

## Invariant A: Temporal never stores business payloads

Temporal workflow inputs/signals/results may contain only pointers and coarse flags:

```txt
Allowed:
  - userId
  - mailboxItemId
  - lane
  - laneSeq
  - source
  - opaque eventId
  - connectionId
  - reason enum
  - booleans/counters
  - orchestration attempt ids
  - timestamps

Forbidden:
  - raw webhook payloads
  - raw email bodies
  - decrypted mailbox payloads
  - provider verification headers
  - provider secrets
  - prompts
  - transcripts
  - Codex logs
  - workspace snapshot bodies
  - vault data
```

The current repo already follows pointer-only workflow patterns for Vercel workflows; this migration keeps that idea and moves it to Temporal.

## Invariant B: Web/runtime truth beats execution signals

Temporal must not treat any of these as completion:

```txt
- Cloudflare accepted a request
- Cloudflare sent a runtime wake
- the container accepted /internal/runtime-wake
- the runtime attempt returned
- a workflow signal was accepted
```

Completion is only:

```txt
read web/runtime status
and see:
  mailboxLag == 0
  no due runtimeResultWakeAt
  no due workspace wake projection
  no explicit workflow-local wake flag
```

Web already exposes `mailboxLag` and workspace wake projection through the hosted runtime status route.  The lag calculation is durable and simple: compare each mailbox lane high-water seq against the imported seq stored in redacted runtime status.

## Invariant C: Cloudflare must stop deriving semantic demand

Cloudflare should not decide:

```txt
- mailbox backlog exists, therefore run
- assistant wake is due, therefore run
- browser-vault refresh is pending, therefore run
- retry cap reached, therefore park
- next alarm should be assistant nextWakeAt
```

Cloudflare should only answer:

```txt
Given userId + reason:
  can I start or wake the current Murph runtime container?
```

The current `HostedUserRunner.ensureRunnerProgress()` does too much: it reads demand, checks mailbox backlog, handles assistant wakes, manages retry caps/backoff, schedules alarms, and kicks local ensure loops. That is exactly what we are removing from Cloudflare.

## Invariant D: Runtime owns next wake calculation

Temporal sleeps on `runtimeResultWakeAt` or the slim workspace wake projection, but it does not calculate assistant runtime timers. The assistant runtime already computes next wakes from assistant automation, outbox, system mailbox, device-sync, provider cleanup, and skipped/deferred work. Runtime-result wake metadata must be preserved even when it is not checkpointed into `HostedWorkspaceState`.

## Invariant E: Workflow state stays tiny

Do not keep an array of pending signals. Keep coalesced flags/counters only.

```ts
export interface HostedUserRuntimeWakeState {
  signalVersion: number;
  mailboxSignalCount: number;
  latestMailboxPointer: HostedRuntimeMailboxPointer | null;
  manualRunRequested: boolean;
  browserVaultRefreshRequested: boolean;
  deviceSyncRecoveryRequested: boolean;
  lagRecoveryObserved: boolean;
  runtimeResultWakeAt: string | null;
  ignoredWorkspaceWakeKey: string | null;
}
```

Workflow carry-forward/debug state must stay slim. Do not store full
`HostedRuntimeDemand`, full `HostedWorkspaceState`, full
`HostedWorkspaceInvocationResult`, signed `aiUsageAllowDecision`, or redacted
runtime status in workflow history. Carry forward only the coalesced flags,
latest pointer, `runtimeResultWakeAt`, `ignoredWorkspaceWakeKey`, and bounded
debug fields such as `lastDemandKind`, `lastDemandSource`,
`lastDemandNextWakeAt`, `lastExecutionKind`, `lastExecutionAt`, and
`lastExecutionErrorCode`.

# 2. Final repo shape

## New or changed packages

```txt
packages/hosted-execution
  src/orchestration-control.ts       # shared pure contracts
  src/runtime-control.ts             # may re-export small subsets if desired
  src/parsers/orchestration-control.ts

packages/hosted-orchestrator-temporal
  package.json
  src/workflows/hosted-user-runtime.ts
  src/activities/read-runtime-demand.ts
  src/activities/ensure-cloudflare-execution.ts
  src/client/signal-hosted-user-runtime.ts
  src/client/temporal-client.ts
  src/worker.ts
  src/index.ts
  test/hosted-user-runtime.workflow.test.ts
  test/read-runtime-demand.test.ts

apps/web
  src/lib/hosted-orchestration/signal-runtime.ts
  src/lib/hosted-orchestration/runtime-demand-control.ts
  app/api/internal/hosted-orchestration/users/[userId]/demand/route.ts
  app/api/internal/hosted-orchestration/users/[userId]/usage-allow-decision/route.ts
  Replace Vercel workflow starts with Temporal signal-with-start.

apps/cloudflare
  Add /internal/users/:userId/runtime/ensure-execution
  Add DO method ensureRuntimeExecutionForUser()
  Delete or stop using semantic runner nudge/progress paths.
```

## Deleted or hard-disabled paths

For the greenfield hard cut, delete or hard-disable:

```txt
apps/web/src/lib/hosted-onboarding/webhook-workflows.ts
apps/web/src/lib/hosted-onboarding/webhook-workflow-start.ts
apps/web/src/lib/hosted-onboarding/webhook-workflow-steps.ts
apps/web/src/lib/hosted-onboarding/workflow-start.ts
apps/web/src/lib/hosted-onboarding/workflow-step-options.ts
apps/web/src/lib/hosted-onboarding/webhook-workflow-types.ts

Cloudflare semantic scheduler paths:
  - ensureRunnerProgress as a demand owner
  - local ensure loop as a scheduler
  - scheduleAfterRuntimeWake
  - retry-cap probe scheduling
  - wake_at as semantic assistant wake truth
  - browserVaultRefreshRequestedAt as DO scheduler state
```

Keep Cloudflare code that is execution-specific:

```txt
- beginWriteFence
- bindWriteFenceWorkspaceVersion
- clearWriteFenceAfterCompletion
- clearWriteFenceAfterTransportFailure
- validateRuntimeWriteFence
- invokeWorkspaceRunner
- ensureActiveRuntimeProcessing
- container wakeRuntime / ensureProcessing
- user-data cleanup
- R2 snapshot/session plumbing
```

# 3. Shared contracts

Create `packages/hosted-execution/src/orchestration-control.ts`.

The goal is to avoid importing Temporal SDK into web/cloudflare. Use string names for workflow/signal/query. Temporal docs explicitly allow message type names when you cannot import workflow-defined message objects; use that to keep app code simple and dependency-light. ([Temporal Docs][1])

```ts
import type {
  HostedAiUsageAllowDecision,
  HostedMailboxLane,
  HostedMailboxLaneLag,
  HostedWorkspaceInvocationReason,
  HostedWorkspaceInvocationStatus,
} from "./runtime-control.js";

export const HOSTED_USER_RUNTIME_WORKFLOW_TYPE =
  "hostedUserRuntimeWorkflow" as const;
// This constant must match the exported workflow function name exactly.

export const HOSTED_USER_RUNTIME_TASK_QUEUE =
  "murph-hosted-runtime" as const;

export const HOSTED_USER_RUNTIME_SIGNAL_NAME =
  "runtimeSignal" as const;

export const HOSTED_USER_RUNTIME_STATUS_QUERY_NAME =
  "runtimeWorkflowStatus" as const;

export type HostedRuntimeSignal =
  | {
      kind: "mailbox_appended";
      mailboxItemId: string;
      lane: HostedMailboxLane;
      laneSeq: string;
      // Bounded safe string, not a provider enum.
      source: string;
    }
  | {
      kind: "manual_run_requested";
      eventId: string;
      source: string;
    }
  | {
      kind: "browser_vault_refresh_requested";
      eventId: string;
    }
  | {
      kind: "device_sync_recovery_requested";
      connectionId?: string | null;
      eventId: string;
      reason: "dirty" | "reconcile" | "wake";
    }
  | {
      kind: "mailbox_lag_observed";
      eventId: string;
      source: string;
    };

export interface HostedRuntimeMailboxPointer {
  mailboxItemId: string;
  lane: HostedMailboxLane;
  laneSeq: string;
  source: HostedRuntimeSignal extends infer S
    ? S extends { kind: "mailbox_appended"; source: infer Source }
      ? Source
      : never
    : never;
}

export interface HostedRuntimeDemandWorkspaceProjection {
  nextWakeAt: string | null;
  nextWakeReason: string | null;
  version: string | null;
}

export interface HostedRuntimeWorkflowState {
  userId: string;
  signalVersion: number;
  mailboxSignalCount: number;
  latestMailboxPointer: HostedRuntimeMailboxPointer | null;
  manualRunRequested: boolean;
  browserVaultRefreshRequested: boolean;
  deviceSyncRecoveryRequested: boolean;
  lagRecoveryObserved: boolean;
  runtimeResultWakeAt: string | null;
  ignoredWorkspaceWakeKey: string | null;
  lastDemandKind: "run" | "idle" | "blocked" | null;
  lastDemandSource: string | null;
  lastDemandNextWakeAt: string | null;
  lastMailboxLagLaneCount: number;
  lastExecutionAt: string | null;
  lastExecutionKind: string | null;
  lastExecutionErrorCode: string | null;
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
        | "runtime_result_wake"
        | "workspace_wake"
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

export interface HostedRuntimeDemandRequest {
  browserVaultRefreshRequested?: boolean;
  deviceSyncRecoveryRequested?: boolean;
  lagRecoveryObserved?: boolean;
  manualRunRequested?: boolean;
  runtimeResultWakeAt?: string | null;
  ignoredWorkspaceWakeKey?: string | null;
  userId: string;
}

export interface HostedRuntimeEnsureExecutionRequest {
  orchestrationAttemptId: string;
  reason: HostedWorkspaceInvocationReason;
  aiUsageAllowDecision?: HostedAiUsageAllowDecision | null;
}

export type HostedRuntimeEnsureExecutionResponse =
  | {
      action: "started" | "replaced";
      kind: "runtime_completed";
      runtimeResultNextWakeAt: string | null;
      runtimeStatus: HostedWorkspaceInvocationStatus;
      runtimeAttemptId: string;
    }
  | {
      kind: "runtime_wake_sent";
      recommendedRecheckAt: string | null;
      runtimeAttemptId: string;
    };
```

Add parser functions. Keep them boring and strict:

```ts
export function parseHostedRuntimeSignal(value: unknown): HostedRuntimeSignal;
export function parseHostedRuntimeDemand(value: unknown): HostedRuntimeDemand;
export function parseHostedRuntimeEnsureExecutionRequest(
  value: unknown,
): HostedRuntimeEnsureExecutionRequest;
export function parseHostedRuntimeEnsureExecutionResponse(
  value: unknown,
): HostedRuntimeEnsureExecutionResponse;
```

Acceptance criteria:

```txt
- No Temporal SDK import in packages/hosted-execution.
- No Prisma import.
- No Cloudflare import.
- No assistant-runtime import.
- Runtime-control enum/status types may be imported, but not full workspace or
  invocation result shapes.
- All signal payloads are pointer-only.
- No signed usage decision is present in demand, workflow state, or Activity
  inputs recorded in workflow history.
- `requiresAiUsageDecision` belongs to the Temporal Activity input, not the
  Cloudflare shared request. The Activity fetches a fresh signed decision from
  web when needed and then builds the Cloudflare request with optional
  `aiUsageAllowDecision`.
```

# 4. Temporal workflow design

Temporal supports Workflow message passing through Signals/Queries/Updates;
Signal-With-Start starts a workflow if missing and otherwise signals the
existing one. This is the exact fit for “mailbox appended → wake per-user
workflow.” ([Temporal Docs][1]) Temporal timers are durable and can sleep for
long periods without tying up a worker process, which is the right primitive for
runtime-result and workspace wake projections. ([Temporal Docs][2])
Continue-As-New should be used to keep long-lived per-user workflow histories
bounded. ([Temporal Docs][3])

## Workflow skeleton

`packages/hosted-orchestrator-temporal/src/workflows/hosted-user-runtime.ts`
should implement this shape, not a full object-carrying workflow:

```ts
import {
  condition,
  continueAsNew,
  defineQuery,
  defineSignal,
  proxyActivities,
  setHandler,
  sleep,
  uuid4,
  workflowInfo,
} from "@temporalio/workflow";
```

State:

```txt
- signalVersion
- mailboxSignalCount
- latestMailboxPointer
- manualRunRequested
- browserVaultRefreshRequested
- deviceSyncRecoveryRequested
- lagRecoveryObserved
- runtimeResultWakeAt
- ignoredWorkspaceWakeKey
- lastDemandKind
- lastDemandSource
- lastDemandNextWakeAt
- lastMailboxLagLaneCount
- lastExecutionAt
- lastExecutionKind
- lastExecutionErrorCode
```

Do not store `lastDemand` as the full demand object. Demand and execution
Activity inputs/results are recorded in workflow history, so keep those values
small and never include full workspace state, full invocation results,
redacted runtime status, signed usage decisions, prompts, transcripts, payloads,
or provider response bodies.

Loop:

```txt
1. Capture versionBeforeDemand = signalVersion.
2. readRuntimeDemand({
     userId,
     manualRunRequested,
     browserVaultRefreshRequested,
     deviceSyncRecoveryRequested,
     lagRecoveryObserved,
     runtimeResultWakeAt,
     ignoredWorkspaceWakeKey,
   })
3. If signalVersion changed while demand was awaited, keep all flags and loop.
4. Record only debug fields from demand.
5. blocked:
   - clear only flags that are safe for the blocked reason and only if the
     signal version still matches.
   - wait until retryAt or a newer signal.
6. idle:
   - clear satisfied flags only if the signal version still matches.
   - wait until demand.nextWakeAt or a newer signal.
7. run:
   - call ensureCloudflareExecution({
       userId,
       reason,
       orchestrationAttemptId: uuid4(),
       requiresAiUsageDecision,
     })
   - if a signal arrived during execution, keep flags and loop.
   - runtime_completed: set runtimeResultWakeAt from runtimeResultNextWakeAt;
     if source was workspace_wake, set ignoredWorkspaceWakeKey from demand.
   - runtime_wake_sent: sleep until recommendedRecheckAt, or an env-derived
     active-wake recheck delay based on the idle checkpoint window.
   - clear consumed flags only when the signal version still matches.
8. Continue-as-new when suggested or after a bounded loop count, carrying only
   the slim state above.
```

Timer rules:

```txt
- Use condition(predicate, timeout) when waiting for a signal or a timeout.
- Use sleep(ms) for timer-only waits such as runtime_wake_sent rechecks.
- Do not use condition(() => false, ms).
- Do not use a fixed one-second active wake recheck.
```

Design notes:

```txt
- No arrays of pending signals.
- Signal handler mutates tiny flags only and increments signalVersion.
- Activity reads durable web/runtime truth.
- Activity invokes Cloudflare execution adapter only.
- Transport failures are Activity exceptions and Temporal retries them.
- Workflow loops after every attempt and re-reads demand before idling.
- Continue-As-New carries only compact workflow-local flags and debug fields.
```

# 5. Demand activity

`packages/hosted-orchestrator-temporal/src/activities/read-runtime-demand.ts`

The activity should call **web HTTP**, not import Prisma. Temporal worker stays deploy-agnostic. Web remains truth owner.

## Web endpoint to add

```txt
GET /api/internal/hosted-orchestration/users/:userId/demand
```

Request query:

```txt
?manualRunRequested=1
&browserVaultRefreshRequested=1
&deviceSyncRecoveryRequested=1
&lagRecoveryObserved=1
&runtimeResultWakeAt=<iso or empty>
&ignoredWorkspaceWakeKey=<opaque or empty>
```

Response: `HostedRuntimeDemand` with `HostedRuntimeDemandWorkspaceProjection`,
not full `HostedWorkspaceState`.

This endpoint can reuse existing web status logic. The current status route already reads hosted workspace, mailbox high-water rows, recent logs, and computes mailbox lag.

## Demand priority

The web demand endpoint should implement only this priority order:

```txt
1. mailboxLag > 0
   → run reason = "nudge", source = "mailbox_backlog"

2. manualRunRequested
   → run reason = "manual", source = "manual"

3. browserVaultRefreshRequested
   → run reason = "browser_vault_refresh", source = "browser_vault_refresh"

4. deviceSyncRecoveryRequested
   → run reason = "nudge", source = "device_sync_recovery"

5. lagRecoveryObserved
   → run reason = "nudge", source = "lag_recovery"

6. runtimeResultWakeAt <= now
   → run reason = "retry", source = "runtime_result_wake"

7. workspace.nextWakeAt <= now and does not match ignoredWorkspaceWakeKey
   → run reason = "nudge", source = "workspace_wake"

8. otherwise
   → idle nextWakeAt = min(future runtimeResultWakeAt, future workspace.nextWakeAt)
```

Do **not** add assistant logic here. Do not parse automations. Do not inspect outbox. Do not inspect device provider state beyond explicit flags. Runtime owns that.

When demand source is `workspace_wake` and execution completes, the workflow
will pass back `ignoredWorkspaceWakeKey` for the same slim projection. The
demand endpoint should idle on that same key unless the workspace version/wake
projection changes, mailbox lag appears, explicit flags arrive, or
`runtimeResultWakeAt` becomes due.

## Usage gating

Hard-cut recommendation:

```txt
- Web remains usage/product owner.
- Runtime/provider layer remains final spend enforcement before model calls.
- Demand endpoint returns `requiresAiUsageDecision: true` for run demand that
  needs a signed usage decision.
- If usage gate denies, return blocked(ai_usage_denied) with retryAt null.
- If usage gate unavailable, return blocked(ai_usage_gate_unavailable) with retryAt soon.
```

Keep the usage logic inside apps/web. The Temporal workflow never stores the
signed decision. The `ensureCloudflareExecution` Activity fetches a fresh signed
decision from web inside the Activity when `requiresAiUsageDecision` is true,
then passes it directly to Cloudflare.

# 6. Cloudflare execution adapter

Add a new route:

```txt
POST /internal/users/:userId/runtime/ensure-execution
```

## Request

```ts
type HostedRuntimeEnsureExecutionRequest = {
  reason: HostedWorkspaceInvocationReason;
  orchestrationAttemptId: string;
  // Fetched by the Activity when needed; never stored in workflow history.
  aiUsageAllowDecision?: HostedAiUsageAllowDecision | null;
};
```

## Response

```ts
type HostedRuntimeEnsureExecutionResponse =
  | {
      action: "started" | "replaced";
      kind: "runtime_completed";
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

There is intentionally no `caught-up`, no `mailboxLag`, no `nextAlarmAt`, no
full runtime invocation result, and no “completion” status. Temporal/web owns
that.

## Durable Object method

Add:

```ts
async ensureRuntimeExecutionForUser(input: {
  aiUsageAllowDecision?: HostedAiUsageAllowDecision | null;
  orchestrationAttemptId: string;
  reason: HostedWorkspaceInvocationReason;
  userId: string;
}): Promise<HostedRuntimeEnsureExecutionResponse>
```

## `HostedUserRunner` method

The method is an execution adapter only:

```txt
- bind the Durable Object to the user
- if an active write fence exists, send a payloadless wake to that child
- if the active child is proven not wakeable, clear the matching fence by
  identity with an execution-only clear method and start a replacement
- if no active write fence exists, acquire one and invoke the container
- return runtime_completed or runtime_wake_sent
- throw for transport failures so Temporal Activity retry policy owns retries
```

## Existing active runtime

The active runtime branch should do only transport work:

```txt
- accepted wake:
  return runtime_wake_sent with recommendedRecheckAt derived from execution
  policy, preferably idleCheckpointDelayMs plus a small margin.
- start-required / no active child:
  clear the matching fence by identity using clearWriteFenceForReplacement,
  then start a replacement invocation and return runtime_completed with
  action = "replaced".
- unknown / ambiguous wake:
  throw a retryable Activity error. Do not schedule a Cloudflare retry loop.
```

## Start runtime execution

Extract the execution-only part of current `runRuntimeWake()`. Current code
already acquires a write fence, reads the workspace, binds workspace version,
invokes the container, clears the fence on completion, and records failure.

Hard-cut changes:

```txt
- do not call scheduleAfterRuntimeWake()
- do not read mailboxLag or web demand
- do not schedule semantic wake_at
- do not write backoff_until for orchestration
- return only runtimeStatus and runtimeResultNextWakeAt from the invocation
- on transport failure, clear the active fence with an execution-only method and
  throw
```

Batch 2B must not reuse existing clear helpers if they implicitly write
`wake_at` or `backoff_until`. Add execution-only methods such as:

```ts
async clearWriteFenceForReplacement(input: {
  attemptId: string;
  generation: string;
  userId: string;
  error?: unknown;
  finishedAt?: string | null;
}): Promise<{ cleared: boolean; record: RunnerStateRecord }>;

async clearWriteFenceAfterTransportFailure(input: {
  error: unknown;
  finishedAt?: string | null;
  token: RunnerWriteFenceToken;
}): Promise<{ failed: boolean; record: RunnerStateRecord }>;
```

Those methods may update bounded diagnostics, but they must not set `wake_at`,
`backoff_until`, or schedule a retry. The only alarm is the active write-fence
watchdog.

## Watchdog alarm only

Replace semantic alarm sync with:

```ts
private async syncWatchdogAlarm(record: RunnerStateRecord): Promise<void> {
  if (!record.writeFence) {
    await this.state.storage.deleteAlarm?.();
    return;
  }

  await this.state.storage.setAlarm(new Date(record.writeFence.expiresAt));
}
```

And `alarm()` becomes:

```ts
async alarm(): Promise<void> {
  const result = await this.stateStore.clearExpiredWriteFence(Date.now());

  if (result.record.writeFence) {
    await this.syncWatchdogAlarm(result.record);
  } else {
    await this.state.storage.deleteAlarm?.();
  }
}
```

No progress reconciliation. No nudge. No demand read. No next wake scheduling.

# 7. Web hard cut

## Replace Vercel webhook workflow with Temporal signal

Current flow:

```txt
append mailbox item
startHostedWebhookNudgeWorkflow({ mailboxItemId, source })
```

New flow:

```txt
append mailbox item
signalHostedUserRuntimeWorkflow({
  kind: "mailbox_appended",
  mailboxItemId,
  lane,
  laneSeq,
  source,
})
```

The existing Vercel workflow is a single pointer-only nudge step; it checks the mailbox item and nudges Cloudflare.   Hard cut deletes it.

## New helper

`apps/web/src/lib/hosted-orchestration/signal-runtime.ts`

```ts
import { Client } from "@temporalio/client";
import {
  HOSTED_USER_RUNTIME_SIGNAL_NAME,
  HOSTED_USER_RUNTIME_TASK_QUEUE,
  HOSTED_USER_RUNTIME_WORKFLOW_TYPE,
  type HostedRuntimeSignal,
} from "@murphai/hosted-execution/orchestration-control";

import { readTemporalClient } from "./temporal-client";

export async function signalHostedUserRuntimeWorkflow(input: {
  signal: HostedRuntimeSignal;
  userId: string;
}): Promise<void> {
  const client = await readTemporalClient();

  await client.workflow.signalWithStart(HOSTED_USER_RUNTIME_WORKFLOW_TYPE, {
    workflowId: hostedUserRuntimeWorkflowId(input.userId),
    taskQueue: HOSTED_USER_RUNTIME_TASK_QUEUE,
    args: [{ userId: input.userId }],
    signal: HOSTED_USER_RUNTIME_SIGNAL_NAME,
    signalArgs: [input.signal],
  });
}

export function hostedUserRuntimeWorkflowId(userId: string): string {
  return `hosted-user-runtime:${userId}`;
}
```

If TypeScript complains about string workflow type overloads, add a typed wrapper in the Temporal package and import that from web. Prefer keeping web free of `@temporalio/workflow` imports.

## Device-sync

Legacy device-sync wake code appended wakes and started the Vercel nudge
workflow best-effort. Hard-cut replacement:

```ts
await signalHostedUserRuntimeWorkflow({
  userId,
  signal: {
    kind: "mailbox_appended",
    mailboxItemId,
    lane: "system",
    laneSeq,
    source: "device-sync",
  },
});
```

For dirty/reconcile recovery paths that currently bypass mailbox progress checks, signal:

```ts
await signalHostedUserRuntimeWorkflow({
  userId,
  signal: {
    kind: "device_sync_recovery_requested",
    connectionId,
    eventId,
    reason: "dirty",
  },
});
```

Temporal does not inspect provider details. Runtime/web dirty state still owns the actual device-sync business logic.

## Lag sweeper

Current lag sweeper computes lag and nudges Cloudflare for eligible users.  Hard-cut replacement:

```txt
lag sweeper scans
if lagged user eligible:
  signalHostedUserRuntimeWorkflow({
    kind: "mailbox_lag_observed",
    eventId: deterministic event id,
    source: "lag-sweeper",
  })
```

No Cloudflare nudge. The sweeper becomes a recovery signal source, not a runner scheduler.

Eventually, delete the sweeper or make it a rare audit.

# 8. Parallel batch plan

This is the batch graph.

```txt
Batch 0: Architecture guardrail docs
  ↓
Batch 1: Shared contracts + Temporal skeleton + Cloudflare route scaffold
  ↓
Batch 2: Cloudflare execution adapter + Web demand endpoint + Temporal activities
  ↓
Batch 3: Web signal hard cut + Temporal workflow implementation + tests
  ↓
Batch 4: Delete old scheduler/workflow paths + state cleanup + e2e
```

Within each batch, prompts can run in parallel.

# 9. Batch 0 — architecture guardrail

## Batch 0 Prompt A — Architecture decision record

```txt
You are Subagent 0A. Your job is to write the hard-cut architecture decision record for Temporal orchestration.

Goal:
- Add a concise but strict architecture doc that defines the final ownership split:
  - web owns ingress/product/status
  - Temporal owns orchestration/scheduling/wakeups
  - Cloudflare owns container execution only
  - Murph runtime owns assistant/Codex/device/outbox/business logic
- The doc must explicitly forbid duplicating runtime business logic in Temporal.
- The doc must explicitly forbid Cloudflare from deriving semantic demand.
- The doc must define "execution acceptance is not completion."
- The doc must define "web/runtime status is durable truth."
- This is a greenfield hard cut: do not propose deploy-skew compatibility, Vercel Workflow coexistence, or dual paths.

Files to inspect:
- agent-docs/references/hosted-runtime-protocol.md
- ARCHITECTURE.md
- apps/cloudflare/src/user-runner.ts
- apps/web/app/api/internal/hosted-runtime/status/route.ts
- apps/web/src/lib/hosted-mailbox/lag.ts
- packages/assistant-runtime/src/hosted-runtime.ts
- agent-docs/exec-plans/completed/TEMPORAL.md

Files to change:
- Add agent-docs/references/hosted-temporal-orchestration.md
- Update ARCHITECTURE.md with a short pointer to the new doc.

Required content:
- Final architecture diagram.
- Ownership table.
- Allowed/forbidden Temporal state.
- Cloudflare execution adapter contract summary.
- Final minimal contract:
  - `HostedRuntimeDemandWorkspaceProjection`
  - `runtimeResultWakeAt` / `runtimeResultNextWakeAt`
  - `ignoredWorkspaceWakeKey`
  - `requiresAiUsageDecision`
  - `runtime_completed` / `runtime_wake_sent`
- Deletion list:
  - Vercel workflow nudge paths
  - Cloudflare semantic scheduling paths
  - DO wake_at/backoff semantic usage
  - nudge-as-completion assumptions
- Acceptance criteria.

Do not:
- Add code.
- Add compatibility mode.
- Suggest preserving Vercel Workflow.
- Suggest putting Codex logic in Temporal.
```

Acceptance:

```txt
- The doc gives future subagents a single source of truth.
- It names specific forbidden complexity patterns.
- It references existing repo ownership split.
```

# 10. Batch 1 — contracts and scaffolds

These can run in parallel after Batch 0.

## Batch 1 Prompt A — Shared orchestration contracts

```txt
You are Subagent 1A. Your job is to add pure shared orchestration contracts.

Goal:
- Add pointer-only hosted orchestration contracts to packages/hosted-execution.
- These contracts are shared by web, Temporal worker, and Cloudflare.
- They must not import Temporal SDK, Prisma, Cloudflare, assistant-runtime, or app code.

Files to inspect:
- packages/hosted-execution/src/runtime-control.ts
- packages/hosted-execution/src/parsers/runtime-control.ts
- packages/hosted-execution/package.json
- packages/hosted-execution/test/hosted-runtime-control.test.ts

Files to change:
- packages/hosted-execution/src/orchestration-control.ts
- packages/hosted-execution/src/parsers/orchestration-control.ts
- packages/hosted-execution/src/index.ts
- packages/hosted-execution/package.json exports if required
- packages/hosted-execution/test/hosted-orchestration-control.test.ts

Implement:
- HOSTED_USER_RUNTIME_WORKFLOW_TYPE
- HOSTED_USER_RUNTIME_TASK_QUEUE
- HOSTED_USER_RUNTIME_SIGNAL_NAME
- HOSTED_USER_RUNTIME_STATUS_QUERY_NAME
- HostedRuntimeSignal
- HostedRuntimeDemandWorkspaceProjection
- HostedRuntimeDemandRequest
- HostedRuntimeDemand
- HostedRuntimeEnsureExecutionRequest
- HostedRuntimeEnsureExecutionResponse
- HostedRuntimeWorkflowState
- strict parse functions

Rules:
- Signal payloads must be pointer-only.
- No raw payload strings except ids/source labels.
- Mailbox signal source is a bounded safe string, not a provider enum.
- Use existing HostedWorkspaceInvocationReason, HostedMailboxLane,
  HostedMailboxLaneLag, and HostedWorkspaceInvocationStatus types where useful.
- Do not import or expose full HostedWorkspaceState or full
  HostedWorkspaceInvocationResult in orchestration contracts.
- Demand returns `requiresAiUsageDecision`, never a signed allow-decision body.
- Ensure-execution response variants are only `runtime_completed` and
  `runtime_wake_sent`.
- Do not add a workflow success union for transport failures; transport
  failures must be Activity exceptions.
- Keep parser style consistent with existing hosted-execution parser helpers.
- Add tests for every signal variant and invalid raw payload attempts.

Do not:
- Add Temporal imports.
- Add app-specific source values beyond simple source strings.
- Add provider payload schemas.
- Add any business logic.
- Add full workspace/result types or signed usage decisions to workflow-facing
  history contracts.
```

Acceptance:

```txt
pnpm --filter @murphai/hosted-execution test
pnpm typecheck:packages
```

## Batch 1 Prompt B — Temporal package skeleton

```txt
You are Subagent 1B. Your job is to add the private Temporal orchestration package skeleton.

Goal:
- Add packages/hosted-orchestrator-temporal with workflows, activities, client, worker entrypoint, and tests scaffold.
- Do not implement full logic yet; add compile-safe stubs using shared contracts.

Files to inspect:
- package.json root scripts style
- tsconfig.json
- pnpm-workspace.yaml
- existing package package.json files
- scripts/workspace-verify.sh if needed

Files to add:
- packages/hosted-orchestrator-temporal/package.json
- packages/hosted-orchestrator-temporal/tsconfig.json
- packages/hosted-orchestrator-temporal/src/index.ts
- packages/hosted-orchestrator-temporal/src/workflows/hosted-user-runtime.ts
- packages/hosted-orchestrator-temporal/src/activities/index.ts
- packages/hosted-orchestrator-temporal/src/activities/read-runtime-demand.ts
- packages/hosted-orchestrator-temporal/src/activities/ensure-cloudflare-execution.ts
- packages/hosted-orchestrator-temporal/src/client/temporal-client.ts
- packages/hosted-orchestrator-temporal/src/client/signal-hosted-user-runtime.ts
- packages/hosted-orchestrator-temporal/src/worker.ts
- packages/hosted-orchestrator-temporal/test/*.test.ts

Dependencies:
- @temporalio/client
- @temporalio/worker
- @temporalio/workflow
- @murphai/hosted-execution
- @murphai/cloudflare-hosted-control if useful for existing client transport

Rules:
- Workflow code must not import Node-only modules.
- Activity code may use fetch/client/env.
- Client code may use @temporalio/client.
- Worker code may use @temporalio/worker.
- Add exports that let apps/web call signalHostedUserRuntimeWorkflow without importing workflow internals.
- The shared workflow type constant must match the exported workflow function
  name exactly: `hostedUserRuntimeWorkflow`.
- ESM worker setup must use an explicit compatible `workflowsPath`, such as
  `createRequire(import.meta.url).resolve(...)`, or a prebuilt bundle later.

Initial behavior:
- Workflow accepts runtimeSignal and exposes runtimeWorkflowStatus query.
- Activities throw "not implemented" but compile.
- Worker creates a Temporal Worker on HOSTED_USER_RUNTIME_TASK_QUEUE.
- Worker stubs use config-derived Activity timeout wiring placeholders:
  short demand read timeout and ensure-execution timeout derived from the
  Cloudflare runner timeout plus margin.

Do not:
- Import Prisma.
- Import assistant-runtime.
- Import apps/web code.
- Import apps/cloudflare code.
```

Acceptance:

```txt
pnpm --filter @murphai/hosted-orchestrator-temporal test
pnpm typecheck:packages
```

## Batch 1 Prompt C — Cloudflare route scaffold

```txt
You are Subagent 1C. Your job is to scaffold the new Cloudflare ensure-execution control route and DO method without changing old behavior yet.

Goal:
- Add POST /internal/users/:userId/runtime/ensure-execution.
- Add UserRunnerDurableObject.ensureRuntimeExecutionForUser().
- Add HostedUserRunner.ensureRuntimeExecutionForUser() stub that returns a temporary explicit not-implemented error.
- Wire request/response parsers from shared contracts.

Files to inspect:
- apps/cloudflare/src/index.ts
- apps/cloudflare/src/user-runner.ts
- apps/cloudflare/src/worker-routes/shared.ts
- packages/cloudflare-hosted-control
- packages/hosted-execution/src/runtime-control.ts

Files to change:
- apps/cloudflare/src/index.ts
- apps/cloudflare/src/user-runner.ts
- packages/cloudflare-hosted-control/src/routes.ts
- packages/cloudflare-hosted-control/src/client.ts if existing client package owns route clients
- apps/cloudflare/test/index.test.ts or new route test

Behavior:
- Route requires the bound-user auth header and accepts Vercel OIDC callers plus
  signed Temporal internal-callback callers during cutover.
- Route parses HostedRuntimeEnsureExecutionRequest.
- Route calls DO method.
- DO method calls HostedUserRunner method.
- Stub throws a controlled 501/unsupported error for now.

Do not:
- Reuse nudge route.
- Call ensureRunnerProgress.
- Start containers yet.
- Add scheduling.
```

Acceptance:

```txt
pnpm test:apps -- apps/cloudflare
pnpm typecheck
```

# 11. Batch 2 — core implementation

These can run in parallel after Batch 1.

## Batch 2 Prompt A — Web demand endpoint

```txt
You are Subagent 2A. Your job is to add the web-hosted runtime demand endpoint used by Temporal activities.

Goal:
- Add GET /api/internal/hosted-orchestration/users/:userId/demand.
- The endpoint returns HostedRuntimeDemand.
- It reuses existing web-owned status truth:
  - hosted workspace
  - mailbox high-water rows
  - mailboxLag
  - slim workspace wake projection
  - workflow-provided runtimeResultWakeAt
  - workflow-provided ignoredWorkspaceWakeKey
  - requiresAiUsageDecision boolean
- It must not duplicate assistant/runtime business logic.

Files to inspect:
- apps/web/app/api/internal/hosted-runtime/status/route.ts
- apps/web/src/lib/hosted-mailbox/lag.ts
- apps/web/src/lib/hosted-mailbox/store.ts
- apps/web/src/lib/hosted-workspace/store.ts
- apps/web/src/lib/hosted-runner/assistant-nudge.ts
- apps/web/src/lib/hosted-execution/usage-allowance.ts
- apps/web/src/lib/hosted-execution/usage-gate-allow-decision.ts

Files to add/change:
- apps/web/app/api/internal/hosted-orchestration/users/[userId]/demand/route.ts
- apps/web/src/lib/hosted-orchestration/runtime-demand.ts
- apps/web/test/hosted-orchestration-demand.test.ts

Demand priority:
1. mailboxLag > 0
   return run/nudge/mailbox_backlog
2. manualRunRequested
   return run/manual/manual
3. browserVaultRefreshRequested
   return run/browser_vault_refresh/browser_vault_refresh
4. deviceSyncRecoveryRequested
   return run/nudge/device_sync_recovery
5. lagRecoveryObserved
   return run/nudge/lag_recovery
6. runtimeResultWakeAt <= now
   return run/retry/runtime_result_wake
7. workspace.nextWakeAt <= now and not ignored by ignoredWorkspaceWakeKey
   return run/nudge/workspace_wake
8. otherwise
   return idle with nextWakeAt = earliest future runtimeResultWakeAt or workspace.nextWakeAt, or null

Usage gating:
- Keep usage logic in web.
- For run demands that may use assistant/model work, return
  requiresAiUsageDecision: true.
- Do not return a signed aiUsageAllowDecision from demand.
- If usage denied, return blocked(ai_usage_denied).
- If usage gate unavailable, return blocked(ai_usage_gate_unavailable) with a short retryAt.
- Browser-vault refresh may not need model usage; keep policy explicit and tested.

Do not:
- Import Temporal.
- Import Cloudflare.
- Import assistant-runtime.
- Parse automations.
- Inspect outbox.
- Inspect provider dirty details beyond explicit request flags.
```

Acceptance:

```txt
- Tests for all priority branches.
- Tests prove mailboxLag outranks manual/browser/device flags.
- Tests prove future nextWakeAt returns idle.
- Tests prove due nextWakeAt returns run/workspace_wake.
- Tests prove runtimeResultWakeAt returns run/retry/runtime_result_wake before workspace_wake.
- Tests prove ignoredWorkspaceWakeKey suppresses the same stale workspace wake.
- Tests prove usage denied returns blocked.
```

## Batch 2 Prompt B — Cloudflare execution-only adapter

```txt
You are Subagent 2B. Your job is to implement HostedUserRunner.ensureRuntimeExecutionForUser as an execution adapter only.

Goal:
- Extract the execution-only part of runRuntimeWake().
- Do not call ensureRunnerProgress().
- Do not call scheduleAfterRuntimeWake().
- Do not read mailboxLag.
- Do not derive demand.
- Do not schedule semantic wake_at.
- Keep runtime write fence and container invocation behavior.

Files to inspect:
- apps/cloudflare/src/user-runner.ts
- apps/cloudflare/src/user-runner/runner-state-store.ts
- apps/cloudflare/src/user-runner/runner-state-helpers.ts
- apps/cloudflare/src/runner-container.ts
- apps/cloudflare/src/runner-job-transport.ts
- apps/cloudflare/src/index.ts

Implement:
- ensureRuntimeExecutionForUser(input)
- ensureExistingRuntimeExecution(input, record)
- startRuntimeExecution(input)
- syncWatchdogAlarm(record)
- alarm() should only clear expired write fence / maintain watchdog.

Behavior:
- If no active write fence:
  - acquire write fence
  - read workspace
  - bind workspace version
  - invokeWorkspaceRunner
  - clear fence after completion using execution-only semantics
  - return runtime_completed with action started and runtimeResultNextWakeAt
- If active write fence:
  - call ensureActiveRuntimeProcessing
  - accepted -> runtime_wake_sent with recommendedRecheckAt
  - start-required/no-active-child -> clear fence by identity with an
    execution-only clear method and start replacement
  - unknown/retry-scheduled -> throw retryable error for Temporal activity retry
- On invocation failure:
  - clear fence after failure with an execution-only method
  - throw error
  - do not schedule Cloudflare retry
- The only alarm is write-fence watchdog at activeFence.expiresAt.

Do not:
- Read hosted runtime status.
- Read mailboxLag.
- Use wake_at.
- Schedule short progress recheck.
- Park retry cap.
- Clear retry state for mailbox demand.
- Return caught-up.
- Return full HostedWorkspaceInvocationResult or redactedStatus.
- Reuse clear methods that write wake_at/backoff_until.
```

Acceptance:

```txt
- Unit tests with no active fence start container.
- Unit tests active fence + accepted wake returns runtime_wake_sent with recommendedRecheckAt.
- Unit tests active fence + no active child clears fence and replaces.
- Unit tests unknown wake throws retryable error and keeps/clears fence according to explicit policy.
- Unit tests completion does not schedule nextWakeAt or Cloudflare alarm except watchdog cleanup.
- Unit tests prove execution-only clear paths do not write wake_at or backoff_until.
```

## Batch 2 Prompt C — Runner state hard cut

```txt
You are Subagent 2C. Your job is to simplify Cloudflare runner state usage for the hard cut.

Goal:
- Keep active write fence state.
- Keep last invocation/error observability if useful.
- Stop using wake_at/backoff/failure_count/browser_vault_refresh_requested_at for scheduling.
- Make state helpers reflect execution lease semantics.

Files to inspect:
- apps/cloudflare/src/user-runner/runner-state-store.ts
- apps/cloudflare/src/user-runner/runner-state-helpers.ts
- apps/cloudflare/src/user-runner/types.ts
- apps/cloudflare/test/runner-state-store*.test.ts

Hard-cut approach:
- You may leave DB columns in place if removing migrations is risky, but code should not use them for orchestration.
- Rename methods conceptually or add new methods:
  - beginWriteFence
  - bindWriteFenceWorkspaceVersion
  - clearWriteFenceAfterCompletion
  - clearWriteFenceForReplacement
  - clearWriteFenceAfterTransportFailure
  - clearExpiredWriteFence
  - readState
- Deprecate/delete:
  - markWakePending
  - scheduleNextWake
  - scheduleRetry
  - parkAfterRetryCap
  - clearRetryStateForFreshDemand
  - browser-vault refresh requested methods
  - readDueWork
  - consumeDueRunnerAlarmAndDecide

Do not:
- Add a second state machine.
- Add queue history.
- Add Temporal workflow ids to Cloudflare state unless purely diagnostic.
- Use existing write-fence clear helpers unchanged if they write wake_at or
  backoff_until.
```

Acceptance:

```txt
- Cloudflare tests compile with removed semantic scheduling paths.
- State record still exposes active write fence enough for status/debug.
- Alarm tests are updated to watchdog-only semantics.
```

## Batch 2 Prompt D — Temporal activities

```txt
You are Subagent 2D. Your job is to implement Temporal activities.

Goal:
- Implement readRuntimeDemand activity by calling web demand endpoint.
- Implement ensureCloudflareExecution activity by calling Cloudflare ensure-execution endpoint.
- Keep all network/config code in activities, not workflows.
- Add strict parsing of all responses.
- Fetch fresh signed web usage decision inside ensureCloudflareExecution when
  requiresAiUsageDecision is true.
- Use Activity exceptions for transport failures.

Files to inspect:
- packages/hosted-orchestrator-temporal/src/activities/*
- packages/cloudflare-hosted-control/src/client.ts
- apps/web/src/lib/hosted-execution/control.ts
- packages/hosted-execution/src/orchestration-control.ts

Implement:
- readRuntimeDemand(input: HostedRuntimeDemandRequest): Promise<HostedRuntimeDemand>
- ensureCloudflareExecution(input: {
    orchestrationAttemptId: string;
    reason: HostedWorkspaceInvocationReason;
    requiresAiUsageDecision: boolean;
    userId: string;
  }): Promise<HostedRuntimeEnsureExecutionResponse>
- HTTP clients:
  - web demand client
  - web usage allow-decision client
  - cloudflare ensure-execution client
- env readers:
  - HOSTED_WEB_BASE_URL
  - HOSTED_WEB_CALLBACK_SIGNING_KEY_ID /
    HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK for signed web demand, usage, and
    Cloudflare ensure-execution requests
  - CLOUDFLARE_HOSTED_CONTROL_BASE_URL
- tests with mocked fetch/client.
- Activity timeouts:
  - readRuntimeDemand is short, e.g. 10s-30s from env/config.
  - ensureCloudflareExecution is Cloudflare runner timeout plus safety margin.
  - signal-with-start args include env-derived workflow timeout options so the
    workflow proxy timeouts match the HTTP Activity timeout budget.
- When `requiresAiUsageDecision` is true, fetch the signed decision from web
  inside the Activity and pass it in the Cloudflare
  `HostedRuntimeEnsureExecutionRequest.aiUsageAllowDecision` field.

Do not:
- Import Prisma.
- Import apps/web modules.
- Import apps/cloudflare modules.
- Put fetch inside workflow code.
- Return unparsed JSON.
- Return transport failures as success unions.
- Store or return signed usage decisions to the workflow.
- Put `requiresAiUsageDecision` on the Cloudflare request body.
```

Acceptance:

```txt
- Activity tests cover success and invalid response.
- Activity tests cover Cloudflare retryable network error.
- Typecheck passes.
```

# 12. Batch 3 — Temporal workflow and web signaling

These can run after Batch 2.

## Batch 3 Prompt A — Implement workflow loop

```txt
You are Subagent 3A. Your job is to implement the hosted user Temporal workflow loop.

Goal:
- Use tiny coalesced signal state.
- Read demand through activity.
- Invoke Cloudflare execution through activity.
- Sleep until retryAt / runtimeResultWakeAt / workspace nextWakeAt or until a new signal.
- Continue-as-new when suggested or after a bounded iteration count.
- Query exposes compact status.

Files to inspect:
- packages/hosted-orchestrator-temporal/src/workflows/hosted-user-runtime.ts
- packages/hosted-execution/src/orchestration-control.ts
- Temporal TypeScript workflow tests in repo if any

Implement:
- defineSignal using HOSTED_USER_RUNTIME_SIGNAL_NAME.
- defineQuery using HOSTED_USER_RUNTIME_STATUS_QUERY_NAME.
- workflow state fields:
  - signalVersion
  - mailboxSignalCount
  - latestMailboxPointer
  - manualRunRequested
  - browserVaultRefreshRequested
  - deviceSyncRecoveryRequested
  - lagRecoveryObserved
  - runtimeResultWakeAt
  - ignoredWorkspaceWakeKey
  - lastDemandKind
  - lastDemandSource
  - lastDemandNextWakeAt
  - lastMailboxLagLaneCount
  - lastExecutionAt
  - lastExecutionKind
  - lastExecutionErrorCode
- Demand loop exactly:
  - capture signalVersion before read demand
  - read demand with runtimeResultWakeAt and ignoredWorkspaceWakeKey
  - if signalVersion changed during demand read, keep flags and loop
  - if blocked: wait retryAt or signal
  - if idle: clear satisfied flags, wait nextWakeAt or signal
  - if run: ensure execution, version-gate flag clearing, update runtimeResultWakeAt from runtimeResultNextWakeAt, set ignoredWorkspaceWakeKey after completed workspace_wake, if runtime_wake_sent sleep until recommendedRecheckAt or env-derived active-wake delay, loop
- Add continue-as-new carry-forward state.

Do not:
- Store arrays of signals.
- Store full HostedRuntimeDemand, HostedWorkspaceState, HostedWorkspaceInvocationResult, redactedStatus, or signed usage decisions.
- Inspect mailbox contents.
- Compute assistant-specific logic.
- Put network calls in workflow.
- Use condition(() => false, ms); use sleep() for timer-only waits.
- Use a fixed one-second active wake recheck.
- Use Date from outside Temporal-safe APIs unless allowed by workflow determinism. Date.now is deterministic in Temporal workflows; use it sparingly for timer math.
```

Acceptance:

```txt
- Workflow tests:
  - mailbox signal causes run after demand says mailbox backlog.
  - future nextWakeAt sleeps until timer.
  - signal interrupts idle wait.
  - runtime_wake_sent waits using recommendedRecheckAt and re-reads demand.
  - runtime_completed preserves runtimeResultNextWakeAt as runtimeResultWakeAt.
  - runtime_result_wake demand runs before workspace_wake.
  - stale workspace_wake is ignored by ignoredWorkspaceWakeKey.
  - signals arriving during awaited demand/execution are not lost.
  - idle clears mailbox/manual/browser/device flags.
  - continue-as-new is testable through small iteration threshold.
```

## Batch 3 Prompt B — Web signal helper and hard-cut Vercel replacement

```txt
You are Subagent 3B. Your job is to replace all webhook nudge workflow starts with Temporal signal-with-start.

Goal:
- Add web Temporal client helper.
- Replace startHostedWebhookNudgeWorkflow calls with signalHostedUserRuntimeWorkflow.
- Delete Vercel workflow start helpers if no longer used.
- Keep signals pointer-only.

Files to inspect:
- apps/web/src/lib/hosted-onboarding/webhook-workflow-start.ts
- apps/web/src/lib/hosted-onboarding/webhook-workflows.ts
- apps/web/src/lib/hosted-onboarding/webhook-workflow-steps.ts
- apps/web/app/api/internal/hosted-mailbox/email-ingress/route.ts
- apps/web/app/api/internal/hosted-mailbox/email-ingress/nudge-workflow/route.ts
- apps/cloudflare/src/web-control-plane-email-ingress.ts
- apps/cloudflare/src/hosted-email/worker-ingress.ts
- apps/web/src/lib/device-sync/wake-service.ts
- apps/web/src/lib/hosted-onboarding/webhook-service-wake.ts
- apps/web/src/lib/hosted-mailbox/store.ts
- apps/web/test/hosted-onboarding-webhook-workflows.test.ts
- apps/web/test/hosted-execution-handoff.test.ts

Implement:
- apps/web/src/lib/hosted-orchestration/temporal-client.ts
- apps/web/src/lib/hosted-orchestration/signal-runtime.ts
- Replace all startHostedWebhookNudgeWorkflow calls.
- Ensure Cloudflare email ingress appends through the canonical web email
  ingress route and that route signals Temporal directly after append.
- Delete the old email-ingress nudge-workflow route/client; do not retain a
  second post-append callback just to start the runtime.
- For each mailbox append, signal:
  kind: "mailbox_appended"
  mailboxItemId
  lane
  laneSeq
  source: bounded safe string
- For device-sync dirty/reconcile recovery paths, signal device_sync_recovery_requested when that better matches the old bypass semantics.
- Delete old Vercel workflow files and tests or rewrite tests to assert Temporal signal call.

Do not:
- Pass raw webhook payloads to Temporal.
- Pass provider headers.
- Pass provider enum assumptions; parser accepts bounded safe source strings.
- Keep Vercel Workflow as fallback.
- Nudge Cloudflare directly from these paths.
```

Acceptance:

```txt
- Tests assert signalWithStart called with workflowId hosted-user-runtime:{userId}.
- Tests assert no raw payload in signal args.
- Tests assert mailbox source strings are bounded/sanitized.
- Tests assert duplicate mailbox append still signals safely or follows chosen idempotency policy.
```

## Batch 3 Prompt C — Browser-vault refresh and manual/admin wake

```txt
You are Subagent 3C. Your job is to route explicit non-mailbox wake requests through Temporal.

Goal:
- Browser-vault refresh requests should signal Temporal, not Cloudflare DO state.
- Manual/admin/test run requests should signal Temporal.
- Remove Cloudflare browserVaultRefreshRequestedAt scheduling.

Files to inspect:
- apps/cloudflare/src/index.ts browserVaultRefresh route
- apps/cloudflare/src/user-runner.ts scheduleBrowserVaultRefreshForUser
- apps/web browser vault freshness scheduling code
- apps/web tests for browser vault refresh
- packages/hosted-execution/src/runtime-control.ts

Implement:
- Web-side browser refresh scheduling calls signalHostedUserRuntimeWorkflow({
    kind: "browser_vault_refresh_requested",
    eventId
  })
- Manual/admin run helpers call signalHostedUserRuntimeWorkflow({
    kind: "manual_run_requested",
    eventId,
    source
  })
- Cloudflare browser-vault refresh route is removed unless still needed for browser-vault replica reads; it must not schedule runtime work.
- Temporal demand endpoint honors browserVaultRefreshRequested/manualRunRequested flags.
- Manual/admin/test source values use the same bounded safe string parser.

Do not:
- Store browser refresh state in Cloudflare DO.
- Directly run container from web for refresh.
```

Acceptance:

```txt
- Tests prove browser-vault refresh signal reaches Temporal helper.
- Tests prove no Cloudflare nudge/control call is made.
```

## Batch 3 Prompt D — Lag sweeper signal conversion

```txt
You are Subagent 3D. Your job is to convert mailbox lag sweeper from Cloudflare nudge to Temporal signal.

Goal:
- Keep sweeper only as a backstop.
- Replace nudgeHostedAssistantRunnerUserBestEffortResult with signalHostedUserRuntimeWorkflow.
- Keep logging safe and pointer-only.

Files to inspect:
- apps/web/src/lib/hosted-mailbox/lag-sweeper.ts
- apps/web/test/hosted-mailbox-lag-sweeper.test.ts
- apps/web/src/lib/hosted-orchestration/signal-runtime.ts

Implement:
- For each selected lagged user, signal:
  kind: "mailbox_lag_observed"
  eventId: deterministic from userId + minute/window
  source: bounded safe string, e.g. "lag-sweeper"
- Keep selection/freshness window if desired.
- Remove Cloudflare nudge imports.
- Update result type:
  - signalAttempted
  - signalAccepted
  - signalFailed
  - laggedUsers
  - skippedLaggedUsers

Do not:
- Call Cloudflare runner.
- Compute runtime business logic.
```

Acceptance:

```txt
- Tests verify Temporal signal attempted for eligible lagged users.
- Tests verify no Cloudflare nudge call.
- Tests verify fresh grace still skips if retained.
```

# 13. Batch 4 — deletion and simplification

These run after Batch 3 is green.

## Batch 4 Prompt A — Delete Cloudflare semantic scheduler

```txt
You are Subagent 4A. Your job is to remove Cloudflare semantic scheduler paths.

Goal:
- Delete or hard-disable:
  - ensureRunnerProgress
  - readProgressSnapshot
  - runLocalEnsureLoop
  - scheduleAfterRuntimeWake
  - scheduleShortProgressRecheck
  - scheduleRetryAfterProgressDemandReadFailure
  - parkIfRunnerRetryCapReached
  - clearRetryStateForFreshMailboxDemand
  - readDueWork-based semantic scheduling
  - alarm progress reconciliation
- Keep:
  - ensureRuntimeExecutionForUser
  - startRuntimeExecution
  - ensureExistingRuntimeExecution
  - write fence validation
  - container invocation/wake
  - user deletion cleanup
  - status read if it is only observational

Files to inspect/change:
- apps/cloudflare/src/user-runner.ts
- apps/cloudflare/src/user-runner/runner-state-store.ts
- apps/cloudflare/src/user-runner/runner-state-helpers.ts
- apps/cloudflare/src/index.ts
- apps/cloudflare/test/*runner*.test.ts

Do not:
- Keep old nudge path as fallback.
- Keep nextAlarmAt semantics.
- Keep retry cap.
- Keep wake_at as a scheduler.
```

Acceptance:

```txt
- No references to ensureRunnerProgress.
- No references to scheduleAfterRuntimeWake.
- No semantic state alarms.
- Cloudflare alarm only handles active write fence watchdog.
```

## Batch 4 Prompt B — Delete old Vercel workflow layer

```txt
You are Subagent 4B. Your job is to delete old Vercel Workflow nudge layer.

Goal:
- Remove old workflow files and tests.
- Remove workflow dependency if no longer used.
- Remove all "use workflow" and "use step" nudge code.
- Ensure all ingress paths signal Temporal instead.

Files to inspect/change:
- apps/web/src/lib/hosted-onboarding/webhook-workflows.ts
- apps/web/src/lib/hosted-onboarding/webhook-workflow-start.ts
- apps/web/src/lib/hosted-onboarding/webhook-workflow-steps.ts
- apps/web/src/lib/hosted-onboarding/workflow-start.ts
- apps/web/src/lib/hosted-onboarding/workflow-step-options.ts
- apps/web/src/lib/hosted-onboarding/webhook-workflow-types.ts
- package.json / app package dependencies
- tests mentioning hosted webhook workflows

Do not:
- Leave dead workflow wrappers.
- Keep best-effort Cloudflare nudge fallback.
```

Acceptance:

```txt
- grep for "use workflow" shows no hosted webhook nudge workflow.
- grep for startHostedWebhookNudgeWorkflow returns no live references.
- tests updated to Temporal signal behavior.
```

## Batch 4 Prompt C — Remove nudge route or make it non-scheduler

```txt
You are Subagent 4C. Your job is to remove or neutralize Cloudflare runner-nudge.

Goal:
- In greenfield hard cut, remove /internal/users/:userId/nudge route if no longer used.
- Preferred: delete the external route and client methods.
- Internal Durable Object compatibility/test shims may remain only if they are
  not reachable as production scheduler routes and are documented as deprecated.

Files:
- apps/cloudflare/src/index.ts
- packages/cloudflare-hosted-control/src/routes.ts
- packages/cloudflare-hosted-control/src/client.ts
- apps/web/src/lib/hosted-runner/control.ts
- apps/web/src/lib/hosted-runner/assistant-nudge.ts
- tests

Do not:
- Keep nudge as scheduler.
- Return caught-up from Cloudflare.
- Keep nudge best-effort wrappers in web.
```

Acceptance:

```txt
- No production web code imports hosted-runner/assistant-nudge.
- No production web code calls nudgeHostedRunnerUserBestEffortResult.
- External Cloudflare route surface has ensure-execution, browser-vault session,
  status, deletion, deploy smoke, and snapshot/runtime callback routes only.
```

# 14. Batch 5 — end-to-end verification

## Batch 5 Prompt A — Temporal local dev harness

```txt
You are Subagent 5A. Your job is to add local development harness for Temporal orchestration.

Goal:
- Add scripts to run Temporal dev server and worker locally.
- Add env docs.
- Add local smoke test instructions.

Files:
- package.json
- scripts/hosted-local.ts if relevant
- packages/hosted-orchestrator-temporal/src/worker.ts
- docs or agent-docs operations docs

Add scripts:
- temporal:dev
- temporal:worker
- hosted-orchestration:smoke

Env:
- TEMPORAL_ADDRESS
- TEMPORAL_NAMESPACE
- TEMPORAL_TASK_QUEUE
- TEMPORAL_TLS_ENABLED if needed
- HOSTED_WEB_BASE_URL
- CLOUDFLARE_HOSTED_CONTROL_BASE_URL
- any auth env consistent with existing internal auth

Do not:
- Require Cloudflare to run Temporal worker.
- Require Temporal worker to run inside Cloudflare Containers.
```

Acceptance:

```txt
- Developer can run Temporal dev server.
- Developer can run worker.
- Developer can signal a test user workflow.
```

## Batch 5 Prompt B — E2E hosted orchestration test

```txt
You are Subagent 5B. Your job is to add end-to-end tests for the hard-cut orchestration flow.

Scenarios:
1. Mailbox append:
   - web appends mailbox item
   - web signals Temporal workflow
   - Temporal reads demand with mailboxLag > 0
   - Temporal calls Cloudflare ensure-execution
   - Cloudflare invokes container
   - runtime imports mailbox/checkpoints
   - Temporal re-reads demand and becomes idle

2. Active runtime wake:
   - active write fence exists
   - new mailbox signal arrives
   - Temporal calls ensure-execution
   - Cloudflare sends active wake
   - Cloudflare returns runtime_wake_sent with recommendedRecheckAt
   - Temporal waits through the recommended or env-derived recheck delay
   - if lag remains, repeats

3. Runtime-result wake:
   - Cloudflare runtime_completed returns runtimeResultNextWakeAt
   - workflow stores it as runtimeResultWakeAt
   - demand returns runtime_result_wake before workspace_wake when due
   - workflow calls ensure-execution

4. Workspace nextWakeAt:
   - runtime status has future nextWakeAt
   - workflow sleeps
   - timer fires
   - workflow calls ensure-execution
   - runtime returns/checkpoints next wake or idle
   - repeated identical due workspace wake is suppressed through ignoredWorkspaceWakeKey

5. Browser-vault refresh:
   - web signals browser_vault_refresh_requested
   - demand returns browser_vault_refresh
   - Cloudflare invokes runtime
   - workflow clears flag after attempt

6. Device-sync recovery:
   - signal device_sync_recovery_requested
   - no mailbox lag
   - demand still runs runtime
   - runtime handles dirty state through existing web/runtime callbacks

Files:
- e2e or apps/web test harnesses
- apps/cloudflare test helpers
- packages/hosted-orchestrator-temporal tests

Do not:
- Assert Cloudflare nextAlarmAt.
- Assert nudge accepted.
- Assert Vercel Workflow behavior.
```

Acceptance:

```txt
- E2E test proves "wake accepted is not completion."
- E2E test proves Temporal only idles after web status demand is idle.
- E2E test proves runtime-result nextWakeAt is preserved without requiring a
  workspace checkpoint.
- E2E test proves stale workspace wake suppression does not suppress fresh
  mailbox or explicit signal demand.
```

## Batch 5 Prompt C — Observability

```txt
You are Subagent 5C. Your job is to add minimal observability without adding complexity.

Goal:
- Add logs/metrics at orchestration boundaries only:
  - signal sent
  - workflow demand read
  - execution adapter called
  - execution adapter result
  - workflow idle with nextWakeAt
  - workflow blocked
- Add query endpoint/helper for workflow status.
- Do not add business payloads to logs.

Files:
- packages/hosted-orchestrator-temporal/src/workflows/hosted-user-runtime.ts
- packages/hosted-orchestrator-temporal/src/activities/*
- apps/web/src/lib/hosted-orchestration/*
- apps/cloudflare/src/user-runner.ts

Log fields:
- user fingerprint, not raw user id where public logs are used
- workflowId
- signal kind
- demand kind/source
- runtimeAttemptId
- orchestrationAttemptId
- nextWakeAtPresent
- runtimeResultWakeAtPresent
- ignoredWorkspaceWakeKeyPresent
- mailboxLagLaneCount
- execution result kind
- errorCode

Do not:
- Log raw mailbox payloads.
- Log prompts/transcripts.
- Log provider payloads.
```

Acceptance:

```txt
- Logs enough to debug stuck workflow.
- Logs remain metadata-only.
```

# 15. Merge order

Use this order to keep parallel work from conflicting too much.

```txt
1. Batch 0A
   Merge architecture doc first.

2. Batch 1A
   Merge shared contracts.

3. Batch 1B + 1C
   Merge Temporal skeleton and Cloudflare scaffold.
   These can land in either order after contracts.

4. Batch 2A + 2D
   Merge web demand endpoint and Temporal activities.
   2D can mock endpoint until 2A lands, then rebase.

5. Batch 2B
   Merge Cloudflare execution-only adapter.

6. Batch 2C
   Merge runner state hard cut after 2B tests are stable.

7. Batch 3A
   Merge real workflow loop.

8. Batch 3B + 3C + 3D
   Merge web signaling replacements.

9. Batch 4A + 4B + 4C
   Delete old scheduler/workflow/nudge paths.

10. Batch 5A + 5B + 5C
    Merge harness, e2e, observability.
```

# 16. Global search checklist

Before declaring done, these searches should pass.

## No old Vercel nudge workflow

```bash
rg "hostedWebhookNudgeWorkflow|startHostedWebhookNudgeWorkflow|nudgeHostedWebhookMailboxItemStep|email-ingress/nudge-workflow|startHostedEmailIngressNudgeWorkflowInWeb|nudge-workflow" apps/web/src apps/web/app apps/cloudflare/src packages/cloudflare-hosted-control/src
```

Expected:

```txt
No production hosted webhook or email nudge workflow references. Stripe
receipt/reconciliation workflows are outside this runtime-nudge deletion target.
```

## No production Cloudflare semantic scheduler

```bash
rg "ensureRunnerProgress|readProgressSnapshot|runLocalEnsureLoop|scheduleAfterRuntimeWake|scheduleShortProgressRecheck|parkIfRunnerRetryCapReached|clearRetryStateForFreshMailboxDemand" apps/cloudflare/src
```

Expected:

```txt
No production references, except deleted-file test snapshots if intentionally retained.
```

## No web direct Cloudflare nudge

```bash
rg "nudgeHostedRunner|nudgeUserRunner|runnerNudge|assistant-nudge" apps/web/src apps/web/app packages/cloudflare-hosted-control/src packages/hosted-orchestrator-temporal/src packages/hosted-execution/src/orchestration-control.ts packages/hosted-execution/src/parsers/orchestration-control.ts
```

Expected:

```txt
No production web path directly nudges Cloudflare.
```

## Activity timeout and retry classification

```bash
rg "readRuntimeDemandStartToCloseTimeoutMs|ensureCloudflareExecutionStartToCloseTimeoutMs|HOSTED_EXECUTION_RUNNER_TIMEOUT_MS|HOSTED_TEMPORAL_ENSURE_EXECUTION_TIMEOUT_MARGIN_MS|HOSTED_RUNTIME_DEMAND_TIMEOUT_MS|ApplicationFailure|nonRetryable" packages/hosted-orchestrator-temporal apps/web/src/lib/hosted-orchestration
```

Expected:

```txt
Temporal Activity start-to-close timeouts are workflow options derived from env
or safe defaults, and fresh usage-decision block states are classified with
non-retryable ApplicationFailure instead of ordinary retryable errors.
```

## Temporal payload safety

```bash
rg "payload|body|headers|transcript|prompt|vault|raw" packages/hosted-orchestrator-temporal apps/web/src/lib/hosted-orchestration
```

Expected:

```txt
Only safe parser/test references.
No raw provider/mailbox/prompt data in Temporal signals or workflow state.
```

## Temporal contract shape

```bash
rg "runtimeResultWakeAt|ignoredWorkspaceWakeKey|requiresAiUsageDecision|recommendedRecheckAt|HostedRuntimeDemandWorkspaceProjection" packages/hosted-execution packages/hosted-orchestrator-temporal apps/web apps/cloudflare
```

Expected:

```txt
The search finds the new contract fields in live implementation surfaces.
```

## Cloudflare alarms

```bash
rg "setAlarm|deleteAlarm|alarm\\(" apps/cloudflare/src
```

Expected:

```txt
Only watchdog alarm for active write fence.
No semantic nextWakeAt scheduling.
```

# 17. Test matrix

Minimum test commands:

```bash
pnpm typecheck
pnpm test:packages
pnpm test:apps
pnpm verify:acceptance
```

Targeted tests to add:

```txt
packages/hosted-execution:
  - orchestration signal parsers
  - demand parser
  - ensure-execution request/response parser

packages/hosted-orchestrator-temporal:
  - workflow signal coalescing
  - idle nextWakeAt sleep
  - signal interrupts sleep
  - run demand calls Cloudflare activity
  - runtime_wake_sent recommendedRecheckAt/re-read loop
  - runtime_completed carries runtimeResultWakeAt
  - signal-version guard prevents awaited-demand/execution signal loss
  - ignoredWorkspaceWakeKey suppresses stale workspace wake loops
  - blocked demand waits retryAt/signal
  - continue-as-new carry-forward state

apps/web:
  - demand priority
  - mailbox lag outranks everything
  - due runtimeResultWakeAt produces run/retry/runtime_result_wake demand
  - due workspace nextWakeAt produces run demand
  - future workspace nextWakeAt produces idle demand
  - ignoredWorkspaceWakeKey suppresses stale workspace wake demand
  - browser-vault refresh flag produces run demand
  - device-sync recovery flag produces run demand
  - webhook append signals Temporal
  - device-sync wake signals Temporal
  - lag sweeper signals Temporal, does not nudge Cloudflare

apps/cloudflare:
  - ensure-execution route auth/parsing
  - no active fence starts runtime
  - active fence accepted wake returns runtime_wake_sent with recommendedRecheckAt
  - active fence not wakeable replaces
  - failure clears fence and throws
  - execution-only clear methods do not write wake_at/backoff_until
  - alarm only clears expired fence
  - no nextAlarmAt/caught-up behavior
```

# 18. Acceptance criteria for the whole migration

The migration is complete only when all of these are true:

```txt
1. Web mailbox append paths signal Temporal, not Vercel Workflow.
2. Web lag sweeper signals Temporal, not Cloudflare.
3. Web browser/manual/device recovery paths signal Temporal.
4. Temporal per-user workflow reads web demand and owns sleeps/retries.
5. Cloudflare has ensure-execution route.
6. Cloudflare does not compute mailbox/assistant/browser/device demand.
7. Cloudflare alarm is write-fence watchdog only.
8. Murph runtime code is not modified to know about Temporal.
9. Temporal workflow does not import assistant-runtime.
10. Temporal workflow does not store raw payloads.
11. Completion is determined by re-reading web/runtime status.
12. Existing runtime nextWakeAt remains the only source for assistant timers.
13. Runtime-result nextWakeAt is preserved through runtimeResultWakeAt /
    runtimeResultNextWakeAt.
14. Demand returns requiresAiUsageDecision and no signed usage decision enters
    workflow history.
15. Temporal workflow stores only slim projections/debug fields, not full
    workspace or runtime invocation objects.
16. Workflow flag clearing is version-gated around awaited demand/execution.
17. Active-wake rechecks use recommendedRecheckAt or env-derived delay.
18. ignoredWorkspaceWakeKey prevents stale workspace wake hot loops.
19. Old Vercel Workflow nudge files are deleted.
20. Old Cloudflare nudge-as-scheduler route is deleted or non-production.
21. The Temporal E2E gap is explicitly tracked until a local harness proves
    mailbox append → Temporal → Cloudflare container → runtime checkpoint →
    Temporal idle.
```

# 19. The minimal implementation philosophy for subagents

Every time a subagent has a choice, choose the simpler ownership-preserving option.

## Prefer

```txt
- one per-user workflow
- pointer-only signals
- web demand endpoint
- Cloudflare ensure-execution endpoint
- slim demand/result projections
- runtimeResultWakeAt before workspace wake
- requiresAiUsageDecision with Activity-local fresh signed decision fetch
- runtime computes nextWakeAt
- Temporal loops and re-reads demand
- version-gated flag clearing around awaited Activities
- sleep() timers and recommendedRecheckAt for active runtime wakes
- ignoredWorkspaceWakeKey for stale workspace wake suppression
- watchdog-only Cloudflare alarm
```

## Reject

```txt
- per-message Temporal workflows
- Temporal queues per mailbox lane
- Temporal storing mailbox high-water state
- Temporal storing full workspace/runtime result objects
- Temporal storing signed usage decisions
- Temporal parsing automations
- Temporal knowing device provider semantics
- one-second active-wake polling
- Cloudflare keeping wake_at as assistant wake truth
- Cloudflare retry caps/backoff as orchestration
- execution paths reusing clear methods that write wake_at/backoff_until
- Vercel Workflow fallback
- direct web-to-Cloudflare nudge fallback
- “accepted wake means done”
```

# 20. Final subagent coordination message

Give this to every subagent at the top of their prompt:

```txt
You are working on the Murph hard-cut Temporal orchestration migration.

The target architecture is:
- Murph runtime owns business logic and Codex.
- Web owns hosted product facts, webhook verification, mailbox append, device-sync dirty state, usage/product policy, and runtime status.
- Temporal owns only orchestration: per-user workflow, pointer-only signals, durable sleeps, retries, and execution wakeups.
- Cloudflare owns only container execution: Durable Object routing, active runtime write fence, container invoke/wake, runtime callback authorization, and cleanup.

Do not duplicate runtime business logic in Temporal.
Do not let Cloudflare derive durable demand.
Do not store raw payloads in Temporal.
Do not store full workspace state, full runtime invocation results, redacted runtime status, or signed usage decisions in Temporal history.
Preserve runtime-result nextWakeAt as runtimeResultWakeAt/runtimeResultNextWakeAt.
Demand returns requiresAiUsageDecision; ensure-execution Activity fetches any signed usage decision fresh inside the Activity.
Version-gate flag clearing around awaited demand/execution calls.
Use sleep() for timer-only waits and recommendedRecheckAt/env-derived active-wake delays, not a one-second recheck loop.
Use ignoredWorkspaceWakeKey to avoid stale workspace wake hot loops.
Do not keep Vercel Workflow or Cloudflare nudge fallback paths.
This is a greenfield hard cut to the minimal long-term architecture.
```

The key strategic move is to cut at the right seam: **Temporal signals and sleeps; Cloudflare runs; runtime decides.**

[1]: https://docs.temporal.io/develop/typescript/message-passing "Workflow message passing - TypeScript SDK | Temporal Platform Documentation"
[2]: https://docs.temporal.io/develop/typescript/timers "Timers - TypeScript SDK | Temporal Platform Documentation"
[3]: https://docs.temporal.io/develop/typescript/continue-as-new "Continue-As-New - Typescript SDK | Temporal Platform Documentation"
Status: completed
Updated: 2026-05-20
Completed: 2026-05-20
