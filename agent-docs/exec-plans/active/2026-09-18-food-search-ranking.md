# Food search: select before delivery numbering

Status: implementation authored; parent verification and closeout pending.
Base: `a7978b3fde56`.

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
- [ ] Run focused native tests and Web typecheck in the prepared repository.
- [ ] Run the parent's baseline/candidate differential, including saturated
  private FTS/GiST branches. Keep the existing heavy fixture budgets unchanged.
- [ ] Obtain parent review, exact-head CI, and authored closeout updates.

## Validation and boundaries

Local authoring checks are recorded in the handoff, not treated as native
PostgreSQL, CI, or deployment evidence. Product UX remains Hold for parent native
verification. Public small-candidate success cannot clear the private saturated
case. Host timing is not a correctness assertion, and this correction does not
guarantee universal timeout resolution. No production access, merge, or deploy
is authorized. Keep this plan active for the parent's verification handoff.
