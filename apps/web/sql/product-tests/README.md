# Product Test Imports

`product_tests` stores contaminant test observations for source-identified
products. A row is either linked to exactly one real Murph food/supplement label
by exact UPC, exact source id, or manual confirmation, or it remains
`source_only` with no product link. The hosted label APIs attach contaminant
summaries only for linked rows and never infer contaminants from names, brands,
tags, categories, or fuzzy matches.

## PlasticList

PlasticList data is licensed under CC BY 4.0. You may freely share and adapt it
with attribution.

Citation:

PlasticList. "Data on Plastic Chemicals in Bay Area Foods". plasticlist.org.
Accessed Jun 14, 2026.

BibTeX:

```bibtex
@misc{PlasticListBayArea2024,
  title = {Data on Plastic Chemicals in Bay Area Foods},
  author = {{PlasticList}},
  year = {2024},
  url = {https://plasticlist.org},
  note = {Jun 14, 2026}
}
```

Import with:

```sh
PLASTICLIST_SAMPLES_TSV_PATH=/path/to/samples.tsv \
MURPH_LABELS_DB_URL=postgres://... \
apps/web/sql/product-tests/import-plasticlist.sh
```

The default import is upsert-only. To intentionally remove PlasticList test
rows absent from a known-complete prepared input, pass `--replace-source`:

```sh
PLASTICLIST_SAMPLES_TSV_PATH=/path/to/samples.tsv \
PLASTICLIST_REPLACE_SOURCE_EXPECTED_PRODUCT_TEST_ROWS=1234 \
MURPH_LABELS_DB_URL=postgres://... \
apps/web/sql/product-tests/import-plasticlist.sh --replace-source
```

Apply schemas only with:

```sh
MURPH_LABELS_DB_URL=postgres://... \
apps/web/sql/product-tests/import-plasticlist.sh --schema-only
```

For a legacy supplement-only database that still needs one-time contaminant
schema preparation before migration to the shared labels database, run the same
schema-only command with that legacy URL temporarily assigned to
`MURPH_LABELS_DB_URL`:

```sh
MURPH_LABELS_DB_URL=postgres://... \
apps/web/sql/product-tests/import-plasticlist.sh --schema-only --legacy-supplement-db
```

The legacy flag assumes the database already has the `supplements` table. It
adds a column-compatible `foods` foreign-key target plus `product_tests`,
avoiding food search indexes and extensions. Runtime label lookup now requires
the shared `MURPH_LABELS_DB_URL`; `MURPH_SUPPLEMENT_DB_URL` is not a runtime
fallback for contaminant-aware code.

Import scripts keep `MURPH_LABELS_DB_URL` out of `psql` argv and logs. When the
URL uses `sslrootcert=system`, the helper translates that setting to a readable
local CA bundle for `psql` builds that do not understand the `system` shortcut.

The import creates `source_only` PlasticList `product_tests` rows with no
`foods` or `supplements` link. It is intentionally not a product-matching
interface. To attach known exact matches to pre-existing Murph label rows, use
the reviewed remap importer:

```sh
PRODUCT_TEST_REMAPS_TSV_PATH=apps/web/sql/product-tests/remaps/plasticlist-reviewed.tsv \
MURPH_LABELS_DB_URL=postgres://... \
apps/web/sql/product-tests/import-product-test-remaps.sh
```

No PlasticList product creates a source-backed label row; evidence attaches to a
catalog product only through the explicit reviewed remap target.

PlasticList source column aliases are mapped to Murph canonical
`contaminant_key` values during import, for example `BPA_ng_g` becomes
`bisphenol_a_bpa` and `DEHP_ng_g` becomes
`di_2_ethylhexyl_phthalate_dehp`. Source-specific abbreviations stay at the
import boundary; threshold comparison uses the canonical key plus exact unit
and basis matches.

Existing product-test link targets are preserved on default reruns only while
the refreshed source row still names the same source product id, tested product
name, tested brand, and tested UPC. If a source refresh reuses a result id for
a different tested source product, the row is repaired back to `source_only`
before the new source facts are applied. Any
legacy contaminant-source-backed product link is also repaired back to
`source_only` by the schema before source-backed placeholder cleanup runs. With
`--replace-source`, the complete prepared source input is authoritative and all
imported PlasticList rows move back to `source_only`; reapply reviewed remaps
after that source refresh.

Reruns are additive by default: current rows are inserted or updated without
pruning older PlasticList evidence. `--replace-source` makes the import
convergent for a complete source export by removing PlasticList test rows absent
from the prepared input. Because that mode is destructive, it also requires
`PLASTICLIST_REPLACE_SOURCE_EXPECTED_PRODUCT_TEST_ROWS` to match the prepared
product-test row count before any SQL runs. Legacy source-backed PlasticList
`foods` rows with no remaining tests are deleted on every import. To avoid
accidental source-wide deletion from a bad export, the runner refuses to apply
any SQL import when the prepared PlasticList test file contains zero data rows.

The PlasticList import loads exact measured product evidence. It does not insert
threshold rows; concern alerts require separate curated `contaminant_thresholds` rows.
Linked products return `known_product_tests` with an `unknown` Murph concern
level until comparable thresholds exist; source-only rows remain queryable in
the database but do not attach to label API results until remapped.

