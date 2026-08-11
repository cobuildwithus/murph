# Hosted Temporal Orchestration ADR

Last verified: 2026-08-11

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
  wakeups, one short-lived global device-sync scheduled-wake reconciler workflow
  started by a Temporal Schedule, pointer-only signals, durable sleeps,
  execution retries, and wakeup attempts.
- `apps/cloudflare` owns only container execution: Durable Object routing,
  active runtime write fence, container invoke or wake, runtime callback
  authorization, R2/snapshot transport plumbing, and cleanup.

The public Murph repository owns the released orchestration contracts,
hosted-local harness, and architecture guardrails. The private
`cobuildwithus/murph-cloud` repository owns the production Temporal worker,
Render Blueprint, deploy workflow, operational runbook, and rollback through
previously deployed private versions. Public Murph contains no worker
implementation or second production deployment path.

Temporal decides when to ask Cloudflare to process based on web-owned
reconciliation facts and pointer-only signals. Cloudflare starts or wakes the
container. The restored Murph runtime decides what the work means and what wake
should happen next. Temporal must keep only slim orchestration projections in
workflow history: reconciliation/result summaries, pointer fields, wake times,
and debug metadata. Full workspace snapshots, full runtime invocation results,
signed usage decisions, prompts, payloads, transcripts, and provider responses
never belong in Temporal history.

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
  - exposes runtime reconciliation facts/status
        |
        | pointer-only signal-with-start
        v
Temporal per-user workflow
  - coalesces pointer flags
  - reads web-owned reconciliation facts/status
  - sleeps until mailbox lag, workspace wake, retry, or recheck is due
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
recheck returns the workflow to the reconciliation loop and web-owned
reconciliation facts/status show no mailbox lag, no due workspace wake
projection, and no workflow-local wake hint that still requires an execution
attempt.

Web/runtime status is durable truth when no runner owns execution. Cloudflare's
write fence is the active ownership truth while a run is in flight.

## Ownership Table

| Owner | Owns | Must not own |
| --- | --- | --- |
| `apps/web` | Webhook verification, provider minimization, mailbox append and dedupe, device-sync dirty state, hosted member/billing/usage/product policy, hosted workspace metadata, mailbox lag, redacted runtime logs/status, reconciliation-facts endpoint. | Codex invocation, assistant automation semantics, outbox truth, internal runtime timers, container routing, Temporal workflow state. |
| Temporal | Per-user workflow identity, pointer-only signals, coalesced wake hints, durable timers from web-owned reconciliation facts, retry policy for web facts reads and Cloudflare processing adapter calls, continue-as-new history bounds, and global device-sync scheduled-wake cadence/retry through a short-lived reconciler workflow. | Raw payloads, decrypted mailbox contents, provider headers, prompts, transcripts, vault data, full workspace state, full runtime invocation results, signed usage decisions, assistant automation logic, device provider semantics, usage policy decisions, Cloudflare state, provider tokens, dirty resource bodies, or canonical dirty/reconcile facts. |
| `apps/cloudflare` | Durable Object routing, write-fence generation and validation, container invoke/wake, runtime callback authorization, direct R2/snapshot transport, execution cleanup, alarm cleanup for active write fences. | Reconciliation-facts derivation, mailbox backlog decisions, assistant wake calculation, browser-vault scheduling policy, device-sync dirty semantics, retry caps as orchestration, queue history, product facts. |
| Murph runtime | Mailbox import watermarks, `AssistantInputEvent` staging, active-turn admission, Codex invocation, assistant automation and timers, device-sync runtime execution, outbox/provider cleanup, idle-floor/shutdown checkpointing plus invocation-local pre-floor assistant wake service, assistant `nextWakeAt`/`nextWakeReason` projection, and inbox media retention wake projection. | Temporal workflow state, web product policy, hosted member/billing facts, Durable Object routing, Cloudflare execution lease ownership. |

## Temporal State

Allowed Temporal state is tiny and pointer-only:

