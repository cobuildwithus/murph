# Count mirrored Journal sessions once

Status: completed
Created: 2026-09-14
Updated: 2026-09-15

## Goal

Journal counts a mirrored workout once and shows one matching sleep/workout record with all contributing sources, preserving original canonical evidence.

## Success criteria

- Matching cross-source sessions contribute one duration and session count.
- Distinct sessions, unknown timing, and conflicting durations remain separate.
- Daily/weekly totals and record presentation derive from the same collapsed sessions.
- Focused query tests and typecheck pass; iOS remains API-compatible.

## Scope and owner

The query-owned Journal projection is the existing boundary. Its activity presentation currently sums every canonical activity record in each group. Sleep already selects one duration but repeats source copies in Records. This correction changes derived presentation only; no importer, canonical write, API schema, persistence, or provider request changes.

## Product UX

Outcome: mirrored health imports read as one session.
Reaches: Journal on web and iOS after the existing projection refresh.
Proof: synthetic matched mirrors, distinct sessions, timing uncertainty, provider aliases, and input-order invariance.

## Decisions and constraints

Use recorded session intervals and durations with a small rounding tolerance; never infer duplicates from a date or label alone. Preserve cross-source attribution in the existing source string. Existing canonical records remain untouched. Bound work by the existing 1,500-record Journal window. Deploy the backend and allow the existing projection refresh; no client migration or schema change.

## Tasks

1. Add a focused failing mirrored-session regression.
2. Collapse matched source copies before display and aggregation using the existing candidate pipeline.
3. Run focused tests/typecheck, inspect complexity and diff, add a public release note, and open a backend PR.
4. Complete required review and exact-head CI.

## Verification

Focused Journal suite: 28 tests passed. Query typecheck passed. Complexity diff passed with no hotspot above 20. Release-note rendering: 10 tests passed after using the existing documented-command workaround. Private in-memory archive replay confirmed mirrored-session collapse without storing member content. Web typecheck remains running; final ReviewGPT and exact-head CI are tracked on PR #3464. No source edits are known to remain.

## Implementation outcome

The existing projection now derives one record and activity contribution per matching cross-source session; no canonical records or client schema change. Product UX: Ready in focused projection and rendering proof. Deployment and refreshed production projection verification remain separate from this implementation. Existing Frog entries 20260912202546 and 20260911184822 cover the changelog command workaround; no duplicate friction entry was created.
Completed: 2026-09-15
