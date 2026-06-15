# Exact Product Contaminants

## Decision

Keep `/api/foods` and `/api/supplements` as the only lookup API. Add exact-product contaminant summaries to those responses by default.

Use two data tables:

- `product_tests`
- `contaminant_thresholds`

Do not add a separate endpoint, category evidence, brand-level evidence, fuzzy matching, candidate matching, restricted/paywalled rows, or a scraper in the first version.

## Verified Against Current Code

- `apps/web/src/lib/product-labels.ts` already owns the shared food/supplement query engine. It selects product identity first, then returns label rows. Contaminants can attach after selection without changing search ranking.
- `apps/web/src/lib/product-labels-route.ts` is generic over item shape and already serves exact `id`, exact `upc`, search, and batch search through the same handlers.
- `apps/cloudflare/src/runner-egress-intercept.ts` already allowlists only `/api/foods` and `/api/supplements` for hosted data API egress.
- `packages/cli/src/hosted-data-api-labels.ts` already centralizes the hosted label response schema for both food and supplement commands.
- `packages/assistant-engine/src/assistant/system-prompt.ts` already tells the assistant to use food/supplement label lookup for fridge, pantry, product, and supplement flows.
- `apps/web/sql/foods/schema.sql` and `apps/web/sql/supplements/schema.sql` already keep labels in one table each with stable `id` values. Real foreign keys from `product_tests` to those tables are worth the small nullable-FK ugliness.
- The PlasticList TSV has stable PlasticList `product_id` and sample `id` fields but no UPCs. The maintainable exact-link path is to import one PlasticList-backed `foods` row per PlasticList product id, then link every contaminant result to that food row with `match_method = exact_source_id`. Do not name-match PlasticList rows to existing USDA/FDC rows.

## Product Behavior

When the assistant scans a fridge or pantry, it already calls:

```text
food search-labels-batch
supplement search-labels-batch
```

Those results should include a small contaminant summary:

```json
{
  "id": "fdc:123",
  "name": "RXBAR Chocolate Sea Salt",
  "brand": "RXBAR",
  "upc": "012345678905",
  "dataOrigin": "usda_branded",
  "dataOriginId": "123",
  "offMarket": false,
  "label": { "...": "..." },
  "contaminants": {
    "status": "known_product_tests",
    "murphConcernLevel": "high",
    "alertCount": 1,
    "alerts": [
      {
        "contaminantKey": "bpa",
        "contaminantName": "Bisphenol A",
        "concernLevel": "high",
        "result": {
          "operator": "eq",
          "value": 12.4,
          "unit": "ng/g",
          "basis": "product_mass"
        },
        "threshold": {
          "authority": "California OEHHA",
          "name": "Bisphenol A",
          "value": 3.0,
          "unit": "ng/g",
          "basis": "product_mass",
          "url": "https://..."
        },
        "source": {
          "key": "plasticlist_bay_area_2024",
          "name": "PlasticList",
          "url": "https://...",
          "reportTitle": "Data on Plastic Chemicals in Bay Area Foods",
          "reportDate": null
        },
        "testedProduct": {
          "brand": "RXBAR",
          "name": "Chocolate Sea Salt",
          "upc": "012345678905",
          "sourceProductId": "79",
          "matchMethod": "exact_upc"
        }
      }
    ]
  }
}
```

For products with no known exact product-level tests:

```json
"contaminants": {
  "status": "no_known_product_tests",
  "murphConcernLevel": "unknown",
  "alertCount": 0,
  "alerts": []
}
```

Good assistant language:

> This exact product has a 2023 product-level BPA test with a high Murph concern level. I would consider swapping it. This does not prove every current package has the same level.

Bad assistant language:

> No result found, therefore it is safe.

## API Shape

Keep only:

```text
GET /api/foods
POST /api/foods
GET /api/supplements
POST /api/supplements
```

Do not add `/api/product-tests`.

Implementation shape:

```text
getById/getByUpc/search
  -> existing label lookup
  -> attach contaminant summaries for returned ids
  -> return same item shape plus contaminants
```

Attach contaminants with one extra bounded DB query for the selected ids. Do not join contaminant facts into the search SQL. Search ranks product identity; contaminants annotate selected results.

The attachment must cover exact `id`, exact `upc`, normal search, and batch search. The current route factory returns whatever the query layer returns for all of those paths.

## Minimal Schema

### `product_tests`

One row = one contaminant result for one exact food or supplement product.

