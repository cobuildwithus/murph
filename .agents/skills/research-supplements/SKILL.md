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
   - If static HTTP fetches are blocked, rate-limited, or miss UI-rendered label evidence, Computer Use may be used with Safari for read-only official-page inspection.
   - Allowed Safari actions: open official brand product pages, scroll, use product image galleries or tabs, zoom label/PDF viewers, download official label images or PDFs, and copy visible Supplement Facts, Nutrition Facts, ingredients, UPC/SKU, and source URLs.
   - Disallowed Safari actions: logging in, creating accounts, adding to cart, purchasing, submitting forms, solving CAPTCHAs, bypassing browser/security/paywall barriers, changing settings, uploading/transmitting user data, or accepting prompts beyond ordinary cookie consent.
   - Capture variant-level data when flavors, serving sizes, UPCs, or formulas differ.
   - Store exactly one standalone supplement product/label per row. Do not import bundles, kits, stacks that combine multiple products, regimens/plans, variety packs, multi-bottle pack duplicates, samples, promos, merch, shakers, apparel, topical products, or test products as dietary supplements.
   - Do not import conventional food or snack products as supplement rows, even when the page has a clean Nutrition Facts panel. Reject protein bars, nutrition bars, energy bars, snack-category products, ready-to-eat foods, ready-to-drink shakes/beverages, cookies, brownies, chips/crisps, candy-like foods, meal bars, and grocery-style food products. Keep them in skipped/delete-candidate output instead of production JSON.

3. **Normalize rows**
   - Emit JSON rows with: `id`, `dataOrigin`, `dataOriginId`, `dataOriginUrl`, `source`, `sourceId`, `name`, `brand`, optional `upc`, `offMarket`, and `label`. Do not provide custom `searchText`; the DB helper derives compact search text from normalized product fields.
   - `dataOrigin` must be `brand_site`. Use `dataOriginId = <brand-slug>:<sourceId>` and `id = dataOriginId`.
   - `sourceId` must be stable within the brand. Use the product handle for one-formula products and `handle--variant-slug` for variant-specific rows.
   - Production rows must include normalized `label.ingredientRows` and `label.servingSizes`. Raw `factsText` and `ingredientText` are allowed as source evidence, but they are not a substitute for normalized rows.
   - `label` must include `schemaVersion`, `sourceFetchedAt`, `sourceUrl`, normalized facts, raw facts evidence, full active and other ingredient text, variant metadata when relevant, and evidence status.
   - Do not store full page bodies, FAQ text, reviews, marketing sections, or nearby product copy in `label`. If a short product description is useful, store it as a concise `descriptionText` excerpt; keep page-body extraction as local scratch data only.
   - If full facts or normalized rows are missing, mark `needsManualReview: true` and do not include the row in a production upsert.

4. **Dry-run against the DB**
   - Read `.agents/skills/research-supplements/references/database-contract.md` before writing.
   - Always run `supplement-db-brand-site-labels.mjs dry-run` before `upsert`.
   - Treat dry-run `productionBlockedRows` as blockers. The helper blocks production upserts for missing `ingredientRows`, missing `servingSizes`, manual-review rows, obvious non-standalone products, likely food/snack products such as protein bars, oversized page-body text, raw page text, or oversized search text.
   - For existing-row cleanup, run `supplement-db-brand-site-repair-preview.mjs` first. It is read-only and writes review artifacts showing proposed compact search text, parser coverage, normalized row additions, and superfluous field candidates. Do not write repair updates until the preview has been reviewed.
   - Treat repair preview `automatedBackfillReady: true` rows as the only candidates for automated backfill. `structured_ready` is diagnostic parser state and can still have blockers; do not use it alone as a write/delete gate. Keep blocked, `partial_parse`, and `needs_better_parser` rows in manual review/refetch/OCR queues, even when some facts were recovered.
   - After repair/refetch/OCR produces candidate rows, run the normal `supplement-db-brand-site-labels.mjs dry-run` on the exact candidate artifact before any upsert. Inspect candidate `name`, `brand`, `source`, `sourceId`, UPC, `ingredientRows`, `servingSizes`, and removable raw-evidence fields; do not write candidates that are mechanically accepted but still have stale category-like brands, ambiguous variants, lossy parsed facts, or missing official provenance.
   - Use the preview's `brand_site_evidence_recovery_queue.json` / `.csv` and `brand_site_evidence_recovery_by_brand.json` artifacts to prioritize remaining blocked rows. Process `refetch_official_label_or_ocr` and `refetch_official_page_body` rows from official sources before adding more parser regex; these rows usually lack trustworthy saved label evidence.
   - Before deleting raw evidence fields such as `bodyText`, `rawPageText`, or `allProductFactsText`, confirm the row has `automatedBackfillReady: true` with production-quality `label.ingredientRows` and `label.servingSizes`; preserve raw evidence for blocked, partial, uncertain, image-only, OCR-fragmented, or whole-page evidence rows.
   - For image-only labels, OCR-fragmented facts, or saved text that is just page captions/alt text, prefer a fresh official-page refetch/OCR pass over guessing from marketing copy.
   - If the saved row has no real facts text, refetch official evidence instead of expanding parser regexes. Prefer official HTML facts tables first, then official product JSON/media (`/products/<handle>.js` on Shopify when available), official Supplement Facts/Nutrition Facts images, and PDFs. Store only the resulting normalized single-product facts, plus concise provenance; do not store full HTML/page bodies.
   - Use `supplement-db-brand-site-refetch-preview.mjs` for recovery-queue rows before writing any backfill. The helper is read-only and emits official refetch candidates plus image/PDF evidence pointers; rows that still lack parsed `ingredientRows` and `servingSizes` must remain manual-review/output artifacts only. Treat variant-matched Shopify media filenames with `SFP` as Supplement Facts Panel evidence, not as parsed facts. When current official product/variant data has an exact UPC match, `--hydrate-dsld-upc` may read DSLD rows and copy structured facts into the preview artifact, but only exact UPC matches with DSLD `ingredientRows` and `servingSizes` can become production-ready.
   - Use `supplement-db-brand-site-ocr-preview.mjs` only after refetch preview has found official facts image URLs. It sends those official image URLs to a vision model for OCR and writes local artifacts; OCR rows can become production-ready only when the existing parser extracts both `label.ingredientRows` and `label.servingSizes`.
   - Refetch/OCR output must still produce one standalone product/variant row with `label.ingredientRows` and `label.servingSizes`. Rows that remain image-only, caption-only, ambiguous, bundle-like, multi-pack-only, or variant-mismatched stay out of production upserts.
   - Do not flatten complex multi-audience facts panels into a simple row if doing so would lose per-audience amounts or daily values. Preserve the raw official facts evidence in local review artifacts and keep the row manual until the normalized shape can represent the label accurately.
   - Duplicate prevention is by `id` plus `(data_origin, data_origin_id)`. UPCs are used to point `canonical_key` at an existing DSLD row when an exact UPC match exists.
   - Treat duplicate input rows for the same `(dataOrigin, dataOriginId)` as a batch error. Resolve them before writing.

