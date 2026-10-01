# Food Label Lab

Status: completed
Created: 2026-09-02
Updated: 2026-09-03

## Goal

- Add a public `/food` comparison surface for branded foods.
- Let a person compare up to ten products and see the useful conclusion first.
- Expose the same read-only journey to compatible browser agents through WebMCP.
- Reuse the current public product data contract and exact-product evidence rules.

## Product UX Plan

### Outcome

A visitor can compare several products in seconds and identify the best match
for the selected nutrition metric without reading the raw evidence first.
Category search starts with four comparison-ready products and keeps further
matches easy to browse without trapping the page in a second scroll area. The
selected category remains the source for further matches while the visitor
uses the search field to add an exact product.

### Entry And Promise

The visitor opens `/food`, searches for products, and builds one comparison.
Murph shows per-metric winners, evidence coverage, and confirmed results above
a screening limit. It does not certify a product as safe or healthier overall.

### Affected People

- A desktop visitor compares up to ten branded foods with complete nutrition.
- A phone visitor gets the same conclusion in a compact, scrollable layout.
- A visitor with partial data sees unknowns as unknown, with a clear recovery path.
- A category shopper never receives a search choice that has neither usable
  comparison nutrition nor exact-linked product tests.
- A compatible browser agent can search, inspect, and compare through the open page.

Raw search terms remain private. Share links store only public product references
and the selected nutrition basis. The agent uses the same bounded public API as
the visible UI. No account, write, vault access, or background MCP server is added.

### Proof Path

- Render the real comparison with representative complete and partial products.
- Exercise search, add, remove, metric change, unit change, the combined
  evidence drawer, empty, loading, no-result, rate-limit, and request-error states.
- Exercise 12-product related pages, four-row related-product disclosure, and loading the
  next bounded page without a nested scrollbar.
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

- `/food` works without an account. A share URL restores selected public product
  references and the nutrition basis without exposing the typed search term.
- A person can build a useful comparison with up to ten products.
- Main cells show per-metric winners without a universal health score.
- Tests and gaps share one drawer. It shows short conclusions before optional source detail.
- WebMCP registers only on `/food`, cleans up on unmount, and changes the same visible state.
- The real surface appears in the design catalog with synthetic data.

The user approved this product direction, the Paper v3 design, and implementation
on 2026-09-02.

## Product Contract

- The comparison is nutrition-first. It ranks the selected visible metrics only.
- Each complete row marks the metric winner. Nothing names a universal healthy
  or safe product.
- Evidence quality stays separate from nutrition ranking.
- An alert means an exact-linked tested sample exceeded a comparable screening limit.
- Missing tests and unknown label fields are evidence gaps, not failed tests.
- Product tests never transfer across similar names, brands, ingredients, or formulas.

## Architecture Decisions

1. Keep the feature in the existing Next.js app at `/food`.
2. Reuse `POST /api/public/v1/products/search` and exact product-detail reads.
3. Derive one stable brand hue from the brand name. Do not inspect remote logo
   pixels or store presentation data in the browser. Register imperative WebMCP
   tools through the current browser API and own their lifetime with one
   `AbortController`.
4. Keep comparison state in the page. WebMCP calls the same typed page actions
   so the visible UI and the agent cannot drift into separate implementations.
5. Reuse current contracts and add small pure comparison projections where needed.
6. Commit generated category illustrations as presentation assets. Do not commit
   the local marketing research source archive.
7. Page public search results with a bounded offset. The food comparison asks for
   comparison-ready rows only, while other public product consumers keep their
   current record coverage.
8. Reuse the indexed bounded food-search path for public food queries. Evaluate
   nutrition readiness only after the text search has admitted a bounded candidate
   set, so JSON label inspection never becomes a whole-table scan. Reject
   impossible per-100-gram scales as well as empty and zero-only records.
9. Treat an exact brand-name product as the canonical first result for a brand
   query. Use exact-linked test presence only as a secondary evidence signal;
   do not claim it measures sales or popularity.