- Bound workflow user or workspace pointer.
- Signal counters and coalesced wake booleans.
- Latest opaque mailbox pointer fields: mailbox item pointer, lane, and lane
  sequence.
- Source-less mailbox and recheck wake hints. Manual runs, browser-vault
  refreshes, and device-sync requests are durable system-mailbox rows; their
  Temporal signals only wake the reconciliation loop. A payload-free
  `runtime_wake_requested` signal may additionally set one coalesced boolean
  that calls the existing Cloudflare processing adapter when facts are idle. It
  carries no provider value or credential, is discarded while facts are
  blocked, and is cleared after accepted processing only when no newer wake
  arrived. Authenticated provider changes and newly committed hosted-group
  projection grants are current Web producers of this payload-free signal.
- Global device-sync scheduled-wake Schedule id, interval, Workflow start options, and
  count-only due-reconcile sweep results. The reconciler may remember that a
  sweep ran and how many due-reconcile rows/wakes it touched; it must not
  remember provider tokens, dirty resource bodies, external account state, or
  canonical dirty/reconcile facts.
- Orchestration attempt identifiers generated by Temporal.
- Last reconciliation status, blocked reason/retry timestamp, processing result
  kind, bounded error code, and timestamps.
- Slim workspace wake projection fields: `nextWakeAt`, `nextWakeReason`,
  `inboxMediaRetentionWakeAt`, and `version`.
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

Temporal may remember that reconciliation facts indicate work. It must not
become the place where Murph decides what that work means.

Manual, browser-vault refresh, and due-reconcile device-sync work is durable
web-owned mailbox work. Manual and browser-vault refresh append system-mailbox
control rows before signaling Temporal with the resulting source-less mailbox
pointer. Due-reconcile work is selected by the signed scheduled-wake sweep after
the owning marker is durable, then represented as a bounded `device-sync.wake`
mailbox handoff keyed by connection and reconcile timestamp. Dirty webhook
freshness is separate: web persists dirty state and appends one deterministic
`device-sync.wake` handoff on clean-to-dirty transitions, but dirty rows are not
selected by a global scheduled sweep. Historical `runtime.mailbox-lag-observed`
and `runtime.device-sync-recovery-requested` rows remain valid runtime-control
rows for drain compatibility, but web no longer produces them.

Legacy direct demand signals and the old demand Activity were not replay
compatibility paths in the completed hard cut. Operators stopped the old
workers, terminated the incompatible `hosted-user-runtime:*` histories,
deployed the matching web, Temporal, and Cloudflare contract set, and reseeded
new histories with `runtime_recheck_requested` or mailbox signals. Do not repeat
that history reset for the repository relocation: the private worker was
relocated without changing Workflow code or identities.

Workflow implementations must version-gate future command-order changes around
awaited facts reads and execution calls unless the deployment is another
documented hard cut with a history reset. If a signal arrives while an Activity
is running, the loop must keep the existing wake hints and re-read facts instead
of clearing state derived from a stale read. Workflow timers that should be
preempted by fresh signals, including owner-recheck waits after accepted
processing, must use a signal-aware `condition()` timeout instead of a bare
timer sleep.

`runtime_wake_requested` adds a command path only after that new signal event;
older histories cannot contain it, and carry-forward state defaults its
coalesced bit to false. This preserves replay determinism without a history
reset. Roll out Cloudflare runtime support first, then the Temporal worker, and
deploy Web last so no producer can send the signal to an older workflow bundle.

