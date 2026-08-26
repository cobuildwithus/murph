# Bound food-search candidate work

Status: active
Created: 2026-08-25
Updated: 2026-08-25

## Goal

- Make private food-name search finish within its existing 8-second database
  deadline by bounding catalog work before ranking, while preserving exact,
  brand-only, generic-only, typo-fallback, and canonical-deduplication behavior.

## Success criteria

- The real query builder cannot sort or canonical-scan an unbounded FTS match
  set before applying its candidate cap.
- Focused PostgreSQL coverage preserves current ranking/search contracts and
  proves broad common-token work remains bounded in a large synthetic catalog;
  a read-only production probe owns proof at the live 2.03-million-row scale.
- Obsolete index requirements are removed rather than retained without a live
  query consumer.
- Required focused tests, typecheck, exact-head review gates, and CI pass before
  merge; a bounded production read-only probe confirms the deployed SQL shape.

## Scope

- In scope: private food search SQL, its focused unit/PostgreSQL tests, food
  index/preflight contract, and matching operator documentation.
- Out of scope: supplement/public search behavior, timeout increases, caching,
  new services, schema data migration, and unrelated label-import work.

## Constraints

- Technical constraints: keep the existing exact-ID/UPC paths and 8-second
  timeout; candidate admission must use existing GIN/GiST/btree indexes and
  database-only bounded work.
- Product/process constraints: preserve privacy-safe logs and current food
  result semantics; use the smallest explicit SQL data flow and delete the
  canonical whole-table lane/index contract if it has no remaining consumer.

## Risks and mitigations

1. Risk: bounding candidates can hide brand-only or distant-name FTS matches.
   Mitigation: retain a separately bounded unordered GIN-admitted FTS lane and
   give it enough headroom to preserve the established greater-than-5,000 alias
   diversity fixture; cover brand-only, generic-only, exact, apostrophe, and
   private-food typo journeys.
2. Risk: a synthetically fast small fixture hides catalog-scale plan behavior.
   Mitigation: add a large common-token PostgreSQL regression that proves the
   plan caps work before ranking, then re-probe the production-scale DB read-only.

## Tasks

1. Inspect the current SQL plan and lock the failing unbounded behavior in
   focused structural/PostgreSQL tests.
2. Replace whole-match sorting/canonical lanes with explicit bounded FTS and
   nearest-name admission followed by in-set filtering/ranking/deduplication.
3. Remove any food index contract made obsolete by the corrected query.
4. Run focused verification and parent scope/architecture review.
5. Push a draft PR, run preliminary and final ReviewGPT concurrently with CI,
   resolve accepted findings, close the plan, and merge only when exact-head
   gates are green.
6. Confirm current-main mergeability and perform a secret-safe production probe.

## Decisions

- Keep the existing timeout as a correctness boundary; do not mask the query
  defect by increasing it.
- Use two complementary bounded admission lanes: GIN-first FTS for brand/search
  text recall (10,000 rows) and GiST nearest-name for name relevance (5,000
  rows), with canonical dedupe only after their bounded union.

## Verification

- Commands to run: focused food library/unit tests, focused PostgreSQL search
  tests, `pnpm --filter web typecheck`, exact-head ReviewGPT/CI, clean merge-tree,
  and a read-only production EXPLAIN/probe under the 8-second timeout.
- Expected outcomes: all behavior tests pass; broad common-token search remains
  bounded; production no longer reproduces SQLSTATE 57014 for the proven probe.
