---
name: research-supplements
description: Research supplement brands for Murph's supplement database. Use when Codex needs to take one or more supplement brands, find current official product labels from the web, extract products, variants, Supplement Facts/Nutrition Facts, full active and other ingredient text, UPC/SKU/source URLs, deduplicate against the Murph supplement DB, and dry-run or upsert fresh label records through MURPH_SUPPLEMENT_DB_URL. Also use for bulk brand runs where one subagent should research each brand and return normalized import rows.
---

# Research Supplements

## Core Rule

Supplement product labels are queryable product facts. Do not store research output in assistant runtime state as the source of truth. Normalize evidence into `brand_site` supplement rows and write through the Murph supplement DB only after a dry run proves duplicate and match behavior.

Never print `.env`, `.env.local`, database URLs, credentials, tokens, or raw connection strings. Use the helper scripts; they read only `MURPH_SUPPLEMENT_DB_URL`, connect through libpq env/passfile inputs instead of argv, and redact sensitive values from errors.

## Workflow

1. **Plan the brand run**
   - Normalize the brand list into stable source slugs such as `momentous`, `thorne`, or `life-extension`.
   - For multiple brands, spawn one subagent per brand when subagent tooling is available. Give each subagent the brand name, official site, this skill path, and the output contract below. Keep database writing in the parent agent unless the user explicitly wants workers to write.
   - If subagents are unavailable, process brands sequentially and keep per-brand outputs separate.

2. **Collect source evidence**
   - Prefer official brand product pages, official Shopify product feeds, Supplement Facts images, PDFs, and official structured data.
   - Use search snippets only as leads. Do not treat snippets, reviews, affiliate pages, or retailer pages as authoritative unless official pages are missing and the row is clearly marked lower-confidence.
   - Capture variant-level data when flavors, serving sizes, UPCs, or formulas differ.
   - Classify bundles/stacks separately from standalone formulas. Do not import merch, shakers, apparel, topical products, or test products as dietary supplements.

3. **Normalize rows**
   - Emit JSON rows with: `id`, `dataOrigin`, `dataOriginId`, `dataOriginUrl`, `source`, `sourceId`, `name`, `brand`, optional `upc`, `offMarket`, `searchText`, and `label`.
   - `dataOrigin` must be `brand_site`. Use `dataOriginId = <brand-slug>:<sourceId>` and `id = dataOriginId`.
   - `sourceId` must be stable within the brand. Use the product handle for one-formula products and `handle--variant-slug` for variant-specific rows.
   - `label` must include `schemaVersion`, `sourceFetchedAt`, `sourceUrl`, raw facts text, ingredient text, variants, and evidence status. If full facts are missing, mark `needsManualReview: true` and do not include the row in a production upsert unless the user accepts incomplete rows.

4. **Dry-run against the DB**
   - Read `.agents/skills/research-supplements/references/database-contract.md` before writing.
   - Always run `supplement-db-brand-site-labels.mjs dry-run` before `upsert`.
   - Duplicate prevention is by `id` plus `(data_origin, data_origin_id)`. UPCs are used to point `canonical_key` at an existing DSLD row when an exact UPC match exists.
   - Treat duplicate input rows for the same `(dataOrigin, dataOriginId)` as a batch error. Resolve them before writing.

5. **Upsert only fresh evidence**
   - Use official current-page evidence to overwrite existing rows for the same `id` / `(data_origin, data_origin_id)`.
   - Preserve source provenance in `data_origin_url`, `label.sourceFetchedAt`, and `label.sourceUrl`.
   - Brand web data belongs in `supplements` with `data_origin = 'brand_site'`, `data_origin_priority = 5`, and `data_origin_id = <brand-slug>:<sourceId>`. Do not create separate per-brand `data_origin` values.

6. **Report gaps**
   - Report rows inserted/updated, UPC-matched rows, no-UPC rows, skipped products, and products needing manual OCR or review.
   - For 20-brand batches, return a per-brand checklist before the final bulk upsert.

## Momentous Quick Start

Momentous is a Shopify storefront. Use the bundled extractor first:

```bash
node .agents/skills/research-supplements/scripts/momentous-shopify-labels.mjs --require-facts > /tmp/momentous-labels.json
node .agents/skills/research-supplements/scripts/supplement-db-brand-site-labels.mjs dry-run --input /tmp/momentous-labels.json
node .agents/skills/research-supplements/scripts/supplement-db-brand-site-labels.mjs upsert --input /tmp/momentous-labels.json --delete-origin momentous
```

Use `--include-stacks` only when the user wants bundles/stacks. Use `--handle <handle>` for focused retries. If Momentous returns HTTP 429, rerun later or increase `--delay-ms`. `--delete-origin` is only for replacing a stale per-brand origin that exactly matches the single input brand source after `_` normalization; it rejects core origins such as `brand_site`, `dsld`, and `dailymed`.

## Subagent Prompt

Use this shape for each brand worker:

```text
Use $research-supplements at <skill-path> to research <brand>.
Find official current product labels and return normalized brand_site supplement JSON rows only.
Do not write to the database.
For each row include id, dataOrigin=brand_site, dataOriginId, dataOriginUrl, source, sourceId, name, brand, upc if available, label.sourceFetchedAt, label.factsText, label.ingredients or ingredientText, and label.needsManualReview.
Report skipped products and why.
```

## Resources

- `scripts/momentous-shopify-labels.mjs`: Momentous-specific Shopify/page extractor.
- `scripts/supplement-db-brand-site-labels.mjs`: DB schema inspect, dry-run, and upsert helper for `supplements` rows where `data_origin = 'brand_site'`.
- `references/database-contract.md`: current supplement DB table contract and write rules.
- `references/source-quality.md`: source hierarchy, extraction quality rules, and Momentous rehearsal notes.
