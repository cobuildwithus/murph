# Hosted Attachment Progress Ack

## Goal

Make Murph acknowledge long-running hosted attachment work early, especially
PDF/lab-report parse and save flows, without relying only on optional model
behavior.

## Success Criteria

- Prompt guidance treats early attachment progress as a clear contract when the
  progress tool is available, not a soft optional preamble.
- Hosted assistant turns can emit one deterministic, safe progress update for
  attachment-heavy turns before the model starts a potentially long tool loop.
- Existing progress delivery limits, channel availability, and best-effort
  failure handling remain authoritative.
- Focused prompt/runtime tests prove the behavior.

## Constraints

- Do not add a new queue, table, scheduler, or persisted state.
- Keep progress updates generic and metadata-only: no file contents, local
  paths, private identifiers, medical conclusions, or diagnoses.
- Preserve the existing one-progress-update-per-turn limit and current-channel
  delivery semantics.
- Preserve unrelated dirty files and active ledger rows.

## Plan

1. Tighten the assistant progress prompt around PDFs, lab reports, and
   multi-step attachment parsing/imports.
2. Add a small runtime preflight progress send when a hosted provider turn has
   attachment evidence and model progress delivery is available.
3. Add focused regressions for prompt text and hosted attachment preflight
   delivery.
4. Run scoped package verification, required audits, and close the plan through
   the repo commit workflow if the overlapping dirty tree allows it.

## Verification

- Focused assistant-engine progress/prompt tests.
- `pnpm typecheck`.
- `git diff --check` and privacy-oriented diff scan.
Status: completed
Updated: 2026-06-02
Completed: 2026-06-02
