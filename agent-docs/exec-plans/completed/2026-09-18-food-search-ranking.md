# Food search: select before delivery numbering

Status: completed
CI gate on open PR #3564.
Base: `a7978b3fde56`.
Applied implementation: `20b949832ca0f695aa05d791707e2d5c031b90a2`.
Reviewed and CI-tested head: `4b2dca25bb435610dd1a3c114605f959fc260a8f`.

## Implementation and preserved contract

`apps/web/src/lib/product-labels.ts` applies the existing complete ORDER BY and
LIMIT/OFFSET before the internal `result_rank`, permitting top-N selection and
numbering only the selected page. Parent final source review confirmed identical
ordering keys and collation, canonical winners, candidates, filters, bindings,
and projected results. Private/public labels, exact-record evidence joins, and
nonzero-offset delivery order are preserved. Supplement and brand-scoped SQL
and direct ID/UPC lookup remain unchanged. No state, schema, protocol, dependency,
concurrency, timeout, retry, or auth change was introduced.

## Confirmed parent evidence

The parent verified GPT-6 Pro response metadata and the implementation patch
SHA256: `98bcde9c73d92fa7263bf50c818cac1664bfbbc8ee55b547985359cb533455f2`.

- Native evidence/page/plan regression: PASS. The same test against baseline
  FAILS at delivery-window input (4 vs expected 3), before later plan assertions.
  The executed candidate plan proves bounded page input and top-N selection.
- PostgreSQL 17 CI on the reviewed head passed the entire
  `supplements-search-postgres.test.ts` owner: 134 tests, including the unchanged
  250,000-row common-token timeout regression, page/plan regression, and all
  existing cases. The complete large-fixture test took 9.828 seconds including
  setup and multiple searches, not a measured single-query latency; its
  production eight-second query limits passed unchanged.
  [PostgreSQL 17 CI job](https://github.com/cobuildwithus/murph/actions/runs/35311030828/job/105493159595).
- All 133 other native owner tests passed locally with CLI
  `--hookTimeout 600000` for fixture setup only. The unchanged 250,000-row test
  was excluded from that run and exercised separately; search statements
  retained the eight-second deadline.
- Four food/supplement library and route files: 132 PASS. Web
  `typecheck:prepared`, targeted ESLint, and `complexity:diff`: PASS, with the
  threshold-scoring hotspot unchanged at 21. Latest changelog copy: 10 rendering
  tests PASS after regenerating the ignored module, from repository root with
  `apps/web/vitest.config.ts`. `docs:drift` and `docs:gardening` passed again.
- All four Web test shards, all four general PostgreSQL shards, Web build
  verification, build/typecheck, Temporal exact-head compatibility, and PR
  evidence checks passed on the reviewed head. Four package coverage jobs were
  still in progress at evidence handoff; the aggregate CI gate remains open.
- Final ReviewGPT round 1: PASS on the reviewed head, no qualifying findings;
  GPT-6 Pro response metadata and SHA256 validated. Its independent comparison
  covered generated SQL and parameter bindings across 268 owner-input cases
  and traced private/public selection, filters, pagination, and projections.
  This was SQL-generation proof, not additional PostgreSQL execution. Parent
  final source review completed; merge-tree against then-current main and the
  working tree were clean before closeout.

## Output equivalence and local latency limits

Actual candidate and unchanged baseline modules in the same independent
30,000-row synthetic fixture with canonical duplicates returned equal ordered
rows and labels for saturated common word, exact name, brand token, generic-only,
typo, and no match. The local diagnostic-only 30-second budget established
output equivalence, not a production-latency pass.

Paired PostgreSQL 14 baseline/candidate timings were broad 12.16s/13.60s and
typo 7.53s/3.10s; an earlier experimental broad plan measured 12.96s/6.71s.
The actual candidate's separate external 250,000-row PostgreSQL 14 diagnostic
completed setup, then failed search with SQLSTATE 57014 at 8.28 seconds. This
remains a local latency limitation. No repository statement deadline or fixture
budget changed. These noisy timings establish neither a uniform speedup nor an
eight-second timeout guarantee. Synthetic proof does not establish a production
incident cause or production timeout resolution.

## Remaining PR gate

This plan closes as the implementation record. The open PR owns the final
exact-head CI aggregate and the parent's PR-evidence refresh after documentation
closeout; the reviewed-head results above do not establish that later gate.
Merge and deployment remain outside this task. No private runtime or member
evidence is included.
Updated: 2026-09-18
Completed: 2026-09-18