## Match Candidate Export

Export candidate Murph label matches for source-only contaminant products with:

```sh
PRODUCT_TEST_MATCH_CANDIDATES_TSV_PATH=.product-tests-work/candidates/plasticlist.tsv \
PRODUCT_TEST_MATCH_SOURCE_KEY=plasticlist_bay_area_2024 \
MURPH_LABELS_DB_URL=postgres://... \
apps/web/sql/product-tests/export-product-test-match-candidates.sh
```

`PRODUCT_TEST_MATCH_SOURCE_KEY` is optional; omit it to export all source-only
contaminant products. `PRODUCT_TEST_MATCH_CANDIDATE_LIMIT` defaults to 5 and is
capped at 25 candidates per source product. The exporter is read-only and ranks
existing `foods`/`supplements` rows by exact UPC first, then local full-text
name/brand similarity. It writes candidate context and a suggested
`match_method`, but it does not create products or update `product_tests`.

Build a compact manual review queue from an exported candidate TSV with:

```sh
PRODUCT_TEST_MATCH_CANDIDATES_TSV_PATH=.product-tests-work/candidates/plasticlist.tsv \
PRODUCT_TEST_REMAP_REVIEW_QUEUE_TSV_PATH=.product-tests-work/candidates/plasticlist-review-queue.tsv \
pnpm exec tsx apps/web/sql/product-tests/build-product-test-remap-review.ts
```

The review queue is intentionally not importable. It keeps one top candidate per
source product plus suggested target ids so a reviewer can quickly reject false
positives and copy only accepted rows into a reviewed remap TSV. The output path
must be under `.product-tests-work/` so the helper cannot overwrite committed
reviewed remap files.

Do not upsert sparse `foods` or `supplements` rows from contaminant source names.
If a true product label is missing, import it through the normal food or
supplement label ingestion path with enough label data for the product catalog,
then attach contaminant evidence through a reviewed remap.

For reviewed PlasticList products where the existing catalog lacked a durable
exact label row, curated brand-site anchors are committed separately:

```text
apps/web/sql/foods/plasticlist-brand-site-foods.json
apps/web/sql/supplements/plasticlist-brand-site-supplements.json
```

These files are not contaminant-source product stubs. They contain source URLs,
ingredients, serving sizes, and available facts from official brand or retailer
label pages, and use `data_origin = brand_site`. Import the food anchors with:

```sh
MURPH_LABELS_DB_URL=postgres://... \
apps/web/sql/foods/import-plasticlist-brand-site-foods.sh
```

Import the supplement anchors through the brand-site supplement helper, then
apply `remaps/plasticlist-reviewed.tsv`. Ambiguous fresh, counter, or
source-variable PlasticList products stay reviewed as `source_only` until an
exact durable label source exists.

```sh
MURPH_LABELS_DB_URL=postgres://... \
node .agents/skills/research-supplements/scripts/supplement-db-brand-site-labels.mjs \
  upsert --input apps/web/sql/supplements/plasticlist-brand-site-supplements.json
```

## Reviewed Remaps

Reviewed source-product matches use one TSV shape across contaminant sources:

```tsv
source_key	tested_source_product_id	food_id	supplement_id	match_method	review_note
plasticlist_bay_area_2024	236	fdc:example		manual_confirmed	reviewed package/name match
nyc_dohmh_consumer_products	123			source_only	intentionally unlinked ambiguous source row
```

Use `source_only` with blank product ids to intentionally unlink a source
product. Use `exact_upc`, `exact_source_id`, or `manual_confirmed` with exactly
one `food_id` or `supplement_id` to attach every imported test for that source
product to a real Murph label row. The importer validates that the target label
exists, the target is not a legacy contaminant-source-backed label row, the
source product tests exist, and each source product appears at most once in the
TSV.

Import reviewed remaps with:

```sh
PRODUCT_TEST_REMAPS_TSV_PATH=apps/web/sql/product-tests/remaps/reviewed.tsv \
MURPH_LABELS_DB_URL=postgres://... \
apps/web/sql/product-tests/import-product-test-remaps.sh
```

The initial reviewed PlasticList remaps are committed at:

```text
apps/web/sql/product-tests/remaps/plasticlist-reviewed.tsv
```

Apply them after the PlasticList import with:

```sh
PRODUCT_TEST_REMAPS_TSV_PATH=apps/web/sql/product-tests/remaps/plasticlist-reviewed.tsv \
MURPH_LABELS_DB_URL=postgres://... \
apps/web/sql/product-tests/import-product-test-remaps.sh
```

## Open Product Source Seeds

Committed open-source contaminant rows live under:

```text
apps/web/sql/product-tests/open-data/
```

They currently seed 8,147 source-only `product_tests` rows:

- NYC DOHMH consumer-product metals open data: 6,230 rows
- King County consumer-product lead open data: 277 rows
- Pure Earth RMS Zenodo dataset: 1,640 rows

