# Idle-stop thread compaction

Status: completed

## 2026-06-12 Usage Attribution Addendum

Follow-up investigation against the pinned Codex 0.135 source found a
limitation in manual remote v2 compaction usage telemetry:
`compact_remote_v2` consumes the compact response without surfacing
`ResponseEvent::Completed.token_usage`, and the later
`thread/tokenUsage/updated` notification is only a recomputed post-compact
context-size update with zero request input/output buckets. Murph now prefers a
real provider-usage notification if Codex adds one, and otherwise records the
pre-compact thread context tokens as an explicit lower-bound input/total
estimate for `automation_idle_compact` so compact spend is not invisible.

adversarial codebase reviews (runner lifecycle; codex/engine semantics). All
design-level claims verified against code; resolved decisions and the remaining
implementation-time verifications are recorded below.

Depends on: PR #125 (auto-compact ceiling 233k → 128k) merging first — the
threshold arithmetic below assumes the 128k ceiling.

## Goal

Compact oversized hosted Codex threads when a runner idle-stops, so members stop
paying the full-thread resend tax all day and never wait on a mid-conversation
compaction stall. Strictly off the reply hot path.

Success criteria:

- A thread whose context exceeds the idle-compact threshold when the runner
  idle-stops is compacted before the workspace snapshot, so the next wake
  resumes a ~40k-token (phase-1 floor) thread instead of a 100k+ one.
- The assistant reply path is never blocked or delayed by idle compaction: a
  wake that arrives mid-compact interrupts/abandons compaction and the member's
  turn proceeds on the uncompacted thread.
- Compaction is opportunistic and fail-open: any error or timeout skips it and
  the normal idle shutdown (checkpoint + snapshot) proceeds unchanged.
- The compact call's token usage is recorded through the existing
  `hosted_ai_usage` pipeline with its own trigger kind so cost is attributable.

## Why (evidence, 2026-06-10/11)

- Hosted thread cost scales linearly with thread size: every tool round-trip
  re-sends the thread; OpenAI Standard-tier prompt caches evict within ~45 min
  regardless of size or `prompt_cache_retention` (six controlled experiments,
  support ticket filed), so post-idle turns re-pay the whole thread uncached.
- Measured on 971 real local Codex compactions (May–June rollouts): median 83%
  reduction, but a high floor — post-compaction context median ~38k tokens,
  p90 ~53k, because compaction retains user messages up to a 64k-token budget
  (`codex-rs/core/src/compact_remote_v2.rs`, mirrors the server default).
- Therefore: compacting below ~70k is waste (lands near the floor it already
  occupies). Threshold must sit well above the floor.

## Decisions (operator-approved)

