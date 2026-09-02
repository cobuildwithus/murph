# Food Label Lab

Status: active
Created: 2026-09-02
Updated: 2026-09-02

## Goal

- Add a public `/food` comparison surface for branded foods.
- Let a person compare two to four products and see the useful conclusion first.
- Expose the same read-only journey to compatible browser agents through WebMCP.
- Reuse the current public product data contract and exact-product evidence rules.

## Product UX Plan

### Outcome

A visitor can compare several products in seconds and identify the best match
for the selected nutrition metric without reading the raw evidence first.

### Entry And Promise

The visitor opens `/food`, searches for products, and builds one comparison.
Murph shows the strongest match, per-metric winners, alerts, and evidence
coverage. It does not certify a product as safe or healthier overall.

### Affected People

- A desktop visitor compares two to four branded foods with complete nutrition.
- A phone visitor gets the same conclusion in a compact, scrollable layout.
- A visitor with partial data sees unknowns as unknown, with a clear recovery path.
- A compatible browser agent can search, inspect, and compare through the open page.

Search terms remain private. The agent uses the same bounded public API as the
visible UI. No account, write, vault access, or background MCP server is added.

### Proof Path

- Render the real comparison with representative complete and partial products.
- Exercise search, add, remove, metric change, unit change, popover, tests drawer,
  gaps drawer, empty, loading, no-result, rate-limit, and request-error states.
- Capture browser proof at desktop and phone widths.
- Stub the browser WebMCP runtime and verify schemas, lifecycle, bounded outputs,
  and visible comparison updates.

### UX Finish

- Put the conclusion before supporting counts.
- Use sage for supported positive findings, sienna for real alerts, and amber for unknowns.
- Keep raw tests and source detail behind progressive disclosure.
- Use the Murph food-category illustrations and the existing warm-paper system.
- Keep controls keyboard accessible and the comparison usable on narrow screens.

### Done When

- `/food` works without an account and does not put search terms in the URL or storage.
- A person can build a useful two-to-four-product comparison.
- Main cells show per-metric winners without a universal health score.
- Tests and gaps show short conclusions first, with optional source detail.
- WebMCP registers only on `/food`, cleans up on unmount, and changes the same visible state.
- The real surface appears in the design catalog with synthetic data.

The user approved this product direction, the Paper v3 design, and implementation
on 2026-09-02.

## Product Contract

- The comparison is nutrition-first. It ranks the selected visible metrics only.
- "Top match" means the product wins the most visible metrics. It is not a health score.
- Evidence quality stays separate from nutrition ranking.
- An alert means an exact-linked tested sample exceeded a comparable screening limit.
- Missing tests and unknown label fields are evidence gaps, not failed tests.
- Product tests never transfer across similar names, brands, ingredients, or formulas.

## Architecture Decisions

1. Keep the feature in the existing Next.js app at `/food`.
2. Reuse `POST /api/public/v1/products/search` and exact product-detail reads.
3. Add no runtime dependency. Register imperative WebMCP tools through the current
   browser API and own their lifetime with one `AbortController`.
4. Keep comparison state in the page. WebMCP calls the same typed page actions
   so the visible UI and the agent cannot drift into separate implementations.
5. Reuse current contracts and add small pure comparison projections where needed.
6. Commit generated category illustrations as presentation assets. Do not commit
   the local marketing research source archive.

## Scope

- In scope: `/food`, search and comparison UI, metric popover, tests drawer,
  gaps drawer, empty/loading/error states, category illustrations, WebMCP tools,
  design study, tests, current docs, browser proof, and PR verification.
- Out of scope: writes, food logging, vault access, personalized advice, a remote
  MCP server, accounts, new data sources, inferred product-test linkage, and a
  universal product or safety score.

## Risks And Mitigations

1. A winner treatment can read as a safety or health verdict.
   Keep the label metric-specific and keep evidence in a separate row.
2. Partial nutrition can create a false winner.
   Compare only metrics available for all shown products and disclose missing values.
3. Public search can expose intent or add database load.
   Preserve POST-body privacy, request bounds, no-store, no-referrer, and current WAF rules.
4. WebMCP can drift from visible behavior.
   Route both paths through the same state actions and existing API contract.
