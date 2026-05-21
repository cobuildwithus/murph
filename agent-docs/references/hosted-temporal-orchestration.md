# Hosted Temporal Orchestration ADR

Last verified: 2026-05-20

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
- Temporal owns only orchestration: one per-user workflow, pointer-only signals,
  durable sleeps, execution retries, and wakeup attempts.
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
  - sleeps until runtimeResultWakeAt or workspace nextWakeAt
  - retries execution adapter calls
        |
        | ensure-execution request
        v
apps/cloudflare Durable Object
  - validates control request
  - acquires or validates active write fence
  - invokes or wakes the container
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

Execution acceptance is not completion. A Cloudflare response, a container wake,
or a runtime attempt return means only that execution was attempted. Completion
is observed only when Temporal re-reads web-owned demand/status and sees no
mailbox lag, no due `runtimeResultWakeAt`, no due workspace wake projection, and
no workflow-local wake flag that still requires an execution attempt.

Web/runtime status is durable truth. Temporal must re-read it after every
execution attempt and before idling.

## Ownership Table

| Owner | Owns | Must not own |
| --- | --- | --- |
| `apps/web` | Webhook verification, provider minimization, mailbox append and dedupe, device-sync dirty state, hosted member/billing/usage/product policy, hosted workspace metadata, mailbox lag, redacted runtime logs/status, demand endpoint. | Codex invocation, assistant automation semantics, outbox truth, internal runtime timers, container routing, Temporal workflow state. |
| Temporal | Per-user workflow identity, pointer-only signals, coalesced wake flags, `runtimeResultWakeAt`, stale workspace wake key, durable timers from web/runtime wake projections, retry policy for web demand reads and Cloudflare execution adapter calls, continue-as-new history bounds. | Raw payloads, decrypted mailbox contents, provider headers, prompts, transcripts, vault data, full workspace state, full runtime invocation results, signed usage decisions, assistant automation logic, device provider semantics, usage policy decisions, Cloudflare state. |
| `apps/cloudflare` | Durable Object routing, write-fence generation and validation, container invoke/wake, runtime callback authorization, direct R2/snapshot transport, execution cleanup, watchdog cleanup for active write fences. | Durable demand derivation, mailbox backlog decisions, assistant wake calculation, browser-vault scheduling policy, device-sync dirty semantics, retry caps as orchestration, queue history, product facts. |
| Murph runtime | Mailbox import watermarks, `AssistantInputEvent` staging, active-turn admission, Codex invocation, assistant automation and timers, device-sync runtime execution, outbox/provider cleanup, idle/deadline checkpointing, `nextWakeAt` and `nextWakeReason` projection. | Temporal workflow state, web product policy, hosted member/billing facts, Durable Object routing, Cloudflare execution lease ownership. |

## Temporal State

Allowed Temporal state is tiny and pointer-only:

- Bound workflow user or workspace pointer.
- Signal counters and booleans.
- Latest opaque mailbox pointer fields, such as mailbox item pointer, lane, lane
  sequence, and coarse source label.
- Explicit wake flags for manual run, browser-vault refresh, device-sync
  recovery, or lag recovery.
- Orchestration attempt identifiers generated by Temporal.
- Last demand kind/source, last execution result kind, bounded error code, and
  timestamps.
- Slim workspace wake projection fields: `nextWakeAt`, `nextWakeReason`, and
  `version`.
- `runtimeResultWakeAt`, which carries scheduling metadata returned by runtime
  execution even when no workspace checkpoint should be forced.
- `ignoredWorkspaceWakeKey`, used to prevent hot loops on the same stale
  workspace wake projection.
- Durable timers derived from web/runtime `retryAt`, `runtimeResultWakeAt`, or
  workspace wake projection.

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
  `redactedStatus`, signed `aiUsageAllowDecision`, or usage ledger rows.
- Assistant automation rules, outbox selection state, provider cleanup queues,
  device provider dirty details, usage ledger rows, billing facts, or product
  policy decisions.
- Arrays of pending mailbox signals or per-message workflow queues.

Temporal may remember that demand exists. It must not become the place where
Murph decides what demand means.