- Auto-compact ceiling stays 128k (`DEFAULT_HOSTED_CODEX_AUTO_COMPACT_TOKEN_LIMIT`,
  PR #125) — the in-day safety net.
- Idle-compact threshold: 100_000 tokens of last-known thread context.
- Compact timeout at idle: bounded (initial proposal 120s) then fail-open.
- No nightly cron, no timezone logic: idle-stop already coincides with the
  longest natural gaps (overnight) and runs while the container is warm, so no
  extra wake cost and compaction lands on conversation boundaries.
- Phase 2 (separate plan, prompt-primary): move per-turn injected dynamic
  context from the user message to a developer message so compaction drops it
  (current Codex drops `developer` role at compaction), collapsing the floor
  from ~40k to ~5–10k. Out of scope here.

## Proposed mechanism (to be validated against code)

1. During runner idle shutdown — after the runtime has gone quiet but while the
   Codex app-server process is still alive and the runtime write fence is still
   held — check the last observed thread token usage (`thread/tokenUsage/updated`
   total or `modelContextWindow`-relative) for the active session thread.
2. If above threshold: issue `thread/compact/start` (app-server RPC, exists in
   the pinned Codex version) and await the `thread/compacted` notification with
   a bounded timeout.
3. On success: proceed with the normal checkpoint + workspace snapshot (the
   compacted `replacement_history` is in the rollout file, so the snapshot and
   any future resume see the compacted thread).
4. On timeout / RPC error / fence loss / wake signal: abandon compaction
   (interrupt if needed) and proceed with normal shutdown unchanged.
5. Record the compact call's usage via the existing usage-record path with a
   dedicated trigger kind (e.g. `automation_idle_compact`) so `hosted_ai_usage`
   attributes the spend.

## Review findings — resolved design (2026-06-11)

Verified against code by two adversarial review passes; file:line evidence in
the review transcripts. These supersede the open questions below where they
overlap.

- INSERTION POINT (decided): top of the idle checkpoint snapshot path in
  `packages/assistant-runtime/src/hosted-runtime/snapshot-bridge.ts`
  (`createHostedWorkspaceBridgeCheckpointSnapshot`), gated on the checkpoint
  reason `"idle_shutdown"` (`hosted-runtime.ts:1998`). This keeps the change
  out of `apps/cloudflare/src/runner-container.ts` (active ledger lane) and
  runs while (a) the lease/write fence is freshly validated and held — the
  bridge re-validates it at three later stages — and (b) the Codex app-server
  is still warm.
- SIGTERM EXCLUSION (verified mechanism): the shutdown signal forces the dirty
  window to return immediately and checkpoints with a distinct path
  (`hosted-runtime.ts:1890-1894`; container SIGTERM grace 300s per
  `container-entrypoint.ts:280`); gating on the idle reason excludes deploy
  evacuation by construction.
- WAKE RACE (verified, mostly free): a wake during checkpoint bumps the lease
  generation; the old container's bundle write / web checkpoint then fails
  `stale_lease_generation` and aborts cleanly (`checkpoint-bridge.ts:176-199`,
  `snapshot-bridge.ts` lease re-validation; `consumePendingRuntimeWake`
  interruption already exists). Implementation must additionally discard a
  late `thread/compacted` notification for an abandoned compact; codex offers
  no cancellation token, so abandon = stop awaiting + ignore. The rollout
  write of an abandoned compact is harmless: the next attempt resumes from the
  snapshot taken by whichever attempt holds the valid lease.
- RPC AVAILABILITY (verified): `thread/compact/start` exists in the runner's
  pinned Codex (`Dockerfile.cloudflare-hosted-runner-base:3` pins 0.135.0;
  RPC present at tag rust-v0.135.0) and compaction is queued unconditionally —
  the 100k threshold is enforced entirely on the Murph side.
- EGRESS (verified): `POST /v1/responses/compact` is already allowlisted and
  fence-validated in `runner-egress-intercept.ts:105-106`.
- THREAD TOKEN SIZE (decided): retain the last `thread/tokenUsage/updated`
  totals from the final turn in runtime session state at turn end (small
  addition; engine already parses these in `providers/helpers.ts`); the value
  is end-of-last-turn fresh, which is exact at idle since nothing mutates the
  thread between turns.
- USAGE RECORDING (decided; the one genuinely new seam): there is no existing
  path to record non-turn usage. Use a synthetic turn id
  (`turn_idle_compact_*` via `createAssistantTurnId`) with trigger kind
  `automation_idle_compact` through the existing `usageRecorder` — modeled on
  the notification-turn pattern. The usage gate is consulted at wake decision,
  not per provider call, so an at-limit member's idle compact is not blocked;
  acceptable (compaction reduces future spend) and visible via the trigger
  kind.
- FINGERPRINTS (verified): `assistantContractFingerprint` / route fingerprint
  derive from developer instructions, dynamic tools, and route — none change
  under compaction (`codex-contract-fingerprint.ts:5-17`), and resume replays
  the rollout's `replacement_history`, so native resume sees the compacted
  thread.

## Primitives (implementation decomposition, 2026-06-11)

The feature lands as four small primitives, each at an existing ownership seam
with its own tests, plus one wiring step. Each primitive is justified by this
feature alone; none introduces a registry, plugin system, or config surface.

- P1 `compactWarmCodexThread` (assistant-engine, `assistant-codex.ts`):
  sibling export to the existing non-turn lifecycle functions
  (`stopWarmCodexAppServer:1099`). Under the warm-slot lock: no-op result when
  no reusable warm process or a turn is in flight; otherwise send
  `thread/compact/start` over the existing RPC transport and await the
  compacted notification with a bounded timeout, returning the compact call's
  token usage (parsed with the existing tokenUsage event readers).
  Abandonment contract: accepts an AbortSignal; on abort it kills the codex
  child directly (same-module access, bypasses the busy guard). Killing
  mid-compact is safe because rollouts only contain completed lines — an
  aborted compact leaves the thread uncompacted and the next turn spawns a
  fresh process and native-resumes (~1–2s, rare race). This avoids inventing
  any cancellation protocol and guarantees a wake can never be blocked by an
  in-flight compact.
- P2 non-turn usage record builder (hosted-execution, `assistant-usage.ts`):
  `buildAssistantMaintenanceUsageRecord({memberId, sessionId, usage,
  triggerKind})` producing a normal `AssistantUsageRecord` with a synthetic
  turn id. The runtime posts it through the platform's existing
  `usageRecordPort` (`workspace-assistant-phase.ts:360-368`) — no engine
  executionContext needed at idle, no new transport.
- P3 thread vitals in session state: persist the final turn's
  `thread/tokenUsage/updated` totals (`{inputTokens, cachedInputTokens,
  totalTokens, modelContextWindow}`) into the session runtime state at turn
  finalize. Same source the turn profiles already parse; gives the idle path
  (and any future thread-health decision) the thread size with zero RPCs.
- P4 idle-maintenance step (assistant-runtime): one named function called at
  the insertion point in `snapshot-bridge.ts`, gated on
  `reason === "idle_shutdown"`: read P3 vitals → threshold check → P1 with a
  wake-backed AbortSignal → P2 record → structured runtime-log events
  (started/finished/skipped+reason). Plain function, not a step registry;
  future maintenance work becomes additional statements here only when it
  actually exists.

Wake-ordering note: the runtime's pending-wake check runs before any turn
reserves the warm slot, and P1's abort path force-stops the process, so the
turn path can never observe a busy slot from compaction.

## Implementation-time verifications (carry into the task)

- Confirm `persist-from-provider-turn` resume-state persistence happens before
  the idle checkpoint and that nothing in murph session state caches a
  pre-compaction thread view that the next turn trusts over the rollout
  (reviewer flagged as low-probability residual risk).
- Validate the post-compaction floor (~40k measured on coding threads) for
  murph-shaped threads via the gated `RUN_HOSTED_CODEX_AUTOCOMPACTION_E2E`
  lane before relying on the 100k threshold arithmetic; adjust threshold if
  the murph floor differs materially.
- Confirm checkpoint wall-time tolerance: compaction adds tens of seconds
  before snapshot; idle TTL path has no deadline pressure, but verify activity
  renewal does not lapse mid-compact.

## Residual coordination notes

- REPEAT GUARD: post-compact floor (~40k) sits below the 100k threshold, so an
  idle-compacted thread cannot re-trigger until it regrows past 100k.
- LEDGER OVERLAP: keep the implementation inside `packages/assistant-runtime`
  (insertion point above); `apps/cloudflare/src/runner-container.ts` stays
  untouched while the Codex "Hosted runner destroy timeout triage" lane is
  active.

## Verification plan (implementation phase)

- Unit: idle-path decision (threshold, fail-open on timeout/error, SIGTERM
  exclusion) with a scripted app-server fake.
- Live gated e2e: extend the existing `RUN_HOSTED_CODEX_AUTOCOMPACTION_E2E`
  lane (12k limit override) to cover the idle-stop trigger and post-resume
  thread shape; measure floor for murph-shaped threads.
- Hosted-local e2e: idle-stop with oversized thread compacts and next wake
  resumes compacted; wake-during-compact aborts cleanly.
- Prod observability: runtime-log event codes for compact started/finished/
  skipped(reason); usage rows with the new trigger kind; turn profiles
  (PR #124) show post-compact context drop.

## Out of scope

- Phase 2 developer-message restructure (separate prompt-primary plan).
- Nightly cron sweeps, member-facing settings, Scale tier.
Updated: 2026-06-11
Completed: 2026-06-11