10. Rank category comparisons with a dated US Google Shopping brand snapshot.
    Keep database text relevance and comparison readiness as hard gates. Use
    exact-linked test count only after brand rank. Interleave brands across the
    related list. Fall back to the established indexed ranking when the snapshot
    has no matching category.

## Scope

- In scope: `/food`, search and comparison UI, combined evidence
  drawer, empty/loading/error states, category illustrations, WebMCP tools,
  design study, a bounded category-popularity snapshot, share links, tests,
  current docs, browser proof, and PR verification.
- Out of scope: writes, food logging, vault access, personalized advice, a remote
  MCP server, accounts, new data sources, inferred product-test linkage, and a
  universal product or safety score, and runtime AI ingredient grading.

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
- The metric popover explains one compact comparison. One evidence drawer keeps
  coverage, linked results, gaps, and collapsed raw reports in a single place.
- Existing public product APIs remain the data owner. The page owns temporary
  state only. This change adds no service, persistence owner, dependency, score,
  API, repeated mechanism, or parallel data path.

The concepts are one page-local comparison state, pure nutrition and evidence
projections, one comparison table, one metric popover, one combined evidence
drawer, four page-scoped WebMCP registrations, and two existing-style UI
primitives. This
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
6. Run browser proof and focused verification. Keep the PR draft for user testing.
   Defer a new ReviewGPT pass until the user asks for it.

## Verification

- Focused unit and component tests for projections, UI states, and WebMCP lifecycle.
- Existing public-product contract, service, route, and privacy tests.
- Browser proof at phone and desktop widths, including empty and partial data.
- `git diff --check` and the routed frontend verification from the current workflow.
- Exact-head CI and the risk-routed final ReviewGPT gate after user testing.

## Product UX Walkthrough

Result: Ready.

- Desktop visitor: `/food` opens with one search field, three category
  illustrations, and three short examples. The empty state has no page overflow.
- Phone visitor: the same entry stays readable at 390 by 844 pixels. A populated
  comparison keeps row labels visible and scrolls product columns inside the table.
- Complete comparison: the synthetic Chobani, Straus, and Fage study shows one
  quiet winner per metric, a rows-led sentence, and an evidence meter row.
- Detail seeker: a metric opens an opaque ranked-bar popover. Exact tests open a
  right sheet with the alert conclusion first and raw reports collapsed.
- Partial evidence: gaps remain neutral and state that unknown is not a failed
  test. No universal health or safety score appears.
- Failure and recovery: focused tests cover loading, empty results, rate limits,
  private POST search, stale-request cancellation, and bounded WebMCP input.
- Accessibility: empty, populated desktop, and populated phone states passed axe
  WCAG A/AA audits with zero violations and zero incomplete checks.

The implementation matches the approved plan. The browser review found one
semi-transparent popover surface; it now uses the opaque popover token.

Design proof: `/screenshots/health#food-label-lab` renders the real component
with synthetic products, a single-product state, and an empty state.

## Readability Polish (2026-09-03)

- Outcome: the comparison shows products with enough core nutrition to support
  a useful choice, while the drawer gives one-glance ingredient and lab states.
- Reaches: public page navigation and sharing metadata, category search,
  comparison columns, evidence coverage, ingredient review, lab results, and
  data-gap states on desktop and phone.
- Proof: search for Greek yogurt and soda on the live page, inspect complete and
  missing-lab drawers, verify column hover and keyboard focus, then run focused
  tests, type checking, lint, the Impeccable detector, and phone/desktop browser
  checks.
- Deliberate exclusion: do not add a universal health score or a new logo
  provider. Keep evidence states bounded by the available label and screening
  references.

## Redesign Walkthrough (2026-09-02)

Result: Ready, pending coordinator review.

- Search: the field says product, brand, or UPC. Suggestions appear while
  typing, with brand, cleaned name, parsed package size or UPC, and category
  art. Duplicate non-null UPC rows collapse. Arrow keys and Enter pick a row.
