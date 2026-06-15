# Product Test Imports

`product_tests` stores contaminant test observations for exact products. Every
row is linked to exactly one Murph food or supplement label row. The hosted
label APIs never infer contaminants from names, brands, tags, categories, or
fuzzy matches.

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
MURPH_LABELS_DB_URL=postgres://... \
apps/web/sql/product-tests/import-plasticlist.sh --replace-source
```

Apply schemas only with:

```sh
MURPH_LABELS_DB_URL=postgres://... \
apps/web/sql/product-tests/import-plasticlist.sh --schema-only
```

For a deployment still using the legacy `MURPH_SUPPLEMENT_DB_URL` fallback,
run the same schema-only command once with that legacy URL temporarily assigned
to `MURPH_LABELS_DB_URL` before deploying contaminant-aware web code:

```sh
MURPH_LABELS_DB_URL=postgres://... \
apps/web/sql/product-tests/import-plasticlist.sh --schema-only --legacy-supplement-db
```

The legacy flag assumes the fallback database already has the `supplements`
table. It adds a column-compatible `foods` foreign-key target plus
`product_tests`, avoiding food search indexes and extensions that the legacy
supplement-only runtime does not need.

By default the import creates one `foods` row per PlasticList product id that
has at least one imported test result and links each result to that row with
`match_method = exact_source_id`. These source-backed rows are hidden from
generic food text search so contaminant evidence does not look like an exact
match for a similar user product; exact ID lookup and curated remaps can still
use them as stable anchors. To remap known exact matches to pre-existing Murph
label rows, set `PLASTICLIST_PRODUCT_MATCHES_TSV_PATH` to a tab-separated file
with:

```tsv
plasticlist_sample_id	food_id	supplement_id	match_method
7090411	fdc:example		manual_confirmed
```

Exactly one of `food_id` or `supplement_id` must be set for mapped rows.
`match_method` must be `exact_upc`, `exact_source_id`, or `manual_confirmed`.
Every curated `plasticlist_sample_id` must exist in the PlasticList samples
file; stale or mistyped remap rows fail the import before database writes.
Fully remapped PlasticList products do not create source-backed `foods` rows;
their evidence lives on the explicit remap target.

PlasticList source column aliases are mapped to Murph canonical
`contaminant_key` values during import, for example `BPA_ng_g` becomes
`bisphenol_a_bpa` and `DEHP_ng_g` becomes
`di_2_ethylhexyl_phthalate_dehp`. Source-specific abbreviations stay at the
import boundary; threshold comparison uses the canonical key plus exact unit
and basis matches.

Existing product-test link targets are preserved on default reruns unless the
current input row comes from `PLASTICLIST_PRODUCT_MATCHES_TSV_PATH` or the
existing target is the default PlasticList source-backed row. That lets source
owned defaults follow upstream source product id corrections while keeping
curated food/supplement remaps stable. With `--replace-source`, the prepared
input is authoritative and rows absent from the matches TSV move back to their
source-backed PlasticList product. To move a sample from a source-backed
PlasticList product to an existing food/supplement, or to intentionally move it
back, include the desired target in the matches TSV.

Reruns are additive by default: current rows are inserted or updated without
pruning older PlasticList evidence. `--replace-source` makes the import
convergent for a complete source export by removing PlasticList test rows absent
from the prepared input. Source-backed PlasticList `foods` rows with no
remaining tests are deleted on every import, so default reruns do not leave
orphan anchors after curated remaps. To avoid accidental source-wide deletion
from a bad export, the runner refuses to apply any SQL import when the prepared
PlasticList test file contains zero data rows.

The PlasticList import loads exact measured product evidence. It does not insert
threshold rows; concern alerts require separate curated `contaminant_thresholds` rows.
Until then, imported products return `known_product_tests` with an `unknown`
Murph concern level.

## Open Product Source Seeds

Committed open-source product rows live under:

```text
apps/web/sql/product-tests/open-data/
```

They currently seed 8,157 source-backed product rows and 8,157 exact
`product_tests` rows:

- NYC DOHMH consumer-product metals open data: 6,230 rows
- King County consumer-product lead open data: 277 rows
- Pure Earth RMS Zenodo dataset: 1,650 rows

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

Refresh the committed CSVs with:

```sh
pnpm exec tsx apps/web/sql/product-tests/sync-open-product-sources.ts
```

Import the committed CSVs with:

```sh
MURPH_LABELS_DB_URL=postgres://... \
apps/web/sql/product-tests/import-open-product-sources.sh
```

Apply schemas only with:

```sh
MURPH_LABELS_DB_URL=postgres://... \
apps/web/sql/product-tests/import-open-product-sources.sh --schema-only
```

Every imported row links to exactly one source-backed `foods` or `supplements`
row with `match_method = exact_source_id`. These source-backed rows are hidden
from generic text search so a search for a similar product does not inherit
contaminant evidence. Exact source-qualified ids still resolve and return the
linked test summaries, including bounded raw observations and separate
threshold-exceedance alerts where comparable. Re-imports are convergent for the
open source keys in the committed CSVs: rows removed from a refreshed seed are
removed from `product_tests`, and source-backed products with no remaining tests
are removed. The importer refuses that destructive convergence unless the
committed seed counts and source distributions match the pinned import set.

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
California Prop 65 threshold bases include the NSRL/MADL threshold type so the
active comparable-key invariant remains one row per
`contaminant_key + threshold_unit + threshold_basis`.

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

Seed thresholds into a legacy supplement fallback database without applying the
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
Murph only compares them to product tests when `contaminant_key`,
`normalized_unit`, and `normalized_basis` match exactly.