5. Dense details can reproduce the current reading burden.
   Show conclusions first and keep raw reports behind optional disclosure.

## Patch-Size Retrospective

The first reviewed candidate has 2,214 added production-source lines and no
review-driven source growth. Continue as one release for these reasons:

- The human comparison and page-scoped WebMCP form one approved challenge
  journey. They share one temporary visible-state contract. Splitting either
  part would leave that journey incomplete.
- The metric popover explains one compact comparison. The two evidence modes
  answer different questions: tests show what a lab found, while gaps show what
  remains unknown. Combining them would restore the dense evidence UI that the
  design removes.
- Existing public product APIs remain the data owner. The page owns temporary
  state only. This change adds no service, persistence owner, dependency, score,
  API, repeated mechanism, or parallel data path.

The concepts are one page-local comparison state, pure nutrition and evidence
projections, one comparison table, one metric popover, two evidence modes, four
page-scoped WebMCP registrations, and two existing-style UI primitives. This
interaction set is proportionate to the approved outcome, so no split or scope
deletion is required.

## Review Remediation

ReviewGPT round 2 found two original implementation errors. Both were accepted:

- A partial metric could still show a winner, and tied values could receive
  different ordinal ranks. Winner selection now requires a value from every
  compared product. The popover no longer uses ordinal ranks.
- The page treated bounded evidence arrays as complete and rebuilt evidence
  gaps locally. The page now labels observations with their returned and total
  scope, qualifies capped alert counts, and renders the public API's unknown
  titles and descriptions directly.

The correction removes the duplicate evidence-dimension owner. It adds no new
service, state owner, persistence, dependency, or lifecycle. Focused model,
client, WebMCP, public-product, Murph Safe, type, lint, and complexity checks pass.

ReviewGPT round 3 confirmed both round-2 corrections, then found two more
original implementation errors. Both were accepted:

- The tests sheet grouped observations and derived sample coverage from report
  metadata. That local evidence matrix and its sample dots were deleted. The
  optional disclosure now renders each returned result, its screening status,
  named threshold, basis, authority, exposure policy, and source directly.
- WebMCP returned top-match references without the visible nutrition facts that
  explained them. The existing comparison result now serializes all four metric
  values, completeness, ties, winners, comparable metric count, and product win
  counts. It adds no tool, endpoint, state, or second calculation.

## Tasks

1. Inspect current public product contracts, route privacy, design catalog, and tests.
2. Build pure nutrition, evidence, category, and comparison projections.
3. Build the `/food` client experience and all product states.
4. Register bounded read-only WebMCP tools for the comparison journey.
5. Add illustrations, a synthetic design study, and focused tests.
6. Run browser proof, focused verification, completion review, CI, and ReviewGPT.

## Verification

- Focused unit and component tests for projections, UI states, and WebMCP lifecycle.
- Existing public-product contract, service, route, and privacy tests.
- Browser proof at phone and desktop widths, including empty and partial data.
- `git diff --check` and the routed frontend verification from the current workflow.
- Exact-head CI and the risk-routed final ReviewGPT gate.

## Product UX Walkthrough

Result: Ready.

- Desktop visitor: `/food` opens with one search field, three category
  illustrations, and three short examples. The empty state has no page overflow.
- Phone visitor: the same entry stays readable at 390 by 844 pixels. A populated
  comparison keeps row labels visible and scrolls product columns inside the table.
- Complete comparison: the synthetic Chobani, Straus, and Fage study shows one
  top match, one winner per metric, and evidence in a separate row.
- Detail seeker: a metric opens an opaque ranked-bar popover. Exact tests open a
  right sheet with the alert conclusion first and raw reports collapsed.
- Partial evidence: gaps remain neutral and state that unknown is not a failed
  test. No universal health or safety score appears.
- Failure and recovery: focused tests cover loading, empty results, rate limits,
  private POST search, stale-request cancellation, and bounded WebMCP input.
- Accessibility: the public empty route passed an axe WCAG A/AA audit with zero
  violations and zero incomplete checks.

The implementation matches the approved plan. The browser review found one
semi-transparent popover surface; it now uses the opaque popover token.

Design proof: `/screenshots/health#food-label-lab` renders the real component
with synthetic products and an empty state.
