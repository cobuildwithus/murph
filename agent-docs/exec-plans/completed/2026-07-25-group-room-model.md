# Group Room Model

Status: completed
Created: 2026-07-25
Updated: 2026-07-25
Completed: 2026-07-25

## Goal

Give each hosted group Murph a compact, durable understanding of the room's
people, canon, humor, response patterns, and open loops without introducing a
second memory system or making every reply perform a knowledge read.

## Constraints

- Reuse existing managed automation, transcript, maintenance, and knowledge
  primitives.
- Keep the page advisory rather than authoritative.
- Preserve direct/private memory behavior.
- Keep sender handles internal and non-authoritative.
- Add no scheduler, queue, table, cursor, vector store, or per-participant page.
- Preserve foreground priority, silent maintenance, exact-skip output, and the
  existing replay barrier.

## Decisions

1. Reuse the existing overnight-memory maintenance automation id in the
   synthetic group vault. Managed-seed composition substitutes a group-specific
   definition only when the trusted default route is exactly non-direct.
2. Run the group seed Tuesday and Friday at 04:00 local time, yielding simple
   three- and four-day gaps.
3. Reuse committed transcripts. Add a group evidence profile that preserves
   structured message boundaries and excludes direct sessions.
4. Maintain one fixed `group-room-model` derived knowledge page with complete
   replacement writes.
5. Tell ordinary group turns not to read the page by default. Read it once only
   when a concrete social tip would materially improve the current reply.
6. Keep canonical room-style settings explicit and separate.

## Implementation

- Added a narrow package-root wrapper that selects the group seed for exact
  non-direct routes while delegating every other case to the existing managed
  automation implementation.
- Added the structured group evidence profile while preserving the personal
  evidence renderer.
- Moved the existing large prompt implementation to an internal base module and
  kept the public module as a small composition wrapper for group-room guidance
  and dual maintenance command scopes.
- Added focused group-room-model tests and this live product spec.

## Verification

- New TypeScript modules were syntax/type checked against local interface stubs.
- Focused repository tests are added for seed selection, evidence isolation and
  structure, advisory prompt behavior, and maintenance mode separation.
- GitHub CI remains the authoritative full workspace verification gate.
- ReviewGPT browser automation was unavailable in this execution environment;
  the PR records that limitation rather than claiming a completed review.