Every row must link to exactly one `foods.id` or `supplements.id`. For
PlasticList, the importer creates source-backed `foods` rows with ids shaped
like `plasticlist_bay_area_2024:<product_id>` before inserting linked tests.

```sql
CREATE TABLE product_tests (
  id TEXT PRIMARY KEY,

  food_id TEXT REFERENCES foods(id),
  supplement_id TEXT REFERENCES supplements(id),

  source_key TEXT NOT NULL,
  source_result_id TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_url TEXT,
  source_report_title TEXT,
  report_date DATE,

  tested_product_name TEXT,
  tested_product_brand TEXT,
  tested_product_upc TEXT,
  tested_source_product_id TEXT,
  match_method TEXT NOT NULL,

  contaminant_key TEXT NOT NULL,
  contaminant_name TEXT NOT NULL,

  result_operator TEXT NOT NULL,
  result_value NUMERIC,
  result_unit TEXT NOT NULL,
  result_basis TEXT NOT NULL DEFAULT 'as_reported',

  normalized_value NUMERIC,
  normalized_unit TEXT,
  normalized_basis TEXT,

  lab_name TEXT,
  test_method TEXT,

  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (source_key, source_result_id, contaminant_key),

  CHECK (btrim(id) <> ''),
  CHECK (btrim(source_key) <> ''),
  CHECK (source_key ~ '^[a-z][a-z0-9_]*$'),
  CHECK (btrim(source_result_id) <> ''),
  CHECK (btrim(source_name) <> ''),
  CHECK (btrim(contaminant_key) <> ''),
  CHECK (contaminant_key ~ '^[a-z][a-z0-9_]*$'),
  CHECK (btrim(contaminant_name) <> ''),
  CHECK (btrim(result_unit) <> ''),
  CHECK (btrim(result_basis) <> ''),

  CHECK (
    (
      CASE WHEN food_id IS NULL THEN 0 ELSE 1 END
      + CASE WHEN supplement_id IS NULL THEN 0 ELSE 1 END
    ) = 1
  ),

  CHECK (
    match_method IN (
      'exact_upc',
      'exact_source_id',
      'manual_confirmed'
    )
  ),

  CHECK (
    result_operator IN (
      'eq',
      'lt',
      'lte',
      'gt',
      'gte',
      'not_detected',
      'detected',
      'trace'
    )
  ),

  CHECK (
    result_operator NOT IN ('eq', 'lt', 'lte', 'gt', 'gte')
    OR result_value IS NOT NULL
  ),

  CHECK (result_value IS NULL OR result_value >= 0),
  CHECK (normalized_value IS NULL OR normalized_value >= 0),

  CHECK (
    (normalized_value IS NULL AND normalized_unit IS NULL AND normalized_basis IS NULL)
    OR
    (
      normalized_value IS NOT NULL
      AND normalized_unit IS NOT NULL
      AND normalized_basis IS NOT NULL
      AND btrim(normalized_unit) <> ''
      AND btrim(normalized_basis) <> ''
    )
  )
);
```

Indexes:

```sql
CREATE INDEX product_tests_food_idx
  ON product_tests (food_id)
  WHERE food_id IS NOT NULL;

CREATE INDEX product_tests_supplement_idx
  ON product_tests (supplement_id)
  WHERE supplement_id IS NOT NULL;

CREATE INDEX product_tests_contaminant_idx
  ON product_tests (contaminant_key);

CREATE INDEX product_tests_report_date_idx
  ON product_tests (report_date)
  WHERE report_date IS NOT NULL;
```

Why the two nullable FKs are acceptable: they preserve real referential integrity against the existing `foods` and `supplements` tables. A generic `product_kind/product_id` pair would be prettier but weaker.

### `contaminant_thresholds`

One row = one active comparable threshold.

```sql
CREATE TABLE contaminant_thresholds (
  id TEXT PRIMARY KEY,

  contaminant_key TEXT NOT NULL,
  contaminant_name TEXT NOT NULL,
  authority_key TEXT NOT NULL,
  authority_name TEXT NOT NULL,
  authority_url TEXT,

  threshold_value NUMERIC NOT NULL,
  threshold_unit TEXT NOT NULL,
  threshold_basis TEXT NOT NULL,

  concern_level_if_exceeded TEXT NOT NULL,

  effective_on DATE,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  active BOOLEAN NOT NULL DEFAULT true,

  CHECK (btrim(id) <> ''),
  CHECK (btrim(contaminant_key) <> ''),
  CHECK (contaminant_key ~ '^[a-z][a-z0-9_]*$'),
  CHECK (btrim(contaminant_name) <> ''),
  CHECK (btrim(authority_key) <> ''),
  CHECK (authority_key ~ '^[a-z][a-z0-9_]*$'),
  CHECK (btrim(authority_name) <> ''),
  CHECK (authority_url IS NULL OR btrim(authority_url) <> ''),
  CHECK (threshold_value > 0),
  CHECK (btrim(threshold_unit) <> ''),
  CHECK (btrim(threshold_basis) <> ''),

  CHECK (
    concern_level_if_exceeded IN (
      'low',
      'medium',
      'high'
    )
  )
);
```

