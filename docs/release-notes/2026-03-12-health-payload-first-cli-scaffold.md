# 2026-03-12 Health Payload-First CLI Planning Note

## Summary

Recorded March planning assumptions for a future payload-first health CLI surface. This note does not describe shipped behavior yet.

## What changed

- Captured the planned payload-first operator surface for health nouns:
  - noun commands are expected to center on `scaffold`, `upsert --input`, `show`, and `list`
  - special cases remain explicit for `intake import`, `intake project`, and `protocol stop`
- Recorded the intended boundary behavior for that future CLI extension:
  - structured command payloads remain the machine-facing source of truth
  - Markdown rendering remains a presentation mode rather than an alternate contract
  - CLI handlers continue to delegate writes to `@murph/core` and reads to `@murph/query`
- Marked the downstream seams that still need source-lane output before this note can be replaced by concrete examples:
  - final command grammar per noun
  - response-envelope examples
  - fixture and smoke coverage for the new health commands

## Verification

- Docs-only reconciliation against the March health planning notes and the current command-surface contract.

## Follow-up

- Replace this planning note with concrete command examples after the contract lane updates `docs/contracts/03-command-surface.md`.
- Add verification output after the CLI and query lanes land fixtures and smoke scenarios for the health noun surface.
