# Extract document source evidence ownership

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Goal

- Give exact document-source evidence one concrete read owner without changing document reuse, inbox preservation/retention, or once-only workout import behavior.

## Success criteria

- Source identity still derives from the existing audit, document lifecycle, manifest, and immutable raw bytes; deleted or damaged evidence still fails closed.
- Mutation orchestration, source hashing, correlation audit writes, public API, and canonical lock routing remain in their existing owners.
- Focused core and inbox suites, affected typechecks, complexity review, and scoped self-review pass before draft PR handoff.

## Scope

- In scope: move document-source inspection and its types/constants into a private core domain module; update imports and the existing seam owner documentation.
- Out of scope: write-batch replay, new persistence, changed ledger scans, import/cancellation policy, provider behavior, and public API changes.

## Constraints

- Technical constraints: reuse raw manifests, raw integrity, event-spine, and ledger storage primitives; no reverse import into mutations or new package export.
- Product/process constraints: preserve newer main-branch device import cancellation work; use synthetic test data; keep local verification at two workers and let CI own broad verification.

## Risks and mitigations

1. Evidence query extraction could weaken tombstone, ownership, or byte-integrity checks.
   Mitigation: move the existing algorithm intact and retain damaged-source, deletion, alias, and inbox-retention regression coverage.
2. Moving correlation inspection could detach it from the write lock.
   Mitigation: retain the public wrapper and canonical write block; the new owner performs only the existing pre-write proof within that wrapper.

## Tasks

1. Completed: compare current main against the reviewed head and inspect ownership and relevant tests.
2. Completed: extract evidence readers and correlation inspection; retain mutation and lock orchestration.
3. Completed: run focused suites, typechecks, complexity guard, and diff/privacy review.
4. Close this implementation record in a scoped commit. The parent completion owner coordinates the shared complexity-guard prerequisite, exact-head CI, and final review.

## Decisions

- The evidence cluster uses invocation-local maps and stable receipt inputs; it shares no device-import session state.
- Correlation inspection returns a normalized correlation or an already-recorded result; the mutation owner still emits the canonical audit.
- Existing public evidence readers route directly to the new private domain owner. No compatibility facade is added.
- Independent review confirmed the fifteen moved function bodies are identical apart from export modifiers and found no return import through the thirty-one local runtime dependencies.
- Existing behavioral coverage proves the extraction; no file-layout or implementation-mirroring tests were added.

## Verification

- Passed: `MURPH_VITEST_MAX_WORKERS=2 pnpm --dir packages/core exec vitest run --config vitest.config.ts --no-coverage test/raw-manifest-idempotency.test.ts test/import-event-batch.test.ts test/canonical-mutations-boundary.test.ts` — 65 tests.
- Passed: `MURPH_VITEST_MAX_WORKERS=2 pnpm --dir packages/inbox-services exec vitest run --config vitest.config.ts --no-coverage test/promotions-seam.test.ts` — 7 tests.
- Passed: `MURPH_VITEST_MAX_WORKERS=2 pnpm --dir packages/inboxd exec vitest run --config vitest.config.ts --no-coverage test/inbox-media-retention.test.ts` — 30 tests.
- Passed: `pnpm --dir packages/core typecheck`, `pnpm --dir packages/inbox-services typecheck`, and `pnpm --dir packages/inboxd typecheck`.
- Passed: `pnpm verify:workspace-boundaries`, `pnpm verify:workspace-package-cycles`, `pnpm docs:drift`, and `git diff --check`.
- Reviewed: `pnpm complexity:diff` flagged the unchanged moved `inspectExactDocumentSourceSet` (62) as new per-file debt of 42; mutation-file debt dropped by exactly 42. The parent owns a shared exact-move guard correction and its single Frog entry. The function remains intact; no metric-driven helper split or local guard exception was introduced.
- Dependency installation used the frozen lockfile; manifests and lockfile are unchanged. Privacy review found no personal identifiers in changed artifacts. This is an internal ownership change with no changelog entry or deployment-format change.
Completed: 2026-09-10
