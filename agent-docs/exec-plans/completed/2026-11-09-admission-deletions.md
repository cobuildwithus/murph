# Cold admission: delete duplicate hops and dead telemetry, itemise steps

Status: completed
Created: 2026-11-09
Updated: 2026-11-09

## Goal

A cold direct ensure spends about 800 ms (p50) in seven serial control-plane
calls. This change only deletes work that is provably redundant or dead and
adds the minimum timing needed to see where the rest goes. It does not touch
`select_target`, the claim/select/bind/readiness/start order, `accepted`, any
timeout or poll constant, or merge `bindStandbySlot` with readiness.

## Deletions

- Duplicate retirement on a retained target. `resolveRetainedStandbySlot`
  returns a non-bound binding only after asserting, under the slot lifecycle
  lock, that this exact slot is `retired`, and `retired` is terminal. The Worker
  then sent `retire`, retired and read the slot again, and sent `release`. It
  now sends the existing exact-target `target_retired` command instead: two
  Durable Object calls and one owner round trip fewer, and `retireRuntime` is
  unchanged. The old "pinned when not confirmed" test modelled an impossible
  state and now covers the retiring-phase `retirement_pending` path.
- Worker-side `prepare_launch` fallback. Every slot has advertised
  `preparesSupervisedLaunch` since #3532, so the Worker always sends launch
  facts. The slot always submits `prepare_launch` and no longer has the
  `authorize_effect` alternative. The slot keeps returning the constant
  capability for one release so an older Worker in the rollback window still
  sends launch facts.
- Dead orchestration leaves with no producer: `standbyAllocation*`,
  `freshStartContainer*`, `userRunner*` (latency trace), `runnerState*`,
  `shellPrewarm*` and `foregroundInputSelectedAtEpochMs`, plus the
  `foreground_input_selected` milestone, `coldStartTiming` and the runner
  `/health` `serverListeningAtEpochMs` that fed it. `/health` keeps
  `processStartedAtEpochMs`: `scripts/container-latency-boot.mjs` measures
  hydration from it in the required runner bundle budget check. The cold-start report keeps only its
  Temporal recovery cohort section. A production aggregate over recent traces
  found no row carrying any deleted key; the sanitizers already drop unknown
  stored leaves, so stored rows still read.

## Additions

- One step timer in the existing `step` wrapper sums elapsed time per step
  into fixed orchestration leaves, including steps that throw:
  `runtimeOwnerClaimElapsedMs`, `runnerTargetReconcileElapsedMs`,
  `runnerTargetRetireElapsedMs`, `standbyClaimElapsedMs`,
  `runnerTargetSelectElapsedMs`, `runnerTargetBindElapsedMs`,
  `containerReadinessElapsedMs` and `invocationStartElapsedMs`.
- `runnerTargetPathKind`: `retained_warm`, `retained_retired`, `standby` or
  `fallback`, first decision wins.
- Transport: the direct handler sets the existing orchestration latency
  response header; Web's control client sanitizes it and the wake wrapper
  spreads it under Web's own direct-ensure leaves. No request, log line or
  awaited reporting work is added.

## Rejected

- Retry reason in the trace. The protocol keeps retry reasons out of the
  trace, and `runner.processing_finished` already records
  `runtimeProcessingRetryReason`.

## Skew

No deploy order. Old Web ignores the header; an old Worker sends none. The
slot keeps `preparesSupervisedLaunch` for older Workers; the new Worker always
sends launch facts. An old Worker already treats `serverListeningAtEpochMs` as
optional.

## Known gaps

Temporal-triggered ensures are not itemised. With two direct attempts only the
last attempt's step timings are kept. Other producer-less leaves outside this
scope remain (`runtimeInvocationOrchestrationAttemptId`, `activeFence*`,
`replacementFence*`, `freshStartInvocation*` and others).
