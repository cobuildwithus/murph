# Hosted Temporal Orchestration ADR

Last verified: 2026-05-27

## Decision

Murph hosted orchestration is a greenfield hard cut to Temporal as the only
durable orchestration layer for hosted runtime wakeups.

The final ownership split is:

- Murph runtime owns assistant, Codex, device-sync runtime work, outbox,
  provider cleanup, mailbox import semantics, checkpoint timing, and all
  business logic.
- `apps/web` owns hosted product facts, webhook verification, mailbox append,
  device-sync dirty state, usage and product policy, hosted workspace metadata,
  mailbox lag, and runtime status.
- Temporal owns only orchestration: one per-user workflow for user-runtime
  wakeups, one short-lived global device-sync recovery reconciler workflow
  started by a Temporal Schedule, pointer-only signals, durable sleeps,
  execution retries, and wakeup attempts.
- `apps/cloudflare` owns only container execution: Durable Object routing,
  active runtime write fence, container invoke or wake, runtime callback
  authorization, R2/snapshot transport plumbing, and cleanup.

Temporal decides when to ask Murph to run. Cloudflare starts or wakes the
container. The restored Murph runtime decides what the work means and what wake
should happen next. Temporal must keep only slim orchestration projections in
workflow history: demand/result summaries, pointer fields, wake times, and debug
metadata. Full workspace snapshots, full runtime invocation results, signed
usage decisions, prompts, payloads, transcripts, and provider responses never
belong in Temporal history.

This ADR is the target architecture for the hard cut. Existing Vercel Workflow
nudge paths and Cloudflare semantic scheduling paths are deletion targets, not
fallbacks, compatibility modes, or coexisting long-term surfaces.

The completed implementation plan for this migration is
`agent-docs/exec-plans/completed/TEMPORAL.md`. Use that snapshot for batch
sequencing and subagent execution details; use this ADR for durable architecture
ownership, state, and deletion guardrails.

## Final Architecture

```text
Provider/webhook/browser events
        |
        v
apps/web
  - verifies ingress and product policy
  - appends encrypted mailbox rows
  - records device-sync dirty state
  - exposes durable runtime demand/status
        |
        | pointer-only signal-with-start
        v
Temporal per-user workflow
  - coalesces pointer flags
  - reads web-owned demand/status
  - sleeps until web-owned runtime or workspace demand is due
  - retries execution adapter calls
        |
        | ensure-processing request
        v
apps/cloudflare Durable Object
  - validates control request
  - acquires or validates active write fence
  - starts, wakes, or accepts pending runtime processing
  - returns after processing is accepted
  - authorizes runtime callbacks
        |
        v
packages/assistant-runtime in container
  - restores workspace
  - imports mailbox pointers and dirty state
  - stages AssistantInputEvent records
  - runs Codex and local runtime work
  - checkpoints idle_shutdown with nextWakeAt
        |
        v
apps/web durable status
  - workspace checkpoint metadata
  - redacted runtime status
  - mailboxLag
```

Execution acceptance is not completion. A Cloudflare accepted-processing
response means the per-user Durable Object owns the active write-fenced run until
the owner recheck time arrives, the fence is cleared/replaced/deleted, or a new
signal interrupts the wait. While that owner exists, durable mailbox lag is recovery
truth, not a reason for Temporal to poll and re-wake the same hot runner in a
short loop. Completion is observed only after ownership ends or the owner
recheck returns the workflow to the demand loop and web-owned demand/status
shows no mailbox lag, no due web-owned runtime/workspace wake projection, and no
workflow-local wake flag that still requires an execution attempt.

Web/runtime status is durable truth when no runner owns execution. Cloudflare's
write fence is the active ownership truth while a run is in flight.

## Ownership Table

