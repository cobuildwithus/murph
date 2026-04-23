# Measurement Primitive

## Goal

Replace the current split between closed-enum `body_measurement` writes and generic numeric `observation` fallback writes with one canonical measurement primitive that can store arbitrary numeric metrics while preserving only thin transitional compatibility where it materially reduces churn.

## Why this exists

- The current dedicated body-measurement flow rejects metrics such as grip strength because the write contract hard-codes a small enum.
- The current fallback path accepts arbitrary scalar facts only through raw event upserts, which is too low-affordance for the assistant and does not naturally surface in semantic read models.
- The repo is still greenfield enough that the canonical write contract should be simplified now rather than extended with more bespoke measurement enums or sibling event kinds.

## Scope

- Contracts for canonical event kinds and measurement payloads
- Core canonical event write/read handling for measurements
- CLI write surfaces and generated contract surface for `measurement add`
- Compatibility aliasing for `workout measurement add`
- Query/read-model updates so canonical measurements can participate in semantic summaries
- Focused tests and any directly coupled docs/index updates if durable docs change

## Non-goals

- Broad hosted/app/runtime work outside the measurement/event/query owners
- A full browser UI layer for measurements
- Large assistant-runtime refactors beyond directly coupled assistant-facing command surfaces

## Constraints

- Preserve unrelated dirty-tree edits.
- Keep canonical persistence under the existing event ledger seam.
- Avoid a write-time approval list for whether a metric slug may be saved.
- Keep metric semantics registry-driven or helper-driven, not enum-gated for writes.

## Planned shape

1. Add a canonical `measurement` event kind with:
   - open metric slug
   - numeric value
   - unit
   - optional qualifiers
   - optional attachments/media support through the existing event attachment surface
2. Add a dedicated `measurement add` CLI surface for ordinary numeric capture.
3. Convert `workout measurement add` into a thin compatibility alias/preset over `measurement`.
4. Route semantic query summaries from canonical `measurement` events instead of only the old numeric `observation` fallback path.
5. Keep old read compatibility only where needed so the cutover does not strand already-saved numeric facts during the transition.

## Verification target

- `pnpm typecheck`
- Truthful coverage-bearing scoped lane for touched owners
- Required completion audits for a high-risk repo change

## Current state

- Canonical `measurement` event storage, read paths, query mapping, and top-level CLI commands are implemented.
- `workout measurement` now acts as a compatibility alias that still writes canonical `measurement` events.
- Final cleanup tightened the CLI vocabulary so `measurement` is the clearly primary path, centralized measurement command descriptions so the manifest and live help cannot drift, and reused the shared list-option primitives for measurement list surfaces.
- Direct verification remains green; required repo audit-worker passes are still pending before commit.
Status: completed
Updated: 2026-04-24
Completed: 2026-04-24
