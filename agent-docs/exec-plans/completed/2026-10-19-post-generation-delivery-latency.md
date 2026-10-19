# Post-generation delivery latency telemetry and alert

Status: completed
Created: 2026-10-19
Updated: 2026-10-18

## Goal

- Measure and alert on the interval from final-response completion to
  provider acceptance of the final reply. Keep timing origins honest, typing
  unchanged, and every delivery, dedupe, authority, and ordering guard intact.

## Scope

- Producer (generic engine): the Codex adapter records only the Murph-local
  receipt instant of the last turn-scoped `rawResponse/completed` for the
  selected result. It reports `observed`, `unavailable`, or `superseded`; the
  payload is never retained. The `reply-dispatched` timing row adds the exact
  provider-result epoch anchor plus a monotonic completion interval.
- Attribution (runtime, Linq): one queued `linq-dispatch-entered` row per
  provider-dispatch boundary. It holds nested, non-additive monotonic pre-send
  durations and the batch-shared member-channel barrier duration. A card's text
  fallback adds a second row, which the alert reports as ambiguous.
- Alert (Web): accepted Linq deliveries linked to a Linq ingress trace. Unlinked
  deliveries are counted only. Telegram is out of scope because it has no exact
  provider-acceptance boundary.
- Contract owner: `agent-docs/references/hosted-runtime-protocol.md`, beside
  the reply-latency monitor.

## Metrics (kept separate)

- Provider result: Linq acceptance minus the exact provider-result instant.
- Final response completion: Linq acceptance minus the observed completion
  receipt. It never falls back to the provider-result origin.

## Alert

- Strict initial engineering budgets: direct or unknown > 5000 ms; group
  > 9000 ms, which includes the intentional four-second draft hold.
- One immutable alert per delivery carries both named measurements and the
  trigger-origin set. Pending, missing, beyond-retention, ambiguous, unlinked,
  already-alerted, invalid-chronology, and producer-absent outcomes are
  counted, never alerted. Truncated or unavailable scans fail closed.

## Simplification

- No deletion is proven safe. Next-wake bookkeeping before the foreground
  phase is small in pass-level evidence, so ordering is kept. The new
  attribution targets the barrier and the pre-send authority calls.

## Verification

- Engine: deterministic completion tracker (latest instant, foreign turn,
  superseded until a newer completion, retained earlier answer); Codex event
  ordering (fresh, no raw completion, tool continuation, compaction, steering,
  failed and interrupted turns); anchor and interval validity.
- Runtime: allowlist, dispatch-entry rows, primary plus fallback boundary rows,
  and log-port failure isolation.
- Web: strict boundaries for each origin, all states, scan failures, timing
  horizon, actual inserts, cron, email, retention, and opt-in PostgreSQL proof.
- Complexity diff guard passes against the branch base.

## Remaining

- Reconcile the Codex 0.163 upgrade before merge if it lands first.
- Exact-head CI (PostgreSQL 17), review, and coordinated release: Web reader
  before the runner producer.
Completed: 2026-10-18