| Owner | Owns | Must not own |
| --- | --- | --- |
| `apps/web` | Webhook verification, provider minimization, mailbox append and dedupe, device-sync dirty state, hosted member/billing/usage/product policy, hosted workspace metadata, mailbox lag, redacted runtime logs/status, demand endpoint. | Codex invocation, assistant automation semantics, outbox truth, internal runtime timers, container routing, Temporal workflow state. |
| Temporal | Per-user workflow identity, pointer-only signals, coalesced wake flags, durable timers from web-owned demand projections, retry policy for web demand reads and Cloudflare processing adapter calls, continue-as-new history bounds, and global device-sync recovery cadence/retry through a short-lived reconciler workflow. | Raw payloads, decrypted mailbox contents, provider headers, prompts, transcripts, vault data, full workspace state, full runtime invocation results, signed usage decisions, assistant automation logic, device provider semantics, usage policy decisions, Cloudflare state, provider tokens, dirty resource bodies, or canonical dirty/reconcile facts. |
| `apps/cloudflare` | Durable Object routing, write-fence generation and validation, container invoke/wake, runtime callback authorization, direct R2/snapshot transport, execution cleanup, alarm cleanup for active write fences. | Durable demand derivation, mailbox backlog decisions, assistant wake calculation, browser-vault scheduling policy, device-sync dirty semantics, retry caps as orchestration, queue history, product facts. |
| Murph runtime | Mailbox import watermarks, `AssistantInputEvent` staging, active-turn admission, Codex invocation, assistant automation and timers, device-sync runtime execution, outbox/provider cleanup, idle/scheduled-wake checkpointing, `nextWakeAt` and `nextWakeReason` projection. | Temporal workflow state, web product policy, hosted member/billing facts, Durable Object routing, Cloudflare execution lease ownership. |

## Temporal State

Allowed Temporal state is tiny and pointer-only:

- Bound workflow user or workspace pointer.
- Signal counters and booleans.
- Latest opaque mailbox pointer fields, such as mailbox item pointer, lane, lane
  sequence, and coarse source label.
- Explicit wake flags for manual run, browser-vault refresh, device-sync
  recovery, or lag recovery. Current web producers represent manual,
  browser-vault refresh, and device-sync recovery requests as durable
  system-mailbox control rows and use Temporal signals only as wake hints.
- Global device-sync recovery Schedule id, interval, Workflow start options, and
  count-only due-reconcile sweep results. The reconciler may remember that a
  sweep ran and how many due-reconcile rows/wakes it touched; it must not
  remember provider tokens, dirty resource bodies, external account state, or
  canonical dirty/reconcile facts.
- Orchestration attempt identifiers generated by Temporal.
- Last demand kind/source, last execution result kind, bounded error code, and
  timestamps.
- Slim workspace wake projection fields: `nextWakeAt`, `nextWakeReason`, and
  `version`.
- Durable timers derived from web-owned runtime/workspace wake projection or
  retry timestamps.

Forbidden Temporal state:

- Raw webhook payloads, raw email messages, raw Stripe request bodies, or raw
  provider data.
- Provider verification headers, provider secrets, raw authorization headers, or
  decrypted mailbox payloads.
- Prompts, transcripts, Codex logs, tool stdout/stderr, or provider request and
  response bodies.
- Vault contents, workspace snapshot bodies, local filesystem paths, or
  checkpoint archives.
- Full `HostedWorkspaceState`, full `HostedWorkspaceInvocationResult`,
  `redactedStatus`, signed usage decisions, or usage ledger rows.
- Assistant automation rules, outbox selection state, provider cleanup queues,
  device provider dirty details, usage ledger rows, billing facts, or product
  policy decisions.
- Arrays of pending mailbox signals or per-message workflow queues.

Temporal may remember that demand exists. It must not become the place where
Murph decides what demand means.

