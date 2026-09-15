# Simplify canonical device reconciliation

Status: completed
Created: 2026-09-11
Updated: 2026-09-11

## Goal

- Reduce the 135-branch device-event reconciliation hotspot while preserving canonical identity, provider revision ordering, member overlays, and atomic batch rejection.

## Success criteria

- Collapse duplicated provider/member revision construction; keep policy separate from ordered in-memory staging.
- Pass public device-import regression tests, core typecheck, and the complexity guard with reduced debt.

## Scope

- In scope: private helpers in core mutations, focused public mutation regression evidence.
- Out of scope: provider normalization, storage formats, new persistence owners, behavior changes.

## Constraints

- Technical constraints: existing canonical write lock and staged batch commit remain authoritative; no new I/O or dependencies.
- Product/process constraints: preserve immutable conflicts, aliases, complete-set retractions, replay counters, historical-member edits, and shard paths.

## Risks and mitigations

1. Reordered policy checks could accept a previously rejected event or lose a member overlay. Preserve call order and prove public import behavior, including unchanged-content provider advancement after a member edit.

## Tasks

1. Read the reconciliation owner and current device ingestion invariants.
2. Share provider/member revision construction and isolate source-specific revision policy.
3. Run focused proof, review the complete diff, close this implementation plan, and open a draft PR for parent-owned final review.

## Decisions

- Canonical state remains in the existing event spine. Helpers only derive revision entries or retention decisions; the existing reconciler stages them and owns counters/index changes. No schema, deployment, retry, or public API changes are required.

## Verification

- Commands: focused core device-import, validation, canonical-boundary, and session tests; core typecheck; `pnpm complexity:diff`.
- Expected outcomes: equivalent public import results and persisted revision ordering, with lower complexity debt. Exact-head CI and ReviewGPT remain parent-owned gates.

## Implementation evidence

- Core device-import, batch validation, canonical mutation boundary, and import-session tests: 212 passed.
- Importer Junction tests matching sparse intervals, profiles, authoritative sets, and member deletions: 30 passed, 223 unrelated tests skipped.
- Core typecheck and diff whitespace checks passed.
- Complexity guard passed: reconciler 135 to 100; file debt 326 to 291. All three new private helpers are below the threshold of 20.
- Extended the public mutation regression through a version-only update after two content updates: provider/member revisions remain ordered, exactly two canonical events survive, and an exact replay leaves the complete vault snapshot unchanged.
- The source diff preserves provider-policy order and error codes, shares revision construction and successful staging bookkeeping, and leaves canonical locking, aliases, authoritative retraction, and writes with their existing owners. No member-visible behavior, prompt, or schema changed.
- Implementation is complete; parent owns draft candidate review, Ready transition, exact-head CI, and final ReviewGPT.
Completed: 2026-09-11