- Examples load three exact data-rich records by product reference instead of a
  broad search, because broad search ranks zero-data rows first.
- The table stays visible with one product and keeps a compact add action in
  its header up to ten. Each row states its rule and marks one winner with a
  sage check only.
- Evidence is a five-segment coverage meter that opens one combined drawer:
  coverage, linked-result statuses (not tested, above limit, within limit, no
  comparable limit), DTO gaps, and raw results behind one disclosure.
- Illustrations match name and brand before ingredients; bars beat dairy; an
  honest generic packaged-food asset covers unknown categories.
- Phone width no longer scrolls sideways; the fix contained sr-only spans.
- WebMCP tools still register in a WebMCP-capable Chrome and map both evidence
  views into the one drawer.

## Independent UX Review (2026-09-02)

Result: Ready, with data limits recorded.

A first-time-user review ran both journeys on the live page at 1440 and 390
pixel widths, then finished the protein-bar journey from the public API and the
model projections after the headless screenshot tool hung.

Corrections made:

- The lead sentence names brand and product, because three "MILK" records
  read as "MILK leads 3 of 4 comparable rows." When every product ties it says
  "All 3 products lead 2 of 4 comparable rows." instead of listing three long
  titles.
- The search field shows a visible keyboard focus ring on its wrapper. The
  inner input had its ring removed and the wrapper had none.
- The placeholder no longer repeats the field label.
- Coverage reads "2 of 5 record parts" in the table and drawer, and the meter
  uses a neutral tone, so a full meter does not read as a passed safety score
  beside a sienna alert.
- Category art matches the product name only. Brand words no longer pick the
  art, frozen desserts win over plant milk, and bites use the bar art.
- Package size keeps the pack count, for example "10 × 1.83 oz".
- The evidence drawer fills the phone width.

Coordinator follow-up confirmed the live empty state, one-product table,
three-product comparison, metric popover, combined evidence drawer, phone table
scrolling, phone drawer width, keyboard selection, Escape close behavior, all
four WebMCP tools, and the design-catalog study. The duplicate basis control in
the metric popover was removed. The remaining table control uses native pressed
buttons and passes the accessibility audit.

## User UI Revision (2026-09-02)

Status: completed

- The page keeps one short title, one search field, and a quiet `2M+ foods`
  catalog fact. The fact opens a compact count-and-source popover. The visible
  subtitle, field label, helper sentence, and compact instructional empty row
  were removed.
- The large illustrated empty state returned. Its three data-rich examples sit
  where the table starts, so selecting an example does not shift the page flow.
- Product names and brands are not clamped. Serving mass drops the repeated
  `serving` suffix.
- Metric popovers open on hover and keyboard focus. Touch can still press the
  value. Winner checks sit at the right edge of each value cell.
- Evidence cells show the meter without a visible fraction. The combined
  drawer keeps the exact accessible count and details.
- The blank add column was removed. A compact `Add product` action now sits by
  the nutrition basis control.
- A chosen search phrase stays in the field. The table count now says how many
  products are selected instead of making the full catalog look four items
  wide.
- All-zero nutrition panels no longer create false winners. A record with no
  usable nutrition and no linked lab data is rejected; an evidence-bearing
  record can stay, but its all-zero source panel does not enter nutrition
  ranking.
- The WebMCP note is centered below the main state and uses the official
  ChatGPT browser wording. No unofficial OpenAI badge or logo was added.
- A submitted search compares the first three useful matches. A horizontal
  related-results strip keeps the remaining matches one click away. The table
  accepts up to ten selected products and scrolls horizontally.
- Product headers use Brandfetch Search when the optional client identifier
  exists. The query combines the brand with a broad product category and accepts
  only a matching brand name. Missing logos fall back to local category art. A
  deterministic brand color keeps header tint stable without image analysis or
  browser storage.

Data limits, not UI defects: broad "milk" hits carry no serving mass, so the
per-serving basis shows "Serving mass not reported" in every cell; the page's
own example "RXBAR Strawberry" reaches three untested records rather than the
tested bar; no searched record in the sample carries linked tests, so evidence
appears only through the example sets.