Indexes:

```sql
CREATE UNIQUE INDEX contaminant_thresholds_active_comparable_idx
  ON contaminant_thresholds (
    contaminant_key,
    threshold_unit,
    threshold_basis
  )
  WHERE active = true;
```

No chemical registry table. No jurisdiction abstraction. No threshold versioning table. V1 allows only one active comparable threshold per `contaminant_key + threshold_unit + threshold_basis`; add multi-authority threshold selection only when real threshold data proves that complexity is needed.

## Concern Normalization

The API computes `murphConcernLevel` at read time.

Simple deterministic rule:

1. A product has tests when at least one `product_tests` row exists for its selected `food_id` or `supplement_id`.
2. A test is threshold-comparable only when:
   - `result_operator` is `eq`, or a lower-bound `gt` / `gte` result whose bound proves threshold exceedance
   - `normalized_value IS NOT NULL`
   - `normalized_unit = threshold_unit`
   - `normalized_basis = threshold_basis`
   - `contaminant_key` matches
   - threshold is active
3. A comparable `eq` test exceeds a threshold only when `normalized_value > threshold_value`. A `gt` lower bound proves exceedance when `normalized_value >= threshold_value`; a `gte` lower bound proves exceedance when `normalized_value > threshold_value`.
4. A test with `lt`, `lte`, `not_detected`, `detected`, or `trace`, or an ambiguous `gt` / `gte` lower bound, is stored as exact product evidence, but it does not produce `none`, `low`, `medium`, or `high` in v1 and does not appear in the bounded alert list. The summary stays `unknown` unless another exact comparable row exists for that product.
5. Because v1 permits one active comparable threshold per `contaminant_key + unit + basis`, a single test row can produce at most one alert. Across multiple exact test rows, choose the highest concern level:

```text
high > medium > low > none > unknown
```

6. If tests exist but none are comparable:

```text
status = "known_product_tests"
murphConcernLevel = "unknown"
```

7. If no tests exist:

```text
status = "no_known_product_tests"
murphConcernLevel = "unknown"
```

8. If tests exist, every exact test row is comparable, and none exceed active thresholds:

```text
status = "known_product_tests"
murphConcernLevel = "none"
```

The API does no unit conversion. Ingestion normalizes test values and thresholds into comparable units and bases. If ingestion cannot normalize confidently, it leaves `normalized_value` null and the API returns `unknown`.

This is intentionally conservative. It avoids false reassurance from censored results and keeps runtime logic small.

## Alert Shape

Keep the response bounded.

- `alertCount` means the total number of returned alert rows after threshold comparison, not every stored test row.
- `alerts` contains at most 5 rows.
- Sort alerts by concern level descending, then `report_date DESC NULLS LAST`, then `contaminant_key ASC`, then `source_key ASC`.
- Rows with `murphConcernLevel = "none"` are not alerts.
- Rows with `murphConcernLevel = "unknown"` are not alerts in v1. The product-level `status` still tells the assistant that tests exist.

If later users need to inspect every test row, add an explicit detail surface then. Do not build it for the first version.

## Matching Rule

Only import rows that attach to exactly one product.

Allowed:

```text
exact_upc
exact_source_id
manual_confirmed
```

Definitions:

- `exact_upc`: the tested UPC exactly matches one selected `foods.upc` or `supplements.upc` row.
- `exact_source_id`: the test source identifies a product that maps directly to one selected label row by stable source identity. For PlasticList, the selected label row is the PlasticList-backed `foods` row imported from that source product id.
- `manual_confirmed`: a human reviewed the source row and selected exactly one `food_id` or `supplement_id`; the import row still stores tested brand/name/UPC and source URL for auditability.

Disallowed:

```text
category
brand
product line
ingredient
fuzzy name
candidate match
probably this
```

Do not model uncertainty in v1. Refuse uncertain rows.

If a source says this exact UPC/product had BPA, import it.

