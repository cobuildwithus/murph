## Goal

Unify Murph's event-like write/read internals around one shared event spine without changing the canonical vault layout or introducing a second ledger.

## Why

- The durable architecture already commits to one file-native vault and one `ledger/events` timeline.
- Recent hard cuts already standardized attachments, workout payload ownership, and write-side links.
- The remaining complexity is internal duplication across `packages/core/src/mutations.ts`, `packages/core/src/domains/events.ts`, `packages/core/src/history/api.ts`, and query-side lifecycle collapse logic.

## Scope

- In scope:
- shared pure event lifecycle/revision helpers that can be consumed across packages
- shared core event-spine helpers for common event envelope/base normalization
- migrate generic events, health history, and legacy event mutation paths onto that shared spine
- refresh query lifecycle-collapse logic to use the shared pure helpers
- focused tests/docs needed to keep the new internal ownership explicit
- Out of scope:
- vault layout or persisted-shape migration
- introducing a second history ledger
- replacing the file-native vault model

## Constraints

- Keep `ledger/events` as the canonical append-only event/history timeline.
- Preserve canonical writes in `packages/core`.
- Preserve canonical persisted record shapes unless a compatibility projection is already documented as non-authoritative.
- Keep the refactor behavior-preserving; prefer internal unification over new product behavior.
- Treat the implementation as greenfield at the internal-architecture level: prefer a hard cut to the final shared event-spine ownership model instead of introducing temporary shim layers or migration-only compatibility helpers.

## Planned slices

1. Contracts/query slice: add shared pure lifecycle helpers in `packages/contracts` and adopt them in query history collapse paths.
2. Core event/history slice: add shared core event-spine helpers and migrate `domains/events.ts` plus `history/api.ts`.
3. Core mutation/assistant slice: migrate legacy event mutation helpers in `packages/core/src/mutations.ts` and any assistant-engine call sites that rely on the old helper assumptions.
4. Verification/audit/docs slice: refresh focused tests, update durable docs if needed, run required checks, required audit passes, and commit.

## Verification target

- `pnpm typecheck`
- `pnpm test:packages`
- `pnpm test:smoke`
- focused Vitest coverage for contracts/core/query/assistant-engine seams touched by the refactor
- at least one direct scenario proof on canonical event/history revision collapse or event write behavior
Status: completed
Updated: 2026-04-07
Completed: 2026-04-07
