# Codex Subagent Usage Metering

Status: active
Updated: 2026-08-22

## Goal

Record authoritative per-request token usage and effective execution metadata
for Codex child-agent turns without forking Codex CLI or double-counting the
existing cumulative fallback.

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
- Evidence: the parameterized runtime regression settles both terminal paths
  without advancing the five-second metadata timeout; the real scripted-runtime
  child records one exact draft with effective metadata and no duplicate or raw
  payload event.
- Difference from plan: the preliminary Product UX review found that the first
  candidate awaited accounting enrichment after root completion. The terminal
  drain was removed, preserving best-effort enrichment without delaying reply
  handoff or failure recovery.
- Result: Ready.

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

- Focused subagent usage tests pass (14 tests).
- Full assistant Codex runtime tests pass (274 tests), including timeout-only
  cleanup of unresolved metadata request bookkeeping.
- Full real Codex scripted-runtime tests pass (99 tests).
- Focused public CLI Codex lifecycle tests pass (9 tests).
- Assistant-engine typecheck passes.
- The prior corrected head passed all 19 required CI checks; exact-head
  ReviewGPT and CI remain pending for the final cleanup candidate.
