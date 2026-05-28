# Provider Usage Token Aliases

## Goal

Harden Codex assistant provider usage extraction so OpenAI-style token aliases are captured without relying on upstream normalization.

Success criteria:

- Codex usage extraction reads prompt/completion aliases, nested token detail aliases, and existing Murph-style token fields.
- Tests cover real-ish final Codex completion events for the supported shapes.
- Existing provider usage behavior remains unchanged for sparse and normalized records.

## Constraints

- Keep the change local to assistant provider usage extraction and tests.
- Do not add persisted state or change hosted usage storage schemas.
- Preserve unrelated dirty working-tree edits.

## Plan

1. Inspect current Codex usage extraction and tests.
2. Add minimal alias support for flat and nested usage token fields.
3. Add focused real-ish final event tests for each shape.
4. Run focused tests, typecheck, diff-aware verification, and required completion review.
5. Commit scoped changes.

## Verification

- Pending.

## Handoff Notes

- Pending.

Status: active
Updated: 2026-05-04
