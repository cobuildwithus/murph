# 2026-03-12 Health JSONL Markdown Planning Note

## Summary

Recorded March planning assumptions for a future health storage extension. This note does not describe shipped behavior yet.

## What changed

- Recorded the intended hybrid storage model instead of replacing it:
  - Markdown remains the curated current-state layer for memory, the bank registries, and the derived personal wiki.
  - JSONL remains the append-only machine-history layer for assessments, timed events, samples, and audit.
- Captured the intended health seams from that planning pass:
  - `bank/memory.md`, `derived/knowledge/**`, and `bank/preferences.json` stay split by purpose instead of being collapsed into one catch-all current-state document.
  - timed health history extends `ledger/events` rather than creating a parallel history ledger.
  - intake provenance stays split between immutable `raw/assessments` inputs and append-only assessment ledgers.
- Marked the downstream dependencies that still have to land before this note can be replaced by current examples:
  - frozen vault-layout paths
  - health schema names, versions, and generated artifacts
  - operator-visible examples and fixture-backed outcomes

## Verification

- Docs-only reconciliation against the March health planning notes and the current frozen contract invariants.

## Follow-up

- Replace this planning note with concrete storage paths and examples after the contract lane updates `docs/contracts/01-vault-layout.md` and `docs/contracts/02-record-schemas.md`.
- Add runtime verification results after the source lanes land fixtures, smoke scenarios, and package-level checks for the health extension.
