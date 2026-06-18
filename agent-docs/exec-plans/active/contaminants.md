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
        "murphConcernLevel": "high",
        "result": {
          "operator": "eq",
          "value": 12.4,
          "unit": "ng/g",
          "basis": "product_comparable"
        },
        "threshold": {
          "key": "ca_prop65_bpa_v1",
          "authority": "California OEHHA",
          "value": 3.0,
          "unit": "ng/g",
          "basis": "product_comparable"
        },
        "source": {
          "key": "plasticlist",
          "name": "PlasticList",
          "url": "https://...",
          "reportDate": "2023-04-12"
        },
        "testedProduct": {
          "brand": "RXBAR",
          "name": "Chocolate Sea Salt",
          "upc": "012345678905",
          "lot": null,
          "batch": null,
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

  tested_brand TEXT,
  tested_name TEXT,
  tested_upc TEXT,
  tested_lot TEXT,
  tested_batch TEXT,
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
    (food_id IS NOT NULL AND supplement_id IS NULL)
    OR
    (food_id IS NULL AND supplement_id IS NOT NULL)
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
CREATE INDEX product_tests_food_id_idx
  ON product_tests (food_id)
  WHERE food_id IS NOT NULL;

CREATE INDEX product_tests_supplement_id_idx
  ON product_tests (supplement_id)
  WHERE supplement_id IS NOT NULL;

CREATE INDEX product_tests_contaminant_key_idx
  ON product_tests (contaminant_key);

CREATE INDEX product_tests_report_date_idx
  ON product_tests (report_date DESC)
  WHERE report_date IS NOT NULL;
```

Why the two nullable FKs are acceptable: they preserve real referential integrity against the existing `foods` and `supplements` tables. A generic `product_kind/product_id` pair would be prettier but weaker.

### `contaminant_thresholds`

One row = one active comparable threshold.

```sql
CREATE TABLE contaminant_thresholds (
  id TEXT PRIMARY KEY,

  contaminant_key TEXT NOT NULL,
  authority_key TEXT NOT NULL,
  authority_name TEXT NOT NULL,
  threshold_name TEXT NOT NULL,
  threshold_url TEXT,

  threshold_value NUMERIC NOT NULL,
  threshold_unit TEXT NOT NULL,
  threshold_basis TEXT NOT NULL,

  concern_level_if_exceeded TEXT NOT NULL,

  effective_date DATE,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  active BOOLEAN NOT NULL DEFAULT true,

  CHECK (btrim(id) <> ''),
  CHECK (btrim(contaminant_key) <> ''),
  CHECK (contaminant_key ~ '^[a-z][a-z0-9_]*$'),
  CHECK (btrim(authority_key) <> ''),
  CHECK (authority_key ~ '^[a-z][a-z0-9_]*$'),
  CHECK (btrim(authority_name) <> ''),
  CHECK (btrim(threshold_name) <> ''),
  CHECK (threshold_value >= 0),
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
CREATE INDEX contaminant_thresholds_lookup_idx
  ON contaminant_thresholds (
    contaminant_key,
    threshold_unit,
    threshold_basis
  )
  WHERE active = true;

CREATE UNIQUE INDEX contaminant_thresholds_active_identity_idx
  ON contaminant_thresholds (
    contaminant_key,
    authority_key,
    threshold_name,
    threshold_unit,
    threshold_basis
  )
  WHERE active = true;
```

No chemical registry table. No jurisdiction abstraction. No threshold versioning table. Add those only when real threshold data proves the two-table model is insufficient.

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
4. A test with `lt`, `lte`, `not_detected`, `detected`, or `trace`, or a `gt` / `gte` lower bound that does not prove exceedance, is displayable evidence, but it does not produce `none`, `low`, `medium`, or `high` in v1. It stays `unknown` unless another exact comparable row exists for that product.
5. If multiple comparable thresholds are exceeded, choose the highest:

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

8. If comparable tests exist and none exceed active thresholds:

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
- `exact_source_id`: the test source identifies a product that maps directly to one selected label row by stable source identity.
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

Also add a tiny operator script or README command that applies the schema to the labels database without printing the DB URL.

Rollout rule: apply this schema to the shared labels DB before web code starts attaching contaminants. Runtime label lookup requires `MURPH_LABELS_DB_URL`; do not add runtime table-existence probing, compatibility branches, or `MURPH_SUPPLEMENT_DB_URL` fallback behavior.

Review alignment: the live architecture and hosted web docs must state the same
runtime precondition: both `/api/foods` and `/api/supplements` require the
shared `MURPH_LABELS_DB_URL`. `MURPH_SUPPLEMENT_DB_URL` is not a runtime
fallback.

Update architecture docs:

```text
Product contaminant data is exact-product, displayable, read-only external data attached to /api/foods and /api/supplements responses by default. No category, brand-only, fuzzy, candidate, or restricted/paywalled rows are stored.
```

### PR 2 - read integration, CLI schema, and prompt

Add contaminant summary attachment to `product-labels.ts`.

Update CLI hosted label schemas so the assistant can see `contaminants`.

Update the assistant prompt with the single rule block.

Implementation note, 2026-06-18: hosted web production builds run a product
label preflight before `next build`; it requires `MURPH_LABELS_DB_URL` and
verifies the `product_tests` / `contaminant_thresholds` columns used by label
lookup before serving the contaminant-aware routes. CLI single-label lookup now
keeps exact-id/UPC policy on the server route by sending one `q` request, same
as batch lookup, instead of duplicating the id/upc fallback order client-side.

Tests:

- no tests -> `status=no_known_product_tests`, `murphConcernLevel=unknown`;
- test with no comparable threshold -> `known_product_tests`, `unknown`;
- exact comparable test below threshold -> `known_product_tests`, `none`;
- exact comparable test above threshold -> `known_product_tests`, `high`;
- censored/non-alerting bounded test rows stay `unknown`;
- food and supplement rows both work;
- exact `id`, exact `upc`, search, and batch responses include contaminants;
- alerts are capped and ordered.

### PR 3 - first curated import

Start with a curated CSV or NDJSON import for safe, displayable product-level data.

Implementation note, 2026-06-17: bulk contaminant CSV snapshots are not committed.
Local generated/import-ready files live under `.product-tests-work/seed-data/`
and are gitignored. The repository keeps the schemas, import runners, curated
PlasticList remaps, and small brand-site label anchors; operators pass explicit
repo-relative CSV paths when reloading open-source rows or thresholds.

Required fields:

```text
food_id or supplement_id
source_key
source_result_id
source_name
source_url
report_date
tested_brand
tested_name
tested_upc
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

Import thresholds separately as rows in `contaminant_thresholds`.

No scraper until curated rows prove product value.

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