## Comparison Signal Patch (2026-09-02)

- Outcome: a visitor can scan winners and evidence state without reading helper text.
- Reaches: desktop and phone comparison tables, plus the combined evidence drawer.
- Proof: render a normal comparison and an alert-bearing comparison, then check hover,
  keyboard focus, color contrast, and the exact drawer details.

## Brand And Related Results Patch (2026-09-02)

- Outcome: brand marks stay clear while product headers carry a quiet brand tint.
- Category search: the related list removes repeated category words and UPC values,
  then keeps ten alternatives in a compact three-column, vertically scrolling grid.
- Brand search: product titles remain intact when the query is not part of the title.
- Input modes: each related card adds the product; its add label appears on hover or
  keyboard focus, and remains visible on touch devices.
- Logo failure: local category art keeps the deterministic color treatment when a
  Brandfetch result or image is unavailable.

## Search And Table Clarity Patch (2026-09-02)

- A text query can start a category comparison from the first autocomplete option.
  A product row still adds one exact product, and a numeric UPC still finds the exact
  package.
- Broad searches prefer single products. They hide multipacks unless the query asks
  for a pack or count, while exact UPC searches keep all matching package types.
- The comparison table keeps four fixed product slots for one to four products. Empty
  slots remain blank, so removing a product does not resize the remaining columns.
- Evidence uses the same five-part meter as Patterns. Filled parts progress from left
  to right and expose a 0-100 coverage label. Details stay in the existing drawer.
- Sodium and saturated fat extend the comparison with real label data. The UI does
  not invent a naturalness or chemical score without a reviewed ingredient policy.
- Product cards place the product description on a quieter second line. The table
  removes the selected count, add control, and lead sentence.

## Stable Comparison Interaction Patch (2026-09-02)

- Product headers and metric cells open the product drawer. Metric popovers are removed.
- The drawer starts with ingredients and the source, then keeps evidence and data gaps.
- Related results stay in place after selection and change to an `Added` state.
- The related heading says what the visitor can do and omits internal loaded counts.
- One visible `Clear comparison` action clears the current selection and search state.
- The label column stays 148 pixels wide and each product column stays 289 pixels wide.
  A fifth product extends the horizontal table instead of resizing earlier columns.
- The related-product grid preserves the search service's relevance order.
  Linked test counts remain evidence metadata and do not act as popularity.

## Canonical Search And Category Context Patch (2026-09-02)

- Outcome: a brand search starts with the base product instead of a brand extension,
  and further matches continue to use the category the visitor selected.
- Reaches: autocomplete ranking, category comparison, exact-product additions, and
  related-product pagination.
- Proof: the live `snickers` search starts with `Snickers · Snickers`; after starting
  `Protein bars`, typing `snickers` leaves `Add more Protein bars to compare` unchanged.
- Product limit: linked test presence is a secondary evidence signal. It is not called
  popularity because the catalog has no sales, purchase, or broad usage data.

## Related Ranking And Scroll Affordance Patch (2026-09-02)

- Outcome: `Add more` stays inside the selected or derived product category and
  prioritizes exact-linked test presence before the existing relevance order.
- Search split: autocomplete stays relevance-first. Related comparison requests
  use the explicit evidence order across at most 250 deduplicated candidates.
  Test presence ranks first. A reported package size breaks ties before the
  established relevance fields.
- Database load: the evidence check uses the existing `product_tests(food_id)`
  index and never expands the public candidate bound.
- Single-product flow: a recognized food category, such as soda or Greek yogurt,
  seeds related peers after one exact product is selected. Unknown categories
  fall back to the submitted query.
- Horizontal table: four products show no edge effect. From five products, a
  subtle right shadow appears only while hidden columns remain.
- Layout stability: the empty state matches the normal four-product table height,
  so clearing the comparison does not pull following content upward.
- Basis recovery: when no selected record supports per-serving nutrition, that
  basis is disabled and the table returns to per 100 g.

