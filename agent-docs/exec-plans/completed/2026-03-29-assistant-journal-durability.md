# 2026-03-29 Assistant journal durability

## Goal

Harden the reported local assistant-state and hosted side-effect durability gaps without widening behavior or storage scope:

1. local assistant transcript and diagnostic JSONL reads tolerate a torn final line
2. strict-read local assistant JSON files (turn receipts, diagnostics snapshot, failover state, session/index/automation docs) salvage or default safely instead of failing wholesale on partial writes
3. hosted side-effect journal writes avoid leaving only one of the two lookup keys durable after a partial failure
4. best-effort recovery paths still leave observable drift evidence

## Constraints

- Keep assistant-state file-backed and non-canonical under `assistant-state/`.
- Preserve current schemas and existing operator-facing status/doctor behavior except where corruption should now degrade more safely.
- Keep the Cloudflare side-effect journal contract compatible with existing reads and key rotation.
- Do not invent a database or broader journal abstraction for this pass.
- Preserve overlapping in-flight assistant and hosted-runtime edits already present in the worktree.

## Planned shape

- Add shared assistant-state read helpers that can salvage a truncated final JSON or JSONL line while still rejecting malformed committed content.
- Route transcript, diagnostic-event, receipt, failover, session, index, and automation reads through those helpers.
- Record recovery/drift signals where existing UX currently swallows best-effort failures.
- Make the hosted side-effect journal persist one canonical encrypted payload plus alias pointers/read fallbacks so effect-id and fingerprint lookups stay symmetric across partial failures.
- Add focused regression tests for torn-line salvage, tolerant strict-read recovery, journal alias asymmetry recovery, and surfaced best-effort drift.

## Deliberate non-goals

- No canonical vault storage changes.
- No new background repair job.
- No broad refactor of unrelated hosted execution journaling.
- No redesign of assistant status/doctor output.

## Verification follow-up

- Run repo-required checks: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`.
- Capture direct scenario proof with focused assistant and Cloudflare durability tests exercising torn local files and asymmetric side-effect journal state.
Status: completed
Updated: 2026-03-29
Completed: 2026-03-29