The workflow type constant must match the exported workflow function name
exactly. Temporal TypeScript workflow type names are function names, so renaming
the exported function requires changing the shared constant and tests together.
The Temporal worker must use an ESM-compatible explicit `workflowsPath`, such as
`createRequire(import.meta.url).resolve(...)`, or a prebuilt workflow bundle.
The production prebuilt bundle is a guarded deploy artifact: its package build
must reject bundles above 2.25 MiB, bundles without inspectable inline
source-map evidence, and dependency graphs that contain the broad contracts or
vault-share source closures. Workflow-reachable shared constants belong in
dependency-light leaf modules so type-only domain imports remain erased.
Production workers explicitly reuse the V8 context and cache at most 100
Workflow executions; the cache ceiling must remain no lower than concurrent
Workflow task executions. This avoids deriving a much larger cache from the
container heap after an instance-size change.
Each production worker uses fixed execution slots for at most 100 concurrent
Activities and 20 concurrent Workflow Tasks, while both poller types use
Temporal's server-feedback autoscaling behavior. Render runs two Standard
instances on the same Task Queue, so loss of one process does not remove all
polling capacity and the aggregate execution ceilings are 200 Activities and
40 Workflow Tasks. Capacity changes must preserve fixed slot accounting and
should be evaluated with slot availability plus Activity and Workflow Task
schedule-to-start latency rather than process memory alone.
Those Activity ceilings also bound peak pressure across the existing
reconciliation path. Each signed hosted-Web callback replay admission performs
one direct `INSERT ... ON CONFLICT DO NOTHING`, not an application transaction;
the `nonce_hash` primary key is the replay linearization point. The same
statement uses the database clock to refuse admission if a delayed insert has
passed the callback's inclusive expiry boundary, while retaining that row as a
replay tombstone. Expiry
is handled by the existing bounded background retention owner rather than the
callback, while bounded per-user Prisma reads remain. When AI-gated work is present, the default Workflow path
also runs the mutating allowance transaction; denied
fresh conversation work can claim durable usage-notice delivery and send
through Linq or Telegram, while allowed pending work issues a signed
ensure-processing request to Cloudflare's per-user runtime owner. The worker
still has no direct database access. Durable notice claims retain notice
idempotency; higher Worker capacity changes concurrency and timing, not the
number of authorized notice epochs.

Automated coverage proves the configured ceilings, the bounded owner paths,
Linq and Telegram notice claim/retry behavior, and full-stack Temporal handoff
through provider-facing Linq and Cloudflare stubs; it does not claim a
provider-faithful 200-user production load test. Roll out a higher ceiling while
watching Activity retries and timeouts, hosted-Web database-pool failure
telemetry, unrelated signed callback health, usage-notice claim/delivery
failures and provider errors, and Cloudflare ensure-processing acceptance.
Reduce the execution env override or Render instance count if those downstream
signals regress.
Production Temporal Cloud clients must use the configured frontend address,
namespace, API-key auth when configured, and TLS settings. The web signal client
and worker connection code must support the same API key, TLS enablement,
client certificate/key, server root CA, and server-name override settings so
`signalWithStart` and worker polling use the same trust model.

Mailbox signals must stay source-less.

## Global Device-Sync Scheduled Wake Reconciler

The device-sync scheduled-wake cadence belongs to Temporal, not Vercel cron and not
per-user workflow timers. The target is a Temporal Schedule that starts
`hostedDeviceSyncReconcilerWorkflow` at a fixed interval. That Workflow calls
one Activity, `runHostedDeviceSyncRecoverySweep`, and then exits, keeping its
history bounded.

The Activity signs a callback to
`/api/internal/device-sync/recovery-sweep` using the hosted internal callback
key and the fixed callback identity `hosted-device-sync-reconciler`. The
request body is empty JSON. The response is count-only. Temporal history may
contain counts, timestamps, workflow ids, retry metadata, and schedule ids only.

`apps/web` remains the only owner of canonical device-sync facts. The
signed sweep command reads `DeviceConnection.nextReconcileAt`, records
due-reconcile `DeviceSyncSignal` facts, and appends bounded `device-sync.wake`
mailbox handoffs for due connections. Dirty/stuck rows may be included only
when they are due-reconcile candidates; webhook clean-to-dirty mailbox handoffs
and runtime dirty-pending callbacks remain the dirty path. Temporal retries are
safe because the web command is retryable and duplicate effective work is
bounded by due-reconcile signals, mailbox event-id dedupe, Temporal signal
coalescing, and wake buckets.