## Popular Category And Evidence Detail Patch (2026-09-03)

- Category searches and `Add more` use a 2026-09-03 US Google Shopping snapshot
  for 342 common food queries. The snapshot stores only compact brand ranks in
  the app. Raw collection files remain outside the committed product source.
- Results stay comparison-ready and category-matched. The database selects a
  bounded candidate set, spreads the first positions across brands, then uses
  exact-linked test count and package data as secondary signals.
- The existing food full-text, name, UPC, brand, and product-test indexes serve
  the query. No new database index or runtime vendor request is required.
- Shared URLs contain selected public product references and the nutrition basis.
  Reloading the URL restores that comparison. The typed query is not included.
- The evidence drawer shows coverage and source in one popover. Ingredients form
  a readable list with source-backed warning tooltips. Lab observations group by
  analyte and use compact status marks before optional exact measurements.
- The drawer does not show a numeric safety score. The available records do not
  provide enough exposure data for a defensible universal score.

## One Murph Note Patch (2026-09-03)

- Core job: tell a visitor, in one glance, which product is the better pick. The
  note uses available nutrition, named ingredient groups, and lab results that
  have a matching screening limit.
- Main journeys: a quick chooser sees only an A-E grade in the table; selecting
  it opens the product drawer; a cautious visitor gets two or three short points;
  a sparse record shows that no grade is available.
- The drawer replaces the separate `Ingredients: Review` and `Lab tests: Not
rated` blocks with one grade and its reasons. It does not repeat source-basis
  copy or unrelated counts for lab results without a health limit.
- Ingredient text uses two compact columns without row dividers. Named items
  keep their source-backed detail popovers. Ingredient groups keep child items
  inside the parent popover, and status icons follow the ingredient name.
- The drawer keeps only `Overview` and `Lab tests`. Known gaps remain available
  inside the evidence-coverage popover. The no-test state uses one `No lab tests`
  message instead of repeating the same fact.
- Four products fit the table without a stray desktop scroll. Extra columns use
  a visible edge fade. Rows get slightly more vertical space.
- Search and example loading keep button sizes fixed. The search field is a bit
  narrower, and the WebMCP note and site footer have more space above them.
- The empty page uses one centered search journey with the food illustration,
  title, database size, and example searches. It has no large empty card.
- After products load, the title becomes compact, the subtitle and illustration
  leave the layout, and the search field shares the header row above the table.
- A lab result without a matching limit does not become a guessed good or bad
  result. It stays outside the verdict and uses the plain label `No health limit`.
  Results with a valid comparison keep `Below limit` or `Above limit`.
- This patch uses deterministic, shared product rules. It adds no model request,
  provider cost, database write, or user-specific medical claim.
- Proof: replay a protein shake with sweeteners and uncomparable PlasticList
  results, a product with an exceeded limit, a clean-label tested product, and a
  sparse product on desktop and phone. Check hover, keyboard, touch, and copy.

## Search And Detail Layout Patch (2026-09-03)

- The empty search journey moves upward while the populated comparison header
  keeps its current position. The suggestion panel stays inside the viewport and
  shows a useful set of matches without covering the full page.
- The database count stays on the subtitle baseline as plain text. Its dotted
  underline remains the only popover affordance.
- Clear comparison moves to the top-right edge of the table. Nutrition basis
  becomes the final table row, after the data it controls.
- Missing nutrition values use one quiet crossed-circle mark. Its tooltip and
  accessible name preserve the exact reason for the missing value.
- Murph grade summary and ingredients use a visible divider. Ingredients flow through two
  independent CSS columns, so a wrapped item does not add space to its neighbor.
- The food page opts into a 1400-pixel footer content width. Other pages keep the
  shared footer's existing 1080-pixel width.
- The open autocomplete raises its whole search section above the comparison
  table. The fifth-product edge fade is wider and becomes opaque sooner, so the
  next horizontal column is clear without adding another control.
Completed: 2026-09-03