If a source says protein bars often have BPA, do not import it.

If a source says Brand X products had BPA but not the exact product, do not import it.

## Source Policy

Only import displayable row-level product-test facts.

Do not store paywalled redistribution, source text copies, screenshots, full report tables, private URLs, or "we know but cannot show you" rows.

This deletes the need for:

```text
display_policy
source_access
restricted_source_count
internal_review_only
```

MVP rule:

> If Murph cannot show the measured product-level result to the user, it does not go in `product_tests`.

Future licensed data can add fields later if needed. Do not pay that complexity tax now.

## Code Changes

### `apps/web/src/lib/product-labels.ts`

Extend `ProductLabelSearchItem`:

```ts
export type ProductLabelSearchItem = {
  id: string;
  dataOrigin: string;
  dataOriginId: string;
  name: string;
  brand: string | null;
  upc: string | null;
  offMarket: boolean;
  label: unknown;
  contaminants: ProductContaminantSummary;
};
```

Add one internal helper:

```ts
attachProductContaminantSummaries(table, items)
```

It should:

- take selected food/supplement ids;
- query `product_tests` for those ids;
- join exact-comparable rows to `contaminant_thresholds`;
- compute `murphConcernLevel`;
- attach bounded alerts and default empty summaries.

Keep the helper internal. Do not add a new API client.

### `/api/foods` and `/api/supplements`

Same routes. Same auth. Same request shape.

Only response items gain:

```json
"contaminants": { "...": "..." }
```

### CLI

Update the existing hosted label response schema to include optional `contaminants`.

No new command.

The assistant already calls food/supplement label search. The contaminant summary rides along.

### Assistant Prompt

Add one rule block:

```text
Food/supplement label search results include product-level contaminant summaries when Murph has exact displayable test evidence. Use those summaries in fridge/pantry scans and product comparisons. Do not infer safety from no known tests. Do not make category, brand-level, or toxicology claims. Say "Murph concern level" rather than "toxic" or "safe."
```

No new tool instructions.

## Rollout Plan

### PR 1 - schema and operator path

Add:

```text
apps/web/sql/product-tests/schema.sql
```

Include:

```text
product_tests
contaminant_thresholds
```

Also add a tiny operator script or README command that applies the schema to the labels database without printing the DB URL or passing it through `psql` argv.

Rollout rule: apply the `foods`, `supplements`, then `product_tests` schemas to every configured shared label DB before web code starts attaching contaminants. For a legacy supplement-only DB still used through `MURPH_SUPPLEMENT_DB_URL`, run the schema-only helper with that legacy URL temporarily assigned to `MURPH_LABELS_DB_URL` and pass `--legacy-supplement-db`; that mode creates only the minimal food FK target plus `product_tests` and avoids food search extensions. Do not add runtime table-existence probing or compatibility branches.

Update architecture docs:

```text
Product contaminant data is exact-product, displayable, read-only external data attached to /api/foods and /api/supplements responses by default. No category, brand-only, fuzzy, candidate, or restricted/paywalled rows are stored.
```

### PR 2 - read integration, CLI schema, and prompt

Add contaminant summary attachment to `product-labels.ts`.

Update CLI hosted label schemas so the assistant can see `contaminants`.

Update the assistant prompt with the single rule block.

Tests:

- no tests -> `status=no_known_product_tests`, `murphConcernLevel=unknown`;
- test with no comparable threshold -> `known_product_tests`, `unknown`;
- exact comparable test below threshold -> `known_product_tests`, `none`;
- exact comparable test above threshold -> `known_product_tests`, `high`;
- censored/non-eq test rows stay `unknown`;
- food and supplement rows both work;
- exact `id`, exact `upc`, search, and batch responses include contaminants;
- alerts are capped and ordered.

### PR 3 - first curated import

Start with the PlasticList TSV import for safe, displayable product-level data.
The importer creates PlasticList-backed `foods` rows only when at least one
generated `product_tests` row links to that exact source-backed food id.
Optional curated remap TSVs can move individual sample rows to a pre-existing
exact Murph `food_id` or `supplement_id`; fully remapped products rely on the
existing target row instead of creating an orphan PlasticList placeholder. The
default import is fully linked and does not use fuzzy matching.

Required fields:

```text
food_id or supplement_id
source_key
source_result_id
source_name
source_url
report_date
tested_product_brand
tested_product_name
tested_product_upc
tested_source_product_id
match_method
contaminant_key
contaminant_name
result_operator
result_value
result_unit
result_basis
normalized_value
normalized_unit
normalized_basis
```