The Vercel device-sync dirty-sweeper cron is not registered, and there is no
Temporal dirty-row sweep replacement. Temporal is the single production owner of
the due-reconcile scheduled-wake cadence, while the signed web sweep command
remains available for authenticated operator recovery.

Do not fold global due-reconcile discovery into `hostedUserRuntimeWorkflow` or
the per-user reconciliation-facts Activity, and do not reintroduce global
dirty-row discovery there.
Per-user workflows remain user-runtime execution loops: they react after
mailbox/signal nudges and read per-user reconciliation facts, but they do not
scan global device-sync tables or keep users alive just to poll for due
reconciles.

## Workflow Replay And Versioning

Private `cobuildwithus/murph-cloud` owns the long-lived per-user Temporal
Workflow under its `packages/hosted-orchestrator-temporal` package. Any change
that adds, removes, or
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
- A Temporal replay test against captured or synthetic histories that cover
  pre-change executions through the affected paths.

Pure state-machine tests, Activity mocks, and local signal/timer unit tests are
useful but not sufficient replay proof for old histories. Captured replay
fixtures must be redacted or synthetic: do not commit raw mailbox payloads,
prompts, transcripts, provider responses, secrets, local paths, or direct user
identifiers just to prove replay.

The reconciliation-before-mailbox patch is in the `deprecatePatch()` phase in
Murph Cloud.
After production pre-patch histories drained, the old direct-mailbox branch and
synthetic pre-patch replay fixture were removed. The workflow must keep the
`deprecatePatch()` marker and patch id until a later removal phase confirms the
deprecatePatch-window histories have drained. Private replay and package
coverage gates require that marker to remain present.

## Final Minimal Contract

The per-user workflow reads source-less reconciliation facts from web:

- `blocked`: nullable product/access block with `reason` and `retryAt`
- `mailboxLag`: lane lag counters only
- `workspace`: nullable projection with `nextWakeAt`, `nextWakeReason`,
  `inboxMediaRetentionWakeAt`, and `version`

Facts do not contain run/idle decisions, producer source/reason, raw mailbox
payloads, workspace redacted status, signed usage decisions, or direct wake
flags. Temporal interprets the facts mechanically: fresh mailbox signals may
ensure processing directly; carried pointers and timers re-read facts;
conversation lag or a due assistant workspace wake selects default processing;
system-only lag selects `system_mailbox` processing; a due inbox media retention
wake selects `inbox_media_retention` processing when foreground/default work is
not runnable; future or absent wakes wait. These modes are invocation input, not
new scheduler state. Foreground/default work must replace an active
system-mailbox or retention owner instead of waiting for its idle checkpoint.

Usage and product policy blocks are successful reconciliation reads with a
non-null `blocked` object, never Temporal activity failures. Transport, auth,
parser, and availability failures remain activity exceptions and keep the normal
Temporal retry/error semantics.
If AI usage becomes denied after runner execution starts, the web mailbox plane
returns the exact `HOSTED_RUNTIME_MAILBOX_AI_USAGE_DENIED` code. The Cloudflare
mailbox adapter treats only that code, including when preserved through a
transport cause chain, as an empty unchanged mailbox prefix. Durable mailbox
lag therefore remains available for later reconciliation while the current
invocation releases cleanly; unrelated authorization, transport, and parser
failures keep their normal failure semantics.

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
returning to durable reconciliation; if the original workspace wake remains due
because the accepted runner failed before checkpointing, facts may trigger it
again. Runtime wake and retry facts that matter to product behavior must be
reflected in durable web/runtime state, not returned as the command result.

Legacy direct device-sync recovery signals, old demand Activity inputs, and old
demand results were physically removed in the completed hard cut. The
incompatible histories were terminated before the current workflow lineage was
deployed. Moving the identical current worker to Murph Cloud uses rolling
replacement on the existing Task Queue and must not terminate or reset current
histories.

## Cloudflare Execution Adapter Contract