Manual, browser-vault refresh, and due-reconcile device-sync recovery demand is
durable web-owned demand. Manual and browser-vault refresh append system-mailbox
control rows before signaling Temporal with the resulting mailbox pointer.
Due-reconcile recovery is selected by the signed recovery sweep after the owning
marker is durable, without appending foreground mailbox work. Dirty webhook
freshness is separate: web persists dirty state and may send a best-effort
clean-to-dirty `device_sync_recovery_requested` signal, but dirty rows are not
selected by a global recovery sweep. Historical `runtime.mailbox-lag-observed`
rows remain valid runtime-control rows for drain compatibility, but web no
longer produces them from a Vercel lag-recovery cron. The legacy kind-only
signals remain deploy-skew wake hints only; they carry no event id, source
label, device reason, or dedupe key. Future command surfaces that need
accepted/duplicate/rejected response semantics should use a durable web command
ledger or Temporal Updates instead of expanding wake signals.

Workflow implementations must version-gate flag clearing around awaited demand
and execution calls. If a signal arrives while an Activity is running, the loop
must keep the existing flags and re-read demand instead of clearing state derived
from a stale read. Workflow timers that should be preempted by fresh signals,
including owner-recheck waits after accepted processing, must use a
signal-aware `condition()` timeout instead of a bare timer sleep.

The workflow type constant must match the exported workflow function name
exactly. Temporal TypeScript workflow type names are function names, so renaming
the exported function requires changing the shared constant and tests together.
The Temporal worker must use an ESM-compatible explicit `workflowsPath`, such as
`createRequire(import.meta.url).resolve(...)`, or a prebuilt workflow bundle.
Production Temporal Cloud clients must use the configured frontend address,
namespace, API-key auth when configured, and TLS settings. The web signal client
and worker connection code must support the same API key, TLS enablement,
client certificate/key, server root CA, and server-name override settings so
`signalWithStart` and worker polling use the same trust model.

Mailbox signal `source` is a bounded safe string, not a provider enum. Parsers
should enforce a non-empty trimmed value with a small max length and safe
characters.

## Global Device-Sync Recovery Reconciler

The device-sync recovery cadence belongs to Temporal, not Vercel cron and not
per-user workflow timers. The target is a Temporal Schedule that starts
`hostedDeviceSyncReconcilerWorkflow` at a fixed interval. That Workflow calls
one Activity, `runHostedDeviceSyncRecoverySweep`, and then exits, keeping its
history bounded.

The Activity signs a callback to
`/api/internal/device-sync/recovery-sweep` using the hosted internal callback
key and the fixed callback identity `hosted-device-sync-reconciler`. The
request body is empty JSON. The response is count-only. Temporal history may
contain counts, timestamps, workflow ids, retry metadata, and schedule ids only.

`apps/web` remains the only owner of canonical device-sync recovery facts. The
signed sweep command reads `DeviceConnection.nextReconcileAt`, requests per-user
background recovery through the existing `device_sync_recovery_requested` signal
path, records due-reconcile `DeviceSyncSignal` facts, and never represents
device-sync recovery as foreground mailbox work. Dirty rows are intentionally
excluded from this command; webhook clean-to-dirty nudges and runtime
dirty-pending callbacks are the dirty path. Temporal retries are safe because
the web command is retryable and duplicate effective work is bounded by
due-reconcile signals, Temporal signal coalescing, and recovery buckets.

The Vercel device-sync dirty-sweeper cron is not registered, and there is no
Temporal dirty-row sweep replacement. Temporal is the single production owner of
due-reconcile recovery cadence, while the signed web sweep command remains
available for authenticated operator recovery.

Do not fold global due-reconcile discovery into `hostedUserRuntimeWorkflow` or
`readRuntimeDemand`, and do not reintroduce global dirty-row discovery there.
Per-user workflows remain user-runtime execution loops: they react after
mailbox/signal nudges and read per-user demand, but they do not scan global
device-sync tables or keep users alive just to poll for due reconciles.

## Workflow Replay And Versioning