Import thresholds separately as curated rows in `contaminant_thresholds`.
PlasticList percent-of-threshold columns stay source data; v1 Murph threshold
comparison uses explicit `contaminant_thresholds` rows only. Until curated
threshold rows exist, PlasticList products return exact `known_product_tests`
evidence with an `unknown` Murph concern level and no alerts.

No scraper until curated rows prove product value.

## Implemented Shape And Verification

Implemented as one small product-test schema plus one bounded annotation query:

- `apps/web/sql/product-tests/schema.sql` owns `product_tests` and `contaminant_thresholds`.
- `apps/web/sql/product-tests/import-plasticlist.sh` applies schemas, prepares PlasticList TSV rows, creates PlasticList-backed `foods` rows, and imports `product_tests`.
- `/api/foods` and `/api/supplements` keep their existing lookup behavior, then attach contaminant summaries for the exact selected ids only.
- `packages/cli` accepts optional `contaminants` so older hosted responses remain compatible.
- The assistant prompt treats contaminant data as exact-product evidence only.

PlasticList dry-run proof against the supplied TSV:

```text
PlasticList food rows: 236
PlasticList product_tests rows: 11739
Missing product links: 0
Double product links: 0
Default match method: exact_source_id
```

The dry run used a fake `psql` command because no labels database URL was
available in the local environment. A real production import still requires
running the helper with `MURPH_LABELS_DB_URL` set to the target labels DB URL.

Security/privacy hardening verified:

- no database URL is passed to `psql` argv;
- inherited `PG*` env values are scrubbed before import;
- credentials are passed through a temporary `PGPASSFILE`;
- malformed DB URLs produce only a generic error;
- `psql` runs with `-X` so local startup files are ignored;
- paths passed to `psql` are repo-relative.

Verification completed:

```text
bash -n apps/web/sql/product-tests/import-plasticlist.sh
pnpm --dir apps/web test:prepared -- apps/web/test/product-tests-schema.test.ts apps/web/test/supplements-lib.test.ts apps/web/test/foods-lib.test.ts
pnpm --dir packages/assistant-engine test -- test/model-behavior.test.ts
pnpm --dir packages/cli test:source -- packages/cli/test/food-labels.test.ts
pnpm typecheck
pnpm test:diff
git diff --check
```

Completion audits completed with no remaining blocking, high, or medium
findings after fixes.

ReviewGPT follow-up fixes:

- active thresholds are unique per comparable `contaminant_key + unit + basis`;
- `report_date` is cast to text at the SQL boundary;
- missing contaminant schema fails with a named configuration error;
- hosted label lookup defaults to 5 results so source-backed evidence can
  appear beside nutrition/label rows;
- `gt` / `gte` lower bounds alert only when they prove threshold exceedance;
- fully remapped PlasticList products do not create orphan source-backed
  `foods` rows;
- PlasticList import SQL runs in one transaction and deletes stale source rows
  absent from the current prepared input only when `--replace-source` is passed;
- legacy supplement schema-only mode creates a column-compatible `foods` table
  without food search extensions;
- assistant prompt text matches the new hosted label lookup default;
- PlasticList import preparation now refuses zero-row test imports before
  database writes, rejects curated remap sample ids missing from the source
  TSV, and CSV-escapes quoted generated fields for Postgres `\copy`;
- product label routes return the route-specific unconfigured error for missing
  contaminant schema instead of a generic label lookup failure;
- PlasticList reruns preserve existing product-test link targets unless the
  current row comes from an explicit matches TSV, use per-run prepared files, and
  tolerate BOM/CRLF headers in downloaded TSV exports;
- source-backed PlasticList `foods` rows are stable FK anchors hidden from
  generic food text search, and the importer fails on existing identity
  mismatches instead of rewriting food IDs on upsert.

## Final Architecture

```text
foods / supplements
  existing label lookup
        |
        | selected exact product ids
        v
product_tests
  displayable exact-product contaminant measurements
        |
        | contaminant_key + normalized unit/basis
        v
contaminant_thresholds
  active comparable limits
        |
        v
/api/foods and /api/supplements
  label result + contaminant summary by default
        |
        v
assistant fridge scan
  "This exact product has a high Murph concern level for BPA from a 2023 test."
```

This keeps the user-facing behavior, avoids a separate API, preserves the hosted lookup boundary, and keeps future complexity out until real data proves it is needed.
Status: completed
Updated: 2026-06-15
Completed: 2026-06-15