Health-data consent remains Web-owned and never enters Temporal history as a
second state projection. Every Cloudflare `ensure-processing` operation first
uses the signed Web callback to read the current `launch.health-data` grant and
refuses a start or wake for explicit revocation. Web withdrawal separately
calls Vercel OIDC-authenticated
`POST /internal/users/:userId/runtime/health-data-consent`; the per-user Durable
Object serializes that command with ensures, re-reads current consent, clears
the write fence, and destroys the runner before returning a revoked result.
Renewal waits on the same command before committing its new grant and then
signals the existing per-user Temporal workflow. This is an execution barrier,
not a Temporal workflow termination path, durable consent mirror, queue, lease,
or reconciliation loop.

Temporal calls a single Cloudflare processing adapter:

```text
POST /internal/users/:userId/runtime/ensure-processing
```

Temporal signs this request with the hosted internal callback key and includes
the bound hosted user header in the signature input. Cloudflare accepts only
that signed form for the runtime processing adapter; Vercel OIDC remains for
browser-vault, status, and deletion control clients.
Do not introduce a static shared bearer token for this adapter.

Request summary:

- `orchestrationAttemptId`: an opaque Temporal attempt id for observability and
  idempotency at the orchestration boundary.

The request does not carry signed AI usage decisions. Web reconciliation facts
gate mailbox lag and workspace wakes that strongly imply foreground model work
before Temporal calls Cloudflare, and the runtime/provider layer enforces spend
before actual model calls. There is no Activity-local signed usage-decision
endpoint in the Temporal execution path.

Response summary:

- `runtime_processing_accepted`: Cloudflare accepted responsibility for making
  the runtime process now or soon. `action` explains whether the command started
  a new attempt, replaced an old runtime fence whose child could not be
  confirmed, woke a ready child, or recorded that the current attempt is already
  running/startup-pending. For fresh starts,
  Cloudflare has already read the workspace, bound the workspace version to the
  write fence, built runtime config/secrets, constructed the job, and confirmed
  container readiness before returning this response.
- `retry_later`: Cloudflare could not confirm the start/wake command. Temporal
  keeps ownership of the decision loop and waits signal-interruptibly until
  `retryAt`.

The adapter must not return `caught-up`, `mailboxLag`, `nextAlarmAt`, or runtime
completion status. Those belong to web reconciliation facts/status plus the
Temporal loop.
Accepted responses set `recommendedRecheckAt` from the active write-fence owner
recheck timing, bounded by the expected idle checkpoint horizon, rather than from
a five-second startup poll.
Transport failures and invalid protocol responses are still Activity
exceptions. After the Activity retry policy is exhausted, the per-user workflow
records compact failure metadata, waits on a signal-aware retry timer, and keeps
running. Business blocked states such as usage denial are reconciliation facts
from web.

Cloudflare may:

- Bind the Durable Object to the user.
- Acquire, validate, bind, and clear write fences.
- Read the hosted workspace only to invoke the runtime with the correct
  checkpoint version.
- Invoke the container or send a wake to the active child.
- Clear/sync Durable Object alarms for active write-fence coordination only.
- Cleanup/destroy execution resources on user deletion.

Cloudflare must not:

- Read mailbox lag to decide whether durable work exists.
- Derive assistant due work from `workspace.nextWakeAt`.
- Derive inbox media retention eligibility from stored workspace metadata.
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

Activity timeouts must be config-derived. Reconciliation-facts reads use a short
timeout.
`ensure-processing` uses a short command-acknowledgement budget because the
response is only `runtime_processing_accepted` or `retry_later`, not runtime
completion. The foreground Cloudflare pre-accept budget must fit under the
existing Temporal HTTP timeout:
`pre_accept_budget + response_margin <= HOSTED_RUNTIME_PROCESSING_TIMEOUT_MS`.
Cloudflare uses its existing web-control/readiness timeout values as per-step
caps inside that budget and never lets unsigned timeout metadata increase the
configured Cloudflare wait.

## Runtime Status And Completion

Temporal idles only after reading web reconciliation facts/status.

The idle condition is:

- `mailboxLag` is zero across lanes.
- Workspace wake projection `nextWakeAt` is absent or in the future.
- Workspace inbox media retention wake projection is absent or in the future.
- Usage/product policy does not report a retryable blocked state.

The runtime remains the only owner of assistant timers and inbox media
retention eligibility. Temporal sleeps on the earliest due workspace wake
projection and selects normal or retention-only processing from the due field;
it never calculates assistant or retention semantics itself.

## Deletion List

Delete or hard-disable these paths during the migration:

- Vercel Workflow nudge paths:
  - hosted webhook nudge workflows
  - workflow start helpers
  - workflow step wrappers
  - `use workflow` / `use step` nudge logic
  - direct web-to-Cloudflare nudge fallback wrappers
- Cloudflare semantic scheduling paths:
  - `ensureRunnerProgress` as a durable work owner
  - progress snapshot work reads
  - local ensure loops as schedulers
  - post-runtime status reconciliation that schedules follow-up work
  - retry-cap probes as orchestration
  - browser-vault refresh scheduling in Durable Object state
- Durable Object `wake_at` and backoff semantic usage:
  - assistant wake truth
  - mailbox retry truth
  - browser-vault refresh truth
  - device-sync scheduled-wake truth
  - failure-count/backoff gates that decide whether work may run
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
- Web browser/manual/device handoff paths signal Temporal.
- Temporal has one per-user workflow that reads web reconciliation facts/status and owns
  sleeps/retries.
- Temporal has one global due-reconcile device-sync scheduled wakes Schedule that
  starts a short-lived reconciler workflow whose web command appends bounded
  `device-sync.wake` handoffs and re-signals bounded, already-durable preference
  and queued Clinical Records mailbox candidates through one shared sweep. It
  selects at most one exact pending item per user ahead of its lane watermark.
  Clinical recovery does not create a second run, wake, receipt, or generation.
  There is no Vercel device-sync dirty-sweeper cron cadence and no
  Temporal dirty-row sweep replacement.
- Temporal stores only pointer fields, coalesced flags, counters, timestamps,
  and bounded metadata.
- Temporal imports no assistant-runtime, Prisma, Cloudflare Worker, or app code
  into workflow code.
- The production Workflow bundle stays within its byte budget, retains
  inspectable dependency evidence, and excludes broad contracts/vault-share
  source closures.
- The production Worker pins its reusable V8 context and Workflow cache ceiling
  instead of deriving cache capacity from the container heap.
- Cloudflare exposes an ensure-processing adapter and no longer computes
  mailbox, assistant, browser-vault, or device-sync work due.
- Cloudflare alarms are write-fence cleanup only.
- Murph runtime code does not know about Temporal.
- Runtime `nextWakeAt` remains the only source for assistant timer wakeups;
  runtime `inboxMediaRetentionWakeAt` remains the only source for inbox media
  retention wakeups.
- Temporal stores no full `HostedWorkspaceState`, no full
  `HostedWorkspaceInvocationResult`, and no signed usage decision.
- Reconciliation facts return `blocked` for usage denial or gate
  unavailability. They do not return signed usage decisions or usage-gating
  metadata.
- Workflow flag clearing is version-gated across awaited facts/execution calls.
- Accepted-processing waits use Cloudflare's required owner-recheck
  `recommendedRecheckAt`, not a short durable-lag polling loop.
- Workflow setup uses an ESM-compatible explicit `workflowsPath`.
- Vercel Workflow nudge files and Cloudflare nudge fallback paths are deleted
  or hard-disabled for production.
- The root `hosted-temporal:guard` script remains wired into `pnpm typecheck`
  and `pnpm test:diff` so legacy Vercel nudge workflows, Cloudflare scheduler
  methods, business payload fields in shared orchestration contracts, and a
  public Temporal worker implementation cannot re-enter production source
  silently. Murph Cloud independently owns Workflow bundle and replay-policy
  gates.
- Focused tests prove that wake acceptance is not completion and that Temporal
  idles only after reconciliation facts are idle.
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
