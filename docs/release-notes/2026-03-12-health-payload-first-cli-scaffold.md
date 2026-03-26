# 2026-03-12 Health Payload-First CLI Scaffold

## Summary

Prepared the downstream release-note scaffold for the health CLI cutover. This note is scaffold-only until the command contract and query or CLI lanes land.

## What changed

- Captured the planned payload-first operator surface for health nouns:
  - noun commands are expected to center on `scaffold`, `upsert --input`, `show`, and `list`
  - special cases remain explicit for `intake import`, `intake project`, `profile current rebuild`, and `protocol stop`
- Recorded the intended boundary behavior for the cutover:
  - structured command payloads remain the machine-facing source of truth
  - Markdown rendering remains a presentation mode rather than an alternate contract
  - CLI handlers continue to delegate writes to `@healthybob/core` and reads to `@healthybob/query`
- Marked the downstream seams that still need source-lane output before this can be promoted from scaffold-only status:
  - final command grammar per noun
  - response-envelope examples
  - fixture and smoke coverage for the new health commands

## Verification

- Docs-only reconciliation against the active health cutover plan and the current baseline command-surface contract.

## Follow-up

- Replace this scaffold with concrete command examples after the contract lane updates `docs/contracts/03-command-surface.md`.
- Add verification output after the CLI and query lanes land fixtures and smoke scenarios for the health noun surface.
