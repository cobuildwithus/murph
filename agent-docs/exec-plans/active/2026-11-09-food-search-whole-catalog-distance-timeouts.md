# Stop food label search timeouts from whole-catalog name-distance scans

Status: active
Created: 2026-11-09
Updated: 2026-11-09

## Goal

- Private food label search returns a match or no match instead of HTTP 500
  when the query has no full-text match or matches at least 10,000 rows, so
  meal logging keeps label-backed nutrition for packaged items.

## Success criteria

- The cause of the production `foods_api_failed` responses is proven against
  runtime evidence and a real catalog plan.
- No food search statement orders the whole catalog by name distance.
- Representative synthetic searches of both failing classes finish inside the
  unchanged eight-second statement timeout on the configured labels database.
- Focused Web tests, the real-PostgreSQL search suite, and typecheck pass.

## Scope

- In scope: private food-name search SQL in `apps/web/src/lib/product-labels.ts`,
  its unit and PostgreSQL coverage, the owning architecture and README text,
  and the member-facing changelog.
- Out of scope: indexes, schema, imports, the statement timeout, retries, CLI
  error semantics, assistant prompts, supplement search, and ranking order
  within an admitted set.

## Constraints

- Technical constraints: keep the pool, indexes, eight-second timeout, exact
  ID and UPC paths, and the 250 exact-name and 10,000 full-text admissions.
- Product/process constraints: synthetic queries only in durable artifacts;
  read-only access to the configured labels database.

## Risks and mitigations

1. Risk: a saturated full-text search loses its nearest-name supplement.
   Mitigation: that supplement never completed on the live catalog, so every
   such search already failed. Exact names keep their own lane and still rank
   first.
2. Risk: typo recovery ranks within 1,000 names instead of 10,000.
   Mitigation: the page holds at most 50 results, whole-name matches are read
   nearest first, and a 10,000-row read alone costs over six seconds cold.
3. Risk: the planner serves the similarity predicate from the lossy GIN name
   index and rechecks tens of thousands of rows.
   Mitigation: the small ordered limit makes the pruned GiST scan the cheapest
   path; the live plans were inspected and the PostgreSQL test asserts the
   index condition and the bounded row count.

## Tasks

1. Correlate the feedback with production request and runtime logs.
2. Reproduce both failing classes and profile them on the configured labels
   database.
3. Remove the saturated nearest-name scan; make typo recovery an
   index-condition scan with a 1,000-row bound and a gated strict-word lane.
4. Update tests and owning docs, verify, and ship.

## Decisions

- Evidence: in the seven days to 2026-11-09 the route served 31 requests and 9
  returned HTTP 500. All 9 logged PostgreSQL `57014` at stage `search_rows`
  after 8.0 seconds, including the two retries the feedback describes.
- Root cause: two branches order the whole two-million-row catalog by trigram
  distance and filter afterwards. On the configured labels database a search
  with no full-text match took 19.6 to 22.6 seconds and a saturated one passed
  30 seconds, so every search in either class failed deterministically.
- Saturated full-text: delete the nearest-name supplement and rank the bounded
  admission. No cheap index path returns the nearest names for a common term.
- No full-text match: keep the same GiST index but pass the whole-name
  similarity threshold as its index condition and read the 1,000 nearest
  eligible names. Each fetched row costs about 0.55 ms cold on the live
  database (10,000 rows 6.4 s, 2,500 rows 2.4 s, 1,000 rows 1.3 s).
- Strict-word recovery moves to its own lane that runs only when no whole name
  is similar. Its index matches are lossy (one probe rechecked 24,474 of
  26,716 rows), so it must not run beside a whole-name result that already
  outranks it.
- The lossy GIN name index is unsafe for the whole-name predicate: one probe
  rechecked 88,693 rows in 16.4 seconds. The ordered, bounded scan avoids it.
- ReviewGPT: not eligible. The change is read-only query shape behind an
  unchanged internal route, with no state, schema, auth, or deploy boundary.

## Product UX Patch

- Outcome: a meal-logging turn that looks up a packaged item gets a label
  match or an honest no-match instead of a service failure.
- Reaches: private assistant turns that call `food search-labels` or
  `food search-labels-batch`. No new audience, surface, or data source.
- Walkthrough: `Ready`. On the configured labels database under the
  production timeout, 40 synthetic searches across exact, branded, unknown
  brand, typo, saturated, generic-only and no-match cases all returned in 0.2
  to 3.5 seconds; the two failing classes fell from over 20 seconds to 1.3 to
  3.5 seconds.

## Verification

- `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage
  apps/web/test/supplements-search-postgres.test.ts
  apps/web/test/foods-lib.test.ts apps/web/test/foods-route.test.ts` with a
  loopback `MURPH_SUPPLEMENT_SEARCH_TEST_DB_URL`: 208 passed. The same tests
  against the base source fail in the SQL-shape, typo-bound, and large-catalog
  cases.
- Read-only timing and `EXPLAIN (ANALYZE, BUFFERS)` on the configured labels
  database before and after the change, as recorded above.
- `pnpm --dir apps/web typecheck` and focused ESLint.
