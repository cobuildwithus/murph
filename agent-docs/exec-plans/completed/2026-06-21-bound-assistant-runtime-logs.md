# Bound assistant runtime logs

Status: completed

## Goal

Keep assistant runtime observability useful without letting append-only event
logs bloat local state or hosted workspace snapshots.

Success criteria:

- `.runtime/operations/assistant/journals/runtime-events.jsonl` is bounded to
  7 days, 2,000 events, or 1 MiB, whichever is smallest.
- `.runtime/operations/assistant/diagnostics/events.jsonl` is bounded to 7 days
  or 512 KiB.
- `.runtime/operations/assistant/diagnostics/snapshot.json` remains portable and
  keeps cumulative counters plus recent warnings.
- Hosted workspace snapshots exclude the two event logs while retaining status,
  budgets, diagnostics snapshot, and unresolved issue records.

## Constraints

- Default to deletion and simplicity: no rotation service, no retention metadata,
  no extra scheduler, and no new persisted state.
- Preserve existing redaction and best-effort diagnostic behavior.
- Do not weaken hosted snapshot restore invariants for portable runtime state.

## Implementation Notes

- Add a small event-log retention helper used by the existing runtime maintenance
  seam.
- Compact by bounded-tail-reading valid JSONL entries, applying age/count/byte
  limits, dropping oversized single events, then atomically rewriting the
  retained tail.
- Treat maintenance-time compaction as best-effort so logging never breaks the
  assistant path; record a budget note when compaction fails.
- Mirror diagnostic events into runtime events only for warnings/errors, not
  routine info events.
- Mark only the two event-log files as machine-local in assistant local-state
  descriptors; keep their parent directories portable for retained summary
  files and issue records.
- Exclude stale sibling event-log variants from hosted snapshots without
  introducing rotation/archive files.

## Verification Plan

- Focused assistant-engine tests for runtime event and diagnostic retention.
- Focused runtime-state hosted snapshot tests for event-log exclusion and
  retained portable summary/status/budget/issue state.
- `pnpm typecheck`.
- Required completion audits for persisted hosted runtime state/exposure and
  coverage.

## Out of Scope

- Compression, archive files, server-side rotation, and new operator settings.
- Changing the diagnostic snapshot schema beyond existing counters/warnings.
Updated: 2026-06-21
Completed: 2026-06-21
