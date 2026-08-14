# Bound food-label search work

Status: active
Created: 2026-08-14
Updated: 2026-08-14

## Goal

- Prevent broad `/api/foods` searches from crossing the labels database's
  statement timeout while preserving the existing ranked, deduplicated result
  contract.

## Success criteria

- A production-scale synthetic catalog reproduces the current unbounded query
  failure and demonstrates that the corrected query completes within the
  configured statement timeout.
- Private food-label searches bound the candidate rows scored and sorted before
  canonical-key deduplication and final result limiting.
- Existing exact-id, UPC, generic-origin, source-filter, ranking, and
  contaminant-summary behavior remains unchanged.
- Focused hosted-web tests and typecheck pass, and exact-head CI plus the
  applicable ReviewGPT gates complete.

## Scope

- In scope: the shared product-label generic-search SQL used by `/api/foods`,
  focused SQL-shape/PostgreSQL regression proof, and the durable query-bound
  contract.
- Out of scope: pool sizing, timeout increases, label ingestion, public search
  UX, supplement ranking redesign, and provider-call retry behavior.

## Constraints

- Technical constraints: keep candidate work bounded before window functions;
  retain indexed FTS-first and trigram-fallback behavior; avoid a new cache,
  queue, retry, or state owner.
- Product/process constraints: do not persist search terms or private runtime
  evidence; use synthetic data for reproduction and committed tests.

## Risks and mitigations

1. Risk: bounding candidates can exclude lower-ranked canonical products when
   many aliases share one canonical key.
   Mitigation: retain a candidate budget materially above the maximum returned
   result count and add deduplication/ranking coverage at the bound.
2. Risk: a structural SQL assertion could pass without proving runtime impact.
   Mitigation: run the old and corrected query against the same indexed,
   production-scale synthetic corpus under an explicit statement timeout.

## Tasks

1. [x] Correlate production errors, request methods, current SQL, indexes, and
   query history without collecting search terms or member identifiers.
2. [x] Reproduce the statement timeout on a production-scale synthetic foods
   table and capture a secret-safe plan/runtime comparison.
3. [x] Apply the smallest candidate-bound correction and add focused regression
   coverage.
4. [x] Run focused tests, hosted-web typecheck, direct PostgreSQL proof, and a
   parent diff review.
5. [ ] Commit and push the candidate, open a PR, and complete exact-head CI and
   required ReviewGPT review gates.

## Decisions

- The failing boundary is the labels database statement timeout, not pool
  acquisition or the hosted execution state machine.
- Do not raise the eight-second timeout: the private generic search currently
  materializes and window-sorts every matching food row before applying the
  requested limit, even though the public projection already bounds candidate
  work.

## Verification

- Focused Vitest coverage for food SQL shape, route behavior, and the labels
  pool contract.
- Opt-in local PostgreSQL regression coverage plus an explicit old-versus-new
  production-scale synthetic query timing comparison.
- Hosted-web TypeScript typecheck and `git diff --check`.
- Required GitHub checks and exact-head ReviewGPT completion evidence.

Completed during implementation:

- The prior query was canceled at the configured eight-second statement
  timeout on a two-million-row synthetic foods table. Applying only the later
  public candidate bound was also canceled because similarity scoring still
  preceded that bound.
- The corrected source query completed the same broad synthetic lookup in 206
  ms through `createFoodsQueries` with the real pool statement timeout.
- Focused food route/query/pool coverage passed 103 tests. The opt-in local
  PostgreSQL search regression passed 128 tests.