Workflow implementations must version-gate flag clearing around awaited demand
and execution calls. If a signal arrives while an Activity is running, the loop
must keep the existing flags and re-read demand instead of clearing state derived
from a stale read. Workflow timers should use `sleep()` for timer-only waits and
`condition()` only when waiting for a signal predicate with a timeout.

The workflow type constant must match the exported workflow function name
exactly. Temporal TypeScript workflow type names are function names, so renaming
the exported function requires changing the shared constant and tests together.
The Temporal worker must use an ESM-compatible explicit `workflowsPath`, such as
`createRequire(import.meta.url).resolve(...)`, or a prebuilt workflow bundle.

Mailbox signal `source` is a bounded safe string, not a provider enum. Parsers
should enforce a non-empty trimmed value with a small max length and safe
characters.

## Final Minimal Contract

Demand requests include workflow-local wake flags plus:

- `runtimeResultWakeAt`
- `ignoredWorkspaceWakeKey`

Demand responses include only slim state:

- `HostedRuntimeDemandWorkspaceProjection` with `nextWakeAt`,
  `nextWakeReason`, and `version`
- `requiresAiUsageDecision` on run demand instead of a signed decision body
- `runtime_result_wake` as a demand source before `workspace_wake`

Demand priority is mailbox lag, manual run, browser-vault refresh, device-sync
recovery, lag recovery, due `runtimeResultWakeAt`, due workspace wake projection,
then idle until the earliest future runtime-result or workspace wake.

The demand endpoint owns stale workspace wake suppression. If the supplied
`ignoredWorkspaceWakeKey` matches the current workspace wake projection and no
mailbox lag or explicit signal requires work, demand should idle rather than
hot-loop. The key is cleared when the workspace version or wake projection
changes, mailbox lag appears, any explicit signal arrives, or runtime-result
wake metadata becomes due.

Execution responses are limited to:

- `runtime_completed` with `action: "started" | "replaced"`,
  `runtimeAttemptId`, `runtimeStatus`, and `runtimeResultNextWakeAt`
- `runtime_wake_sent` with `runtimeAttemptId` and `recommendedRecheckAt`

The workflow stores `runtimeResultWakeAt` from `runtimeResultNextWakeAt` and
waits on the earlier of that value and the web workspace wake projection.
Cloudflare should set `recommendedRecheckAt` from execution policy, such as the
idle checkpoint delay plus a small margin, so Temporal does not send repeated
one-second active-wake probes while the runtime is legitimately waiting for its
idle checkpoint window.

## Cloudflare Execution Adapter Contract

Temporal calls a single Cloudflare execution adapter:

```text
POST /internal/users/:userId/runtime/ensure-execution
```

Temporal signs this request with the hosted internal callback key and includes
the bound hosted user header in the signature input. Cloudflare accepts that
signed form for Temporal while retaining Vercel OIDC for existing web-owned
control clients during cutover. Do not introduce a static shared bearer token
for this adapter.

Request summary:

- `reason`: the runtime invocation reason selected by web demand.
- `orchestrationAttemptId`: an opaque Temporal attempt id for observability and
  idempotency at the orchestration boundary.
- Optional Activity-local signed usage decision. The workflow never receives or
  stores this decision. Web demand returns `requiresAiUsageDecision`; the
  `ensureCloudflareExecution` Activity fetches a fresh signed web usage decision
  inside the Activity when needed and passes it directly to Cloudflare.

Response summary:

- `runtime_completed`: Cloudflare acquired or replaced a write fence, invoked
  the container, and the runtime attempt returned. It includes only the runtime
  status enum and `runtimeResultNextWakeAt`, not the full invocation result.
- `runtime_wake_sent`: Cloudflare found an active write-fenced runtime and sent
  a payloadless wake to that exact active child. It includes
  `recommendedRecheckAt` so Temporal waits through the expected idle checkpoint
  window before re-reading demand.

The adapter must not return `caught-up`, `mailboxLag`, `nextAlarmAt`, or
completion status. Those belong to web demand/status plus the Temporal loop.
Transport failures are Activity exceptions, not workflow success unions. The
workflow sees thrown Activity failures and relies on Temporal retry policy.
Business blocked states such as usage denial are demand responses from web.

Cloudflare may:

- Bind the Durable Object to the user.
- Acquire, validate, bind, and clear write fences.
- Read the hosted workspace only to invoke the runtime with the correct
  checkpoint version.
- Invoke the container or send a wake to the active child.
- Keep a watchdog alarm only for the active write-fence expiry.
- Cleanup/destroy execution resources on user deletion.

Cloudflare must not:

- Read mailbox lag to decide whether durable demand exists.
- Derive assistant due work from `workspace.nextWakeAt`.
- Treat browser-vault refresh, device-sync dirty state, or mailbox backlog as DO
  scheduler state.
- Maintain retry caps/backoff as orchestration.
- Schedule semantic `wake_at` alarms.
- Treat accepted nudge, accepted wake, or completed invocation as workflow
  completion.
- Reuse write-fence clear helpers that implicitly write `wake_at` or
  `backoff_until` for execution-only paths. Batch 2B must add execution-only
  clear methods that clear active fences and record bounded diagnostics without
  scheduling retry/wake state.

Activity timeouts must be config-derived. Demand reads use a short timeout.
Ensure-execution uses the Cloudflare runner timeout plus a safety margin so
Temporal does not retry while a valid runtime invocation is still inside its
own timeout window.

## Runtime Status And Completion

Temporal idles only after reading web demand/status.

The idle condition is:

- `mailboxLag` is zero across lanes.
- `runtimeResultWakeAt` is absent or in the future.
- Workspace wake projection `nextWakeAt` is absent, in the future, or matches a
  currently ignored stale workspace wake key.
- Web demand has no explicit manual, browser-vault, device-sync recovery, or lag
  recovery flag requiring execution.
- Usage/product policy does not report a retryable blocked state.

The runtime remains the only owner of assistant timers. Temporal sleeps on the
earliest due runtime-result or workspace wake projection; it never calculates
assistant wake semantics itself.

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
- Web lag recovery signals Temporal instead of nudging Cloudflare.
- Web browser/manual/device recovery paths signal Temporal.
- Temporal has one per-user workflow that reads web demand/status and owns
  sleeps/retries.
- Temporal stores only pointer fields, coalesced flags, counters, timestamps,
  and bounded metadata.
- Temporal imports no assistant-runtime, Prisma, Cloudflare Worker, or app code
  into workflow code.
- Cloudflare exposes an ensure-execution adapter and no longer computes
  mailbox, assistant, browser-vault, or device-sync demand.
- Cloudflare alarms are write-fence watchdogs only.
- Murph runtime code does not know about Temporal.
- Runtime `nextWakeAt` remains the only source for assistant timer wakeups.
- Runtime-result `nextWakeAt` is preserved as `runtimeResultWakeAt` when it is
  scheduling metadata only and should not force a workspace checkpoint.
- Temporal stores no full `HostedWorkspaceState`, no full
  `HostedWorkspaceInvocationResult`, and no signed usage decision.
- Demand returns `requiresAiUsageDecision`; the execution Activity fetches any
  fresh signed decision Activity-locally.
- Workflow flag clearing is version-gated across awaited demand/execution calls.
- Active-wake rechecks use `recommendedRecheckAt` or an env-derived idle
  checkpoint delay, not a one-second loop.
- Stale workspace wakes are guarded by `ignoredWorkspaceWakeKey`.
- Workflow setup uses an ESM-compatible explicit `workflowsPath`.
- Vercel Workflow nudge files and Cloudflare nudge fallback paths are deleted
  or hard-disabled for production.
- Focused tests prove that wake acceptance is not completion and that Temporal
  idles only after web/runtime demand is idle.
- The remaining local E2E harness gap for mailbox append to Temporal to
  Cloudflare execution to runtime checkpoint to Temporal idle is tracked in
  `agent-docs/references/testing-ci-map.md`.

## Related References

- `agent-docs/references/hosted-runtime-protocol.md` describes the current
  hosted mailbox/runtime protocol that the migration cuts over from.
- `agent-docs/exec-plans/completed/TEMPORAL.md` is the completed migration
  plan and execution snapshot for batch order and subagent prompts.
- `ARCHITECTURE.md` remains the top-level module map and points here for the
  Temporal hard-cut target.
