# Bound production food search below 2.5 seconds

Status: active
Created: 2026-08-28
Updated: 2026-08-28

## Goal

- Keep private food-name search responsive on the production-scale labels
  catalog by making candidate admission proportional to the requested result
  count instead of paying the fixed maximum for five-result searches.

## Success criteria

- Exact repository SQL completes representative broad-FTS and no-FTS typo
  searches below 2.5 seconds against the current production labels catalog,
  through a read-only eight-second-bounded diagnostic.
- The existing ranking, exact-name, generic-origin, off-market, source-filter,
  canonical-diversity, supplement, public-search, and contaminant contracts
  remain covered.
- The production-scale PostgreSQL regression proves the bounded candidate
  budget and retains the eight-second fail-closed pool timeout.
- Focused tests, Web typecheck, required completion audits, ReviewGPT, and
  exact-head CI pass.

## Scope

- In scope: private food generic-search candidate admission, focused query
  shape and real-PostgreSQL coverage, the durable labels-database contract,
  and a concise member-facing changelog fragment.
- Out of scope: public/supplement ranking, pool sizing, timeout increases,
  schema/index changes, label ingestion, retries, caches, queues, and device
  sync.

## Constraints

- Technical constraints: keep both FTS and typo work bounded before window
  ranking; preserve indexed GIN/GiST paths; keep database work read-only and
  avoid new state, services, dependencies, or migrations.
- Product/process constraints: ReviewGPT exclusively authors production code;
  use synthetic search inputs and privacy-safe aggregate evidence only; leave
  the functional PR ready for human merge.

## Risks and mitigations

1. Risk: a smaller candidate budget can exclude a ranking winner or collapse
   canonical diversity for larger result requests.
   Mitigation: derive the budget from requested result count with an explicit
   floor and ceiling, retain the existing maximum for large result sets, and
   exercise the established boundary fixtures.
2. Risk: warm local tests can conceal production I/O sensitivity.
   Mitigation: retain the production-scale PostgreSQL test and record direct
   read-only production timings from distinct FTS and typo paths.

## Tasks

1. Deduplicate against active work and prove the production query/index cause.
2. Give ReviewGPT the implementation packet and inspect its patch for ranking,
   privacy, load, and scope correctness.
3. Run focused PostgreSQL, query-helper, route, changelog, and typecheck proof.
4. Commit and push the exact candidate, open a draft PR, then run preliminary
   completion-specialist and final ReviewGPT gates concurrently with CI.
5. Resolve accepted findings, mark the ordinary bug-fix PR ready for human
   merge, and record the production verification query.

## Decisions

- Live read-only proof on the 2.03M-row labels catalog found all required
  indexes valid/ready/live. The fixed 10,000-row query took 6.65-6.98 seconds;
  the GiST nearest-name scan dominated and physical reads drove a fivefold
  cold/warm difference.
- A test-only 1,000-candidate variant completed a fresh broad-FTS path in
  0.79 seconds and a fresh no-FTS typo path in 1.79 seconds. Production code
  must derive a bounded budget rather than hard-code the diagnostic rewrite.

## Verification

- Commands to run: focused `apps/web` query-helper and route Vitest suites;
  opt-in real-PostgreSQL food-search regression; Web typecheck; changelog
  loader coverage; `git diff --check`; required completion audits and CI.
- Expected outcomes: five-result searches admit the narrow budget, larger
  requests scale without exceeding the existing 10,000 ceiling, established
  ranking fixtures remain stable, and the production-scale query stays below
  2.5 seconds without changing the eight-second timeout.

## Progress

- ReviewGPT authored the accepted four-file implementation patch. The derived
  budget is `min(10,000, max(1,000, 200 × requested limit))`, rendered as a
  validated integer SQL literal across all three private-food admission
  branches. Its two later test-only corrections were also applied unchanged.
- Focused local proof is green: 37 food-query tests, 134 real-PostgreSQL tests
  over the 250,000-row synthetic catalog, 46 route/pool/runtime-env tests,
  scoped ESLint, Web typecheck, and `git diff --check`.
- Exact candidate SQL completed read-only production probes in 219 ms for the
  broad full-text path and 1,237 ms for the distinct no-full-text typo path.
  Both five-result probes admitted 1,000 candidates and used the existing
  indexes, with no concurrent active query or lock waiter observed.
- Product UX Patch walkthrough: `Outcome` food-label lookup returns promptly;
  `Reaches` existing private food searches through the hosted data client;
  `Proof` exact production-catalog timing covers both expensive query branches.
  Public foods, supplements, exact ID/UPC lookup, response shape, filtering,
  and ranking semantics remain unchanged. Verdict: `Ready`.
