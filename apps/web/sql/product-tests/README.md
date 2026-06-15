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
table. It adds only the minimal `foods` foreign-key target plus
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
Fully remapped PlasticList products do not create source-backed `foods` rows;
their evidence lives on the explicit remap target.

The PlasticList import loads exact measured product evidence. It does not insert
threshold rows; concern alerts require separate curated `contaminant_thresholds` rows.
Until then, imported products return `known_product_tests` with an `unknown`
Murph concern level.
