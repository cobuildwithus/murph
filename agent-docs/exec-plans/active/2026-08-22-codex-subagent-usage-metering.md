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
- Full assistant Codex runtime tests pass (269 tests).
- Assistant-engine typecheck passes.
- Pending exact-head ReviewGPT specialist/final gates and required CI.