`packages/hosted-orchestrator-temporal/src/workflows/hosted-user-runtime.ts`
is a long-lived per-user Temporal Workflow. Any change that adds, removes, or
reorders awaited command-producing Temporal APIs requires an explicit replay
compatibility plan before deployment. This includes Activity proxy calls,
durable timers or `condition()` timeouts, `continueAsNew`, child Workflow
commands if introduced later, and branch changes that alter whether an existing
history reaches those commands in the same order.

Command-ordering changes must use at least one of these disciplines:

- Worker Versioning or another deployment pinning strategy that keeps existing
  Workflow histories on compatible worker code until they drain.
- TypeScript Workflow patching with `patched()` / `deprecatePatch()` around the
  changed command sequence, with a documented removal condition.
- A Temporal replay test against captured histories that cover pre-change
  executions through the affected paths.

Pure state-machine tests, Activity mocks, and local signal/timer unit tests are
useful but not sufficient replay proof for old histories. Captured replay
fixtures must be redacted or synthetic: do not commit raw mailbox payloads,
prompts, transcripts, provider responses, secrets, local paths, or direct user
identifiers just to prove replay.

## Final Minimal Contract

Demand requests include workflow-local wake flags only.

Demand responses include only slim state:

- `HostedRuntimeDemandWorkspaceProjection` with `nextWakeAt`,
  `nextWakeReason`, and `version`
- `run`, `idle`, or `blocked` state with mailbox lag, demand source/reason, and
  workspace projection only

Demand priority is conversation mailbox lag, first pending system-mailbox
control demand, other system mailbox lag, explicit wake flags, due
web-owned workspace wake projection, then idle until the earliest future
wake. Web gates `mailbox_backlog` only when the conversation lane has lag;
system-only mailbox lag still outranks explicit demand but does not consume the
foreground AI usage gate.

Usage and product policy blocks are successful demand reads with
`kind: "blocked"`, never Temporal activity failures. Transport, auth, parser,
and availability failures remain activity exceptions and keep the normal
Temporal retry/error semantics.

The normal execution command response is either `runtime_processing_accepted`
or `retry_later`. Accepted responses include an `action` of `started`,
`replaced`, `woken`, or `already_running`, plus `runtimeAttemptId` and
`recommendedRecheckAt`. `retry_later` means Cloudflare could not confirm a
start or wake and includes only `retryAt`; Cloudflare-local causes stay in
Cloudflare metadata logs. These responses are
command acknowledgement only. They do not report runtime completion, status,
mailbox lag, or next assistant wake facts.

Temporal treats `recommendedRecheckAt` on accepted processing as an ownership
recheck horizon, not as a short durable-lag polling interval. Newer signals may
interrupt that wait and cause one wake/ensure command for the active runner.
Without a new signal, the workflow waits until the owner recheck before
returning to durable demand recovery; if the original workspace wake remains due
because the accepted runner failed before checkpointing, demand may select it
again. Runtime wake and retry facts that matter to product behavior must be
reflected in durable web/runtime state, not returned as the command result.

Device-sync recovery is the bounded exception to preserving explicit recovery
wake hints: after several accepted `woken`/`already_running` acknowledgements
for the same runtime attempt, the per-user workflow clears the coalesced
recovery flag and lets the normal owner recheck read durable demand
again. This keeps a runtime that never produces the expected recovery progress
from becoming a low-grade explicit-flag wake loop while leaving web-owned
mailbox lag and due-reconcile sweeps as durable future nudges. Clean-to-dirty
signals remain best-effort event-time nudges only, not scheduled recovery
input.

## Cloudflare Execution Adapter Contract

Temporal calls a single Cloudflare processing adapter:

```text
POST /internal/users/:userId/runtime/ensure-processing
```

Temporal signs this request with the hosted internal callback key and includes
the bound hosted user header in the signature input. Cloudflare accepts only
that signed form for the runtime processing adapter; Vercel OIDC remains for
browser-vault, status, and deletion control clients. Do not introduce a static
shared bearer token for this adapter.

Request summary:

- `reason`: the runtime invocation reason selected by web demand.
- `orchestrationAttemptId`: an opaque Temporal attempt id for observability and
  idempotency at the orchestration boundary.

The request does not carry signed AI usage decisions. Web demand gates the
sources that strongly imply foreground model work before Temporal calls
Cloudflare, and the runtime/provider layer enforces spend before actual model
calls. There is no Activity-local signed usage-decision endpoint in the
Temporal execution path.

Response summary:

- `runtime_processing_accepted`: Cloudflare accepted responsibility for making
  the runtime process now or soon. `action` explains whether the command started
  a new attempt, replaced a non-wakeable startup fence, woke a ready child, or
  recorded that the current attempt is already running/startup-pending. For fresh starts,
  Cloudflare has already read the workspace, bound the workspace version to the
  write fence, built runtime config/secrets, constructed the job, and confirmed
  container readiness before returning this response.
- `retry_later`: Cloudflare could not confirm the start/wake command. Temporal
  keeps ownership of the decision loop and waits signal-interruptibly until
  `retryAt`.

The adapter must not return `caught-up`, `mailboxLag`, `nextAlarmAt`, or runtime
completion status. Those belong to web demand/status plus the Temporal loop.
Accepted responses set `recommendedRecheckAt` from the active write-fence owner
recheck timing, bounded by the expected idle checkpoint horizon, rather than from
a five-second startup poll.
Transport failures and invalid protocol responses are still Activity
exceptions. After the Activity retry policy is exhausted, the per-user workflow
records compact failure metadata, waits on a signal-aware retry timer, and keeps
running. Business blocked states such as usage denial are demand responses from
web.

Cloudflare may:

- Bind the Durable Object to the user.
- Acquire, validate, bind, and clear write fences.
- Read the hosted workspace only to invoke the runtime with the correct
  checkpoint version.
- Invoke the container or send a wake to the active child.
- Clear/sync Durable Object alarms for active write-fence coordination only.
- Cleanup/destroy execution resources on user deletion.

Cloudflare must not:

- Read mailbox lag to decide whether durable demand exists.
- Derive assistant due work from `workspace.nextWakeAt`.
- Treat browser-vault refresh, device-sync dirty state, or mailbox backlog as DO
  scheduler state.
- Maintain retry caps/backoff as orchestration.
- Schedule semantic `wake_at` alarms.
- Treat accepted processing, accepted wake, or completed invocation as workflow
  completion.
- Reuse write-fence clear helpers that implicitly write `wake_at` or
  `backoff_until` for execution-only paths. Execution-only clear methods must
  clear active fences and record bounded diagnostics without scheduling
  retry/wake state.

Activity timeouts must be config-derived. Demand reads use a short timeout.
`ensure-processing` uses a short command-acknowledgement budget because the
response is only `runtime_processing_accepted` or `retry_later`, not runtime
completion. The foreground Cloudflare pre-accept budget must fit under the
existing Temporal HTTP timeout:
`pre_accept_budget + response_margin <= HOSTED_RUNTIME_PROCESSING_TIMEOUT_MS`.
Cloudflare uses its existing web-control/readiness timeout values as per-step
caps inside that budget and never lets unsigned timeout metadata increase the
configured Cloudflare wait.

## Runtime Status And Completion

Temporal idles only after reading web demand/status.

The idle condition is:

- `mailboxLag` is zero across lanes.
- Workspace wake projection `nextWakeAt` is absent or in the future.
- Web demand has no explicit manual, browser-vault, device-sync recovery, or lag
  recovery flag requiring execution.
- Usage/product policy does not report a retryable blocked state.

The runtime remains the only owner of assistant timers. Temporal sleeps on the
earliest due workspace wake projection; it never calculates assistant wake
semantics itself.

## Deletion List

Delete or hard-disable these paths during the migration:

- Vercel Workflow nudge paths:
  - hosted webhook nudge workflows
  - workflow start helpers
  - workflow step wrappers
  - `use workflow` / `use step` nudge logic
  - direct web-to-Cloudflare nudge fallback wrappers
