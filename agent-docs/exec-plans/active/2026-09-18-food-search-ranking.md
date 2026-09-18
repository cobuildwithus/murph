# Food search: select before delivery numbering

Status: ACTIVE; focused parent proof confirmed. Full native-owner run, exact-head
CI, final ReviewGPT, and final parent closeout remain pending.
Base: `a7978b3fde56`; draft PR #3564.
Applied implementation: `20b949832ca0f695aa05d791707e2d5c031b90a2`.

## Outcome and owner

Outcome: reduce final food-search ranking work without changing returned data.
Reaches: private label lookup and public food result pages, including later pages.
Proof: native query-owner output checks and an executed PostgreSQL plan regression.

`apps/web/src/lib/product-labels.ts` owns the correction. Synthetic parent
reproduction and source inspection identify delivery numbering before pagination
as avoidable work; this does not establish the cause of a production incident.

## Protected contract

Retain every candidate branch and cap, exact-name admission, canonical winner,
ranking key and collation, evidence/popularity/comparison filter, and final join.
Apply the existing complete ORDER BY and LIMIT/OFFSET before `result_rank`.
The ordinal is internal and page-local; labels and exact-record evidence still
join selected IDs and delivery still orders by that ordinal. Supplement and
brand-scoped SQL, direct ID/UPC lookup, and the eight-second statement timeout
remain unchanged. No new state, cache, dependency, retry, or migration is needed;
failures retain the existing owner and behavior.

## Work and proof

- [x] Split the food-only selection CTE so delivery numbering follows pagination.
- [x] Extend the existing PostgreSQL evidence fixture with tied food names,
  a canonical alias, source/off-market filters, distinct labels, typo recovery,
  exact ID/UPC, and public relevance/evidence/popularity/comparison pages.
- [x] Add executed-plan assertions: three-row delivery-window input, a page Limit
  below that window, and top-N heapsort with more eligible rows than the page.
  The old window-before-Limit shape cannot satisfy this plan contract.
- [x] Update the SQL-shape unit expectation, search owner, index, and changelog.
- [x] Parent focused native tests, Web typecheck, and supporting checks below.
- [x] Parent six-case baseline/candidate synthetic equivalence below.
- [x] Link plain-language changelog copy to PR #3564.
- [ ] Complete the full native-owner run; official PostgreSQL 17 CI is required.
- [ ] Obtain exact-head CI, final ReviewGPT, and final parent closeout.

## Confirmed parent evidence

For the applied implementation, the parent verified GPT-6 Pro response metadata
and the downloaded patch SHA256:
`98bcde9c73d92fa7263bf50c818cac1664bfbbc8ee55b547985359cb533455f2`.

- Native PostgreSQL evidence/page/plan regression: PASS. The same authored test
  against baseline FAILS at delivery-window input (4 vs expected 3), before later
  plan assertions. The candidate executed plan proves bounded page input and
  top-N selection.
- Four food/supplement library and route test files: 132 PASS. Web
  `typecheck:prepared`, targeted ESLint, `complexity:diff`, `docs:drift`, and
  `docs:gardening`: PASS; threshold-scoring hotspot unchanged at 21. Changelog:
  10 PASS from repository root using `apps/web/vitest.config.ts`.
- Actual candidate and unchanged baseline modules in the same independent
  30,000-row synthetic fixture with canonical duplicates returned equal ordered
  rows and labels for saturated common word, exact name, brand token,
  generic-only, typo, and no match. A local diagnostic-only 30-second budget
  was used for equivalence, not a production-latency pass.

The README test-discovery-root issue is already covered by Frog 20260911184822
and 20260912202546; no new entry or scope expansion.

## Validation and boundaries

Paired PostgreSQL 14 baseline/candidate timings were broad 12.16s/13.60s and
typo 7.53s/3.10s; an earlier experimental broad plan measured 12.96s/6.71s.
These noisy host timings establish neither a uniform speedup nor an eight-second
timeout guarantee.
The existing 250,000-row fixture's local setup exceeds 120 seconds; no statement
or fixture budget changed. Official PostgreSQL 17 CI remains required.
Public small-candidate success alone cannot clear private saturated behavior.
Product UX remains Hold pending the remaining parent gates. No production
evidence is claimed; no production access, merge, or deploy is authorized.
Keep this plan active for verification and authored closeout.