The generator imports only source categories that are foods, dietary
supplements, or source-defined ingestible remedies. Cookware, cosmetics, toys,
paint, household products, and other non-food/non-supplement rows are skipped.
Recall feeds such as openFDA and FSIS are not loaded into `product_tests` here
because they usually describe recall events rather than numeric product
contaminant measurements.

Source posture:

- NYC DOHMH: official public dataset; derivative/community datasets are allowed
  if they are not misleading and do not imply DOHMH endorsement.
- King County: public-domain open data.
- Pure Earth: CC BY 4.0 Zenodo dataset, DOI `10.5281/zenodo.10444602`.

Refresh the committed CSV with:

```sh
pnpm exec tsx apps/web/sql/product-tests/sync-open-product-sources.ts
```

Import the committed CSV with:

```sh
MURPH_LABELS_DB_URL=postgres://... \
apps/web/sql/product-tests/import-open-product-sources.sh
```

Apply schemas only with:

```sh
MURPH_LABELS_DB_URL=postgres://... \
apps/web/sql/product-tests/import-open-product-sources.sh --schema-only
```

Every imported row has `match_method = source_only` and no product link. These
source facts do not appear on `/api/foods` or `/api/supplements` results until a
future exact UPC or manually confirmed remap links the row to a real catalog
product. Re-imports are convergent for the open source keys in the committed
CSV: rows removed from a refreshed seed are removed from `product_tests`, and
legacy source-backed products with no remaining tests are removed. Existing
reviewed links are preserved only when the refreshed source row still names the
same source product id, tested product name, tested brand, and tested UPC;
source identity drift repairs the row back to `source_only` for review. The
importer refuses that destructive convergence
unless the committed seed counts and source distributions match the pinned
import set.

## Threshold Seeds

Curated import-ready threshold CSVs live under:

```text
apps/web/sql/product-tests/thresholds/
```

They currently seed:

- California OEHHA Proposition 65 NSRL/MADL rows: 355 rows
- U.S. federal rows excluding California: 406 rows
- European Commission Regulation (EU) 2023/915 rows: 529 rows

Each row keeps its source URL in `threshold_url`. The CSV files intentionally
omit `imported_at`; the database sets that timestamp when rows are imported.
`threshold_basis` preserves the source/regulatory scope such as Prop 65
NSRL/MADL exposure type, EU commodity clause, or FDA commodity key. It is not
the product-test measurement basis. The import derives separate normalized
comparison fields only for explicitly product-mass-scoped concentration rows;
equivalent mass concentration units (`mg/kg`, `ppb`, `ug/kg`, and `ng/g`) are
stored in the comparison triplet as canonical `ppm` values while the source
unit remains on the raw result or threshold field. Product-mass `mg/kg-dry`
rows are left as `mg/kg-dry` because dry-weight measurements are not equivalent
to as-sold product-mass concentrations without source-specific moisture data.
They compare only to explicitly dry-weight `mg/kg-dry` threshold rows.
The current public seed files stay non-comparable until product applicability is
modeled explicitly. Active comparable threshold rows are unique by
`contaminant_key + normalized_unit + normalized_basis` so a product observation
can match at most one threshold row. The schema migration backfills normalized
fields for any existing explicit `product_mass` concentration thresholds and
product-test observations so already-deployed comparable rows keep working
before the next import.

Import every committed threshold seed with:

```sh
MURPH_LABELS_DB_URL=postgres://... \
apps/web/sql/product-tests/import-thresholds.sh
```

The default importer combines every committed threshold CSV into one prepared
repo-relative CSV and applies it in one database transaction. In that all-seed
mode, rows absent from the prepared CSV are deactivated for authority keys
present in the committed seeds, so seed renames/removals converge instead of
leaving obsolete active thresholds behind. The destructive all-seed mode is
guarded by pinned seed and authority counts.

Import one CSV with:

```sh
CONTAMINANT_THRESHOLDS_CSV_PATH=apps/web/sql/product-tests/thresholds/eu_contaminant_thresholds.csv \
MURPH_LABELS_DB_URL=postgres://... \
apps/web/sql/product-tests/import-thresholds.sh
```

Single-file/custom imports are additive by default: contained rows are upserted
without deactivating other active thresholds for the same authority. To converge
the full threshold seed set, run the default all-file import.

Apply schemas only with:

```sh
MURPH_LABELS_DB_URL=postgres://... \
apps/web/sql/product-tests/import-thresholds.sh --schema-only
```

Seed thresholds into a legacy supplement-only database without applying the
full food search schema with:

```sh
MURPH_LABELS_DB_URL=postgres://... \
apps/web/sql/product-tests/import-thresholds.sh --legacy-supplement-db
```

Run the product label schemas, product-test schema, PlasticList import, open
product source import, and threshold import before deploying contaminant-aware
web code to a database environment. The label APIs fail closed when the
contaminant schema is missing.

Threshold rows are regulatory comparison references, not product safety claims.
Murph only compares them to product tests when the threshold row has a
normalized comparison triplet and `contaminant_key`, `normalized_unit`, and
`normalized_basis` match exactly. Scoped legal, commodity, daily-exposure,
water, and leaching-solution thresholds remain visible as source references but
are not product alerts without explicit product-applicability mapping.
