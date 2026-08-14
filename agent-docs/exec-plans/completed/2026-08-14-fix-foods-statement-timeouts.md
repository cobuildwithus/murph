# Bound food-label search work

Status: completed
Created: 2026-08-14
Updated: 2026-08-14

## Goal

- Prevent broad `/api/foods` searches from crossing the labels database's
  statement timeout with an explicit bounded, ranked, and deduplicated private
  food-name retrieval contract.

## Success criteria

- A production-scale synthetic catalog reproduces the current unbounded query
  failure and demonstrates that the corrected query completes within the
  configured statement timeout.
- Private food-label searches bound the candidate rows scored and sorted before
  canonical-key deduplication and final result limiting.
- Existing exact-id, UPC, generic-origin, source-filter, supplement, public,
  and contaminant-summary behavior remains unchanged. Private food names rank
  deterministically within the documented admitted set.
- Focused hosted-web tests and typecheck pass, and exact-head CI plus the
  applicable ReviewGPT gates complete.

## Scope

- In scope: the private-food branch of the shared product-label generic-search
  SQL, focused SQL-shape/PostgreSQL regression proof, and the durable
  query-bound contract.
- Out of scope: pool sizing, timeout increases, label ingestion, public search
  UX, supplement ranking redesign, and provider-call retry behavior.

## Constraints

- Technical constraints: keep candidate work bounded before window functions;
  retain indexed FTS-first and trigram-fallback behavior; avoid a new cache,
  queue, retry, or state owner.
- Product/process constraints: do not persist search terms or private runtime
  evidence; use synthetic data for reproduction and committed tests.

## Risks and mitigations

1. Risk: bounded admission is not equivalent to exhaustive whole-catalog
   ranking when aliases or distinct products exceed the admission limits.
   Mitigation: document the private-food contract explicitly, retain separate
   literal exact-name, nearest-name, and canonical-diversity lanes, and keep
   supplement and public ranking behavior unchanged.
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
5. [x] Commit and push the candidate, open a PR, and complete exact-head CI and
   required ReviewGPT review gates.

## Decisions

- The failing boundary is the labels database statement timeout, not pool
  acquisition or the hosted execution state machine.
- Do not raise the eight-second timeout: the private generic search currently
  materializes and window-sorts every matching food row before applying the
  requested limit, even though the public projection already bounds candidate
  work.
- Keep bounded admission private-food-only. Supplement and public queries retain
  their prior paths, including the public 250-candidate contract.
- Use literal `lower(name) = lower($1)` equality for the bounded exact-name lane;
  never interpret `%` or `_` as SQL patterns.
- Final ReviewGPT round 1 produced three accepted findings: the phrase lane
  exposed SQL wildcard semantics and unbounded pre-limit work; fixed admission
  could not preserve exhaustive whole-catalog ranking; and the shared change
  drifted supplement/public behavior, including the public 250-candidate
  contract. Remediation deletes the phrase lane, makes the private-food ranking
  tradeoff explicit, adds a bounded indexed literal-name lane, and restores the
  original supplement/public query path.

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
  ms through `createFoodsQueries` with the real pool statement timeout. The
  first bounded implementation was rejected because unordered admission could
  exclude ranking winners and collapse canonical diversity.
- The final private-food-only query completed a fresh two-million-row search
  through `createFoodsQueries` in about 0.4 seconds under the real eight-second
  statement timeout, returning the literal exact-name winner and 50 unique
  results.
- Focused food and supplement query-helper coverage passed 67 tests. The
  opt-in local PostgreSQL search regression passed 132 tests, including
  greater-than-5,000 private-food admission, SQL wildcard input, and a literal
  percent-bearing product name.
- Final ReviewGPT round 2 returned `ROUND_OUTCOME: PASS` with no qualifying
  findings after rechecking all three round-1 remediations, bounded database
  fanout, the index-first rollout, and the complete current change shape.
- Exact-head CI passed all 15 reported checks on remediation commit
  `88bdebfb7fb7b1bf6bcdfa9c0039e4f6e3ad64b7`.
Completed: 2026-08-14
