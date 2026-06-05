# Supplement DB Contract

## Environment

Use `MURPH_SUPPLEMENT_DB_URL` from the shell or `.env.local`. Do not print the value. Do not source all of `.env.local`; parse only this key or use the bundled DB helper. The helper connects through libpq environment plus a temporary `0600` passfile so the raw URL is not passed as a process argument.

Inspect the current DB shape:

```bash
node .agents/skills/research-supplements/scripts/supplement-db-brand-site-labels.mjs inspect
```

## One-Table Shape

The hosted supplement lookup database uses one `supplements` table for DSLD, DailyMed, and official brand-site rows. There is no dual-read compatibility layer.

`supplements` currently has:

- `id text primary key`
- `canonical_key text not null`
- `data_origin text not null`
- `data_origin_id text not null`
- `data_origin_url text`
- `data_origin_priority smallint not null default 100`
- `name text not null`
- `brand text`
- `upc text`
- `off_market boolean not null default false`
- `search_text text not null`
- `label jsonb not null`
- `imported_at timestamptz not null default now()`

Constraints and indexes:

- Unique `(data_origin, data_origin_id)`.
- `data_origin` must match `^[a-z][a-z0-9_]*$`.
- `id`, `canonical_key`, and `data_origin_id` must be non-empty.
- Full-text GIN search index over `search_text`.
- UPC, `canonical_key`, and `(data_origin, data_origin_id)` indexes.

Legacy tables may still exist with `_legacy` suffixes. Do not write new brand data to them.

## Brand-Site Rows

Official brand web rows must use:

- `data_origin = 'brand_site'`
- `data_origin_priority = 5`
- `data_origin_id = <brand-slug>:<sourceId>`
- `id = data_origin_id`
- `data_origin_url = official product URL`

Use a stable `sourceId`, preferably an official product handle or `handle--variant-slug`. Keep the brand-specific source slug and original source id inside `label.source` and `label.sourceId` for audit.

When a brand-site row's UPC exactly matches a DSLD row in `supplements`, set `canonical_key` to that DSLD row's canonical key, such as `dsld:321452`. Otherwise use the row id as the canonical key. Do not use automatic name-only matching for writes.

## Upsert Rules

1. Dry-run first and inspect:
   - duplicate input rows
   - existing rows that will be updated
   - rows that will canonicalize to DSLD by exact UPC
   - rows without UPC
2. Reject duplicate `(data_origin, data_origin_id)` rows before writing.
3. Upsert brand-site rows with `ON CONFLICT (id) DO UPDATE`.
4. Overwrite existing brand-site rows when the source is current official brand evidence.
5. If stale per-brand origins already exist, delete them in the same transaction as the replacement `brand_site` upsert. For Momentous, use `--delete-origin momentous`. The cleanup flag rejects core origins such as `brand_site`, `dsld`, and `dailymed`, and it must match the single input source after hyphens are normalized to underscores.
6. Preserve provenance inside top-level columns and `label`:
   - `data_origin`
   - `data_origin_id`
   - `data_origin_url`
   - `schemaVersion`
   - `source`
   - `sourceId`
   - `sourceFetchedAt`
   - `sourceUrl`
   - evidence status and raw facts/ingredient text

The bundled DB helper implements these rules for dry-run and upsert.
