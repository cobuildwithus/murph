# Hosted receipt scan and pre-provider timing

Status: active
Updated: 2026-08-09

## Goal

Reduce the measured hosted receipt-history tail without weakening proactive
message reply continuity, and partition the currently opaque automation-lane
work before assistant service entry.

Success means:

- exact native replies and already-cheap history cases remain lazy;
- the unanchored cross-session fallback still consumes each eligible proactive
  delivery at most once and never replays an older delivery;
- receipt inventory reads use bounded concurrency while parsing, quarantine,
  ordering, locking, and metrics remain deterministic;
- the provider-start trace carries adjacent metadata-only automation-lane
  subdivisions whose sum equals the canonical lane duration;
- no message content, route, identifier, path, prompt, transcript, or new
  synchronous telemetry request is introduced; and
- focused tests, owner typechecks, required audits, PR CI, and ReviewGPT pass.

## Evidence

- The production outlier spent 859 ms reading 232 receipt files totaling about
  469 KB; lock wait was only 4 ms. The measured cost is serial local file reads
  plus parsing and validation, not lock contention or remote object requests.
- The full receipt check is needed only when an unanchored inbound message has
  an eligible sent delivery from another assistant session. It prevents a
  consumed proactive message, or an older one, from resurfacing as context.
- Existing code already skips receipts for exact provider-native replies, no
  matching delivery, same-session-only history, and future-stamped history.
- The remaining inventory is read serially under the assistant runtime write
  lock even though the outbox owner already uses fixed concurrency four.
- Current monotonic telemetry jumps directly from automation-lane entry to
  assistant-service entry across readiness, input selection, state, candidate,
  operation-scope, evidence, session, history, prompt, and handoff work.

## Implementation

1. Refactor receipt inventory reads to read at most four files concurrently,
   then parse, quarantine, and fold each batch serially in directory order.
2. Preserve the existing full-history consumption truth and all cross-session
   selection semantics. Do not add a persisted index, source-intent consumed
   flag, session timestamp heuristic, cache, migration, or second state owner.
3. Add adjacent monotonic timing boundaries for readiness, input selection,
   pass setup, candidate scan, group/operation scope, terminal evidence,
   session preflight, cross-session context, prompt preparation, and service
   handoff. Drop the optional subdivision if any boundary is missing or
   unordered while retaining the canonical trace.
4. Attach only numeric nested diagnostics to the existing fire-and-forget
   `provider_started` phase breakdown and update its strict shared parser.
5. Add focused receipt concurrency/order/corruption/metrics tests plus timing
   adjacency, propagation, sum, and parser tests. Update the live hosted runtime
   protocol for the additive diagnostic contract.

## Invariants

- Current inbound replies remain foreground priority and cannot become silent.
- Provider message ids outrank unanchored time-based context selection.
- Only completed or deferred receipt evidence consumes cross-session context;
  failed or running turns do not.
- Assistant receipt/outbox/runtime mutations remain serialized under the
  existing runtime write lock.
- Corrupt receipt quarantine and runtime-event writes remain serialized.
- Observability stays content-free, best-effort, and off the reply path.
- Canonical provider-start additive fields do not change meaning; the new
  leaves are nested diagnostics only.

## Verification

- Run focused Assistant Engine receipt, automation, and provider critical-path
  tests.
- Run focused Assistant Runtime maintenance and workspace operation-scope
  tests.
- Run focused Hosted Execution latency contract/parser tests.
- Run typechecks for every touched owner and the narrow reverse dependents
  identified by the verification map.
- Inspect the final diff, run privacy/secret/path checks, complete the required
  preliminary specialist ReviewGPT pass and final ReviewGPT gate concurrently
  with exact-head CI, and resolve every accepted finding.

Current local evidence:

- the receipt inventory suite passes all six cases, including bounded read
  concurrency, deterministic ordering/filtering/metrics, disappearing files,
  and serialized corrupt-file quarantine;
- Assistant Engine, Assistant Runtime, and Hosted Execution typechecks pass;
- the Hosted Execution parser/emitter suite passes all 32 cases, including
  incomplete and non-additive subdivision rejection; and
- independent static reviews found no remaining receipt or timing blocker.

The receipt change is a measured constant-factor correction, not an O(1)
lookup. A first-use unconsumed candidate still requires a complete inventory
proof because receipt filenames do not encode source intent. Do not introduce a
recent-N cap; consider an existing-owner, crash-safe derived backpointer or a
bounded lifecycle only if post-rollout cohort data shows material residual cost.

## Deployment

Deploy the Web parser before the hosted Cloudflare runner bundle because the
older strict parser drops a phase breakdown containing unknown optional leaves.
Old and new runners are behavior-compatible; no tandem correctness cutover or
persisted workspace migration is required. After rollout, compare receipt scan
latency for 200+ file cohorts and inspect the new automation subdivision before
choosing any further deletion or state-layout change.
