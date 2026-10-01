# Codex Subagent Usage Metering

Status: completed
Updated: 2026-08-22

## Goal

Record authoritative per-request token usage and effective execution metadata
for every authorized Codex child-agent provider request, including detached
MultiAgent V2 work that outlives its root reply, without forking Codex CLI or
double-counting the existing cumulative fallback.

## Constraints

- Keep assistant-engine as the sole hosted usage-ledger writer.
- Accept only the pinned Codex app-server protocol shapes and canonical parent
  evidence for child-thread authorization.
- Use exact `rawResponse/completed` usage when the child lifecycle supports it;
  use cumulative `thread/tokenUsage/updated` deltas only for cold or legacy
  lifecycles that cannot emit raw usage.
- Select one usage source for each child lifecycle and deduplicate exact raw
  responses by `responseId`.
- Persist token and execution metadata only; never persist child prompts,
  messages, thread identifiers, or reasoning content.
- Add no Codex fork, protocol schema copy, dependency, database change, or new
  billing owner.

## Product UX Patch

- Outcome: hosted members are charged exactly once for child work without
  delaying a completed reply for accounting enrichment.
- Reaches: hosted multi-agent turns that run one or more authorized Codex child
  threads, including the failure/recovery path.
- Proof: unresolved child metadata cannot delay successful or failed root
  settlement, and the real pinned Codex app-server emits one exact child usage
  draft without cumulative double billing or raw-payload persistence.

## Product UX Walkthrough

- People and path: a hosted member whose turn uses an authorized child and
  then completes or fails while optional child metadata is still unresolved.
- Evidence: the real pinned app-server proves direct and group roots return
  before their detached children, then records one exact draft during idle and
  carries each child result into a later turn. Mocked runtime proofs cover root
  failure, duplicate raw responses, checkpoint completion, metadata timeout,
  requested stop, and unexpected idle process loss.
- Difference from plan: preliminary review first removed a terminal metadata
  drain that delayed root settlement. A later review exposed the deeper
  lifetime mismatch: turn-local accounting still discarded valid V2 work that
  completed after settlement. The lifecycle owner was therefore moved to the
  resident process instead of adding another terminal wait.
- Result: Ready.

## Retrospective

The first implementation treated child usage as turn-local state. That model
was sufficient for synchronous children, but it repeated a parent/child
lifetime mismatch: a valid detached MultiAgent V2 child can continue after the
root reply, while the root turn's buffers are destroyed at settlement. Exact
usage arriving during process idle was therefore irretrievably discarded.

The corrected design deletes the turn-local lifecycle owner and reuses the
resident `CodexAppServerProcess`, which already owns detached-child execution
across root settlement, idle completion, later turns, workspace checkpoints,
and process shutdown. Canonical parent events still provide the only billing
authorization. The original root contributes its stable operation identity,
accepted-input authority, model context, and ordinal allocator. Hosted drafts
are handed to the existing `recordDetachedUsage` path, which preserves
assistant-engine as the sole usage-ledger writer. Non-hosted callers retain
the existing result-based draft buffer only while their root turn is active;
there is no second process-owned writer, draft queue, scheduler, retry loop, or
durable state.

Lifecycle semantics are explicit:

- Root success returns without waiting for child metadata or completion. A
  hosted detached authorization remains with the resident process until its
  child usage is finalized.
- Root failure preserves already parsed exact or cumulative evidence. Normal
  poison/stop cleanup forces metadata fallback before process teardown.
- During idle and later root turns, the resident process observes child events
  globally and records each exact provider response against the original root
  operation and ordinal namespace.
- A successful workspace checkpoint waits for detached children, forces any
  remaining metadata fallback, records or returns the resulting drafts, and
  then clears the bounded process evidence. Interrupted checkpoints preserve
  the same owner and authorization for a later attempt.
- Requested shutdown and unexpected process close flush all provider evidence
  that reached and was parsed from stdout before rejecting optional metadata
  requests. A process loss before usage evidence reaches stdout cannot be
  reconstructed and does not mint speculative usage.
- Duplicate raw responses are suppressed by `responseId`; exact raw usage and
  cumulative fallback remain mutually exclusive for each child turn.

Proof covers synchronous and detached children, direct and group roots,
child-before-parent authorization ordering, idle and later-turn completion,
root failure, duplicate raw responses, checkpoint completion/interruption,
metadata timeout cleanup, requested stop, and unexpected idle process loss.

## Plan

1. Reconstruct ReviewGPT's scoped design against current `origin/main` and
   inspect the pinned Codex protocol for exact request and notification shapes.
2. Enable raw response events on fresh thread starts and capture authorized
   child lifecycle usage plus effective metadata from metadata-only resumes.
3. Convert each child lifecycle through a deterministic raw-or-cumulative
   source selector and preserve existing ledger ordinals and pricing rules.
4. Add focused request-shape, parser, authorization, deduplication, source
   selection, cold-resume fallback, and privacy regressions.
5. Run focused tests and assistant-engine typecheck, inspect the candidate diff,
   then commit, push, open a PR, and run required exact-head review gates with
   CI.

## Verification

- Focused subagent usage tests pass (15 tests).
- Full assistant Codex runtime tests pass (276 tests), including root failure,
  idle process loss, checkpoint, duplicate-response, and timeout cleanup.
- Full real Codex scripted-runtime tests pass (99 tests).
- Focused public CLI Codex lifecycle tests pass (9 tests).
- Assistant-engine typecheck passes.
- The behavior-bearing head passed all required exact-head CI checks.
- ReviewGPT substantive round 3 returned `ROUND_OUTCOME: PASS` from a fresh
  full sensitive snapshot and confirmed the retrospective resolves every prior
  accepted finding without a second writer or lifecycle owner.
- The behavior-bearing head merges cleanly with the latest `origin/main`.
Completed: 2026-08-22