5. **Upsert only fresh evidence**
   - Use official current-page evidence to overwrite existing rows for the same `id` / `(data_origin, data_origin_id)`.
   - Preserve source provenance in `data_origin_url`, `label.sourceFetchedAt`, and `label.sourceUrl`.
   - Brand web data belongs in `supplements` with `data_origin = 'brand_site'`, `data_origin_priority = 5`, and `data_origin_id = <brand-slug>:<sourceId>`. Do not create separate per-brand `data_origin` values.

6. **Report gaps**
   - Report rows inserted/updated, UPC-matched rows, no-UPC rows, skipped products, and products needing manual OCR or review.
   - For 20-brand batches, return a per-brand checklist before the final bulk upsert.

## Brand Batch Flow

Create a normalized JSON batch from official current label evidence, then use the DB helper for the database dry run and upsert:

```bash
node .agents/skills/research-supplements/scripts/supplement-db-brand-site-labels.mjs dry-run --input /tmp/brand-labels.json
node .agents/skills/research-supplements/scripts/supplement-db-brand-site-labels.mjs upsert --input /tmp/brand-labels.json
```

Use temporary brand-specific extraction scripts only as scratch tooling outside the committed skill. Do not add brand-specific import helpers to this skill unless the format is reusable across brands. If replacing stale per-brand legacy origins, `--delete-origin` must match the single input source after `_` normalization; it rejects core origins such as `brand_site`, `dsld`, and `dailymed`.

## Subagent Prompt

Use this shape for each brand worker:

```text
Use $research-supplements at <skill-path> to research <brand>.
Find official current product labels and return normalized brand_site supplement JSON rows only.
Do not write to the database.
If static fetches miss official label evidence, you may use Computer Use with Safari for read-only official-page inspection, label image/PDF review, and official label downloads. Do not log in, create accounts, add to cart, purchase, submit forms, solve CAPTCHAs, bypass browser/security/paywall barriers, upload or transmit user data, or use retailer facts as authoritative unless marked lower-confidence/manual-review.
For each row include id, dataOrigin=brand_site, dataOriginId, dataOriginUrl, source, sourceId, name, brand, upc if available, label.sourceFetchedAt, label.ingredientRows, label.servingSizes, label.factsText, label.ingredients or ingredientText, and label.needsManualReview.
Report skipped products and why. Put snack, protein-bar, ready-to-eat, and ready-to-drink food products in skipped/delete-candidate output, not production rows.
```

## Resources

- `scripts/supplement-db-brand-site-labels.mjs`: DB schema inspect, dry-run, and upsert helper for `supplements` rows where `data_origin = 'brand_site'`.
- `scripts/supplement-db-brand-site-repair-preview.mjs`: read-only existing-row repair preview for compact search text, normalized facts parsing, automated-backfill readiness, and official refetch/OCR queue artifacts.
- `scripts/supplement-db-brand-site-refetch-preview.mjs`: read-only recovery-queue refetch preview for official product JSON/media evidence, reusable Shopify variant/Supplement Facts image selection, and optional exact-UPC DSLD structured-facts hydration.
- `scripts/supplement-db-brand-site-ocr-preview.mjs`: read-only OCR preview for official facts image URLs emitted by the refetch preview, with parser-gated normalized row promotion.
- `references/database-contract.md`: current supplement DB table contract and write rules.
- `references/source-quality.md`: source hierarchy and extraction quality rules.
