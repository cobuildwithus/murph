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
`match_method = exact_source_id`. To remap known exact matches to pre-existing
Murph label rows, set `PLASTICLIST_PRODUCT_MATCHES_TSV_PATH` to a tab-separated
file with:

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

Existing product-test link targets are preserved on default reruns unless the
current input row comes from `PLASTICLIST_PRODUCT_MATCHES_TSV_PATH`. To move a
sample from a source-backed PlasticList product to an existing food/supplement,
or to intentionally move it back, include the desired target in the matches TSV.

Reruns are additive by default: current rows are inserted or updated without
pruning older PlasticList evidence. `--replace-source` makes the import
convergent for a complete source export by removing PlasticList test rows absent
from the prepared input and deleting source-backed PlasticList `foods` rows that
are no longer present and have no remaining tests. To avoid accidental
source-wide deletion from a bad export, the runner refuses to apply any SQL
import when the prepared PlasticList test file contains zero data rows.

The PlasticList import loads exact measured product evidence. It does not insert
threshold rows; concern alerts require separate curated `contaminant_thresholds` rows.
Until then, imported products return `known_product_tests` with an `unknown`
Murph concern level.