- Cloudflare semantic scheduling paths:
  - `ensureRunnerProgress` as a durable demand owner
  - progress snapshot demand reads
  - local ensure loops as schedulers
  - post-runtime status reconciliation that schedules follow-up work
  - retry-cap probes as orchestration
  - browser-vault refresh scheduling in Durable Object state
- Durable Object `wake_at` and backoff semantic usage:
  - assistant wake truth
  - mailbox retry truth
  - browser-vault refresh truth
  - device-sync recovery truth
  - failure-count/backoff gates that decide whether demand may run
- Nudge-as-completion assumptions:
  - accepted Vercel Workflow step means complete
  - Cloudflare nudge accepted means complete
  - active runtime wake accepted means complete
  - container invocation returned means complete
  - mailbox import watermark alone means assistant handling complete

Old tests and docs should be updated to assert the hard-cut behavior instead of
retaining these as compatibility paths.

## Acceptance Criteria

The hard-cut architecture is accepted when:

- Web mailbox append paths signal Temporal with pointer-only data.
- No Vercel or web-owned mailbox-lag cron remains; future mailbox signal
  reconciliation must be Temporal-owned or backed by an explicit pending-handoff
  ledger instead of nudging Cloudflare.
- Web browser/manual/device recovery paths signal Temporal.
- Temporal has one per-user workflow that reads web demand/status and owns
  sleeps/retries.
- Temporal has one global due-reconcile device-sync recovery Schedule that
  starts a short-lived reconciler workflow. There is no Vercel device-sync
  dirty-sweeper cron cadence and no Temporal dirty-row sweep replacement.
- Temporal stores only pointer fields, coalesced flags, counters, timestamps,
  and bounded metadata.
- Temporal imports no assistant-runtime, Prisma, Cloudflare Worker, or app code
  into workflow code.
- Cloudflare exposes an ensure-processing adapter and no longer computes
  mailbox, assistant, browser-vault, or device-sync demand.
- Cloudflare alarms are write-fence cleanup only.
- Murph runtime code does not know about Temporal.
- Runtime `nextWakeAt` remains the only source for assistant timer wakeups.
- Temporal stores no full `HostedWorkspaceState`, no full
  `HostedWorkspaceInvocationResult`, and no signed usage decision.
- Demand returns `blocked` for usage denial or gate unavailability. It does not
  return signed usage decisions or usage-gating metadata.
- Workflow flag clearing is version-gated across awaited demand/execution calls.
- Accepted-processing waits use Cloudflare's required owner-recheck
  `recommendedRecheckAt`, not a short durable-lag polling loop.
- Workflow setup uses an ESM-compatible explicit `workflowsPath`.
- Vercel Workflow nudge files and Cloudflare nudge fallback paths are deleted
  or hard-disabled for production.
- The root `hosted-temporal:guard` script remains wired into `pnpm typecheck`
  and `pnpm test:diff` so legacy Vercel nudge workflows, Cloudflare scheduler
  methods, and business payload fields in Temporal workflow history surfaces
  cannot re-enter production source silently.
- Focused tests prove that wake acceptance is not completion and that Temporal
  idles only after web/runtime demand is idle.
- The hosted-local E2E harness includes a non-manual Temporal orchestration
  scenario that starts managed local Temporal, signals through web, queries the
  workflow, and proves the worker reaches Cloudflare ensure-processing. Heavier
  continuity/stress cases remain opt-in.

## Related References

- `agent-docs/references/hosted-runtime-protocol.md` describes the current
  hosted mailbox/runtime protocol that the migration cuts over from.
- `agent-docs/exec-plans/completed/TEMPORAL.md` is the completed migration
  plan and execution snapshot for batch order and subagent prompts.
- `ARCHITECTURE.md` remains the top-level module map and points here for the
  Temporal hard-cut target.
