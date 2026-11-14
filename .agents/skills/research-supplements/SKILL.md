---
name: research-supplements
description: Research supplement brands for Murph's supplement database. Use to take one or more brands, find current official product labels, extract products, variants, Supplement Facts or Nutrition Facts, ingredient text, UPC/SKU and source URLs, deduplicate against the Murph supplement DB, and dry-run or upsert label records through MURPH_LABELS_DB_URL. Also covers repairing existing brand_site rows and bulk brand runs.
---

# Research Supplements

Supplement labels are queryable product facts. Their home is the Murph
supplement DB, as `brand_site` rows, written only after a dry run shows how
each row matches or duplicates what is there. Assistant runtime state is never
the source of truth for them.

The helper scripts read only `MURPH_LABELS_DB_URL`, connect without putting it
in argv, and redact it from errors. Keep `.env` files, database URLs and
credentials out of your output.

## What a production row is

One standalone supplement product or variant, from current official evidence,
with normalized `label.ingredientRows` and `label.servingSizes`. A row missing
either, or marked `needsManualReview: true`, stays in review output and out of
an upsert. Raw `factsText` and `ingredientText` are evidence; they do not
stand in for the normalized arrays.

Leave these out of production rows and list them as skipped or delete
candidates: bundles, kits, stacks, plans, variety packs, multi-bottle
duplicates, samples, promos, merch, topical and test products, and
conventional food (bars, snacks, ready-to-eat or ready-to-drink products) even
when the page shows a clean Nutrition Facts panel.

Row fields:

- `id`, `dataOrigin`, `dataOriginId`, `dataOriginUrl`, `source`, `sourceId`,
  `name`, `brand`, optional `upc`, `offMarket`, `label`.
- `dataOrigin` is always `brand_site` (priority 5); there are no per-brand
  origins. `dataOriginId` is `<brand-slug>:<sourceId>` and `id` equals it.
- `sourceId` is stable within the brand: the product handle, or
  `handle--variant-slug` when flavors, serving sizes, UPCs or formulas differ.
- `label` carries `schemaVersion`, `sourceFetchedAt`, `sourceUrl`, the
  normalized facts, the raw facts evidence, full active and other ingredient
  text, variant metadata and evidence status. A short `descriptionText`
  excerpt is fine. Page bodies, FAQ text, reviews and marketing copy stay in
  local scratch files.
- The DB helper derives `search_text` (product identity plus ingredient
  names); don't supply your own.
- A facts panel with per-audience amounts stays manual until the normalized
  shape can hold it without loss.

## Sources

Prefer official product pages, official Shopify product feeds
(`/products/<handle>.js`), Supplement Facts images, PDFs and official
structured data. Search snippets are leads. Retailer, review and affiliate
pages count only when official pages are missing, and the row is then marked
lower-confidence. `references/source-quality.md` has the full hierarchy.

When static fetches are blocked or miss rendered label evidence, Safari
through Computer Use is allowed for reading official pages: open them, scroll,
use image galleries and tabs, zoom label and PDF viewers, download official
label images or PDFs, and copy visible facts. Stay read-only: no login,
account, cart, purchase, form, CAPTCHA, barrier bypass, settings change or
data upload, and no prompts beyond ordinary cookie consent.

## Brand run

1. Turn the brand list into stable slugs (`momentous`, `thorne`,
   `life-extension`). Brands are independent, so a multi-brand run can use one
   worker per brand with the prompt below; the parent keeps the database
   writes. Otherwise go brand by brand and keep outputs separate.
2. Collect evidence and build a normalized JSON batch.
3. Read `references/database-contract.md`, then dry-run and upsert:

   ```bash
   node .agents/skills/research-supplements/scripts/supplement-db-brand-site-labels.mjs dry-run --input /tmp/brand-labels.json
   node .agents/skills/research-supplements/scripts/supplement-db-brand-site-labels.mjs upsert --input /tmp/brand-labels.json
   ```

   Every `productionBlockedRows` entry in the dry run is a blocker. Duplicate
   input rows for one `(dataOrigin, dataOriginId)` are a batch error to fix
   before writing. Rows are matched by `id` and `(data_origin,
   data_origin_id)`; an exact UPC match points `canonical_key` at the existing
   DSLD row. Fresh official evidence overwrites the existing row and keeps its
   provenance in `data_origin_url`, `label.sourceFetchedAt` and
   `label.sourceUrl`.
4. Report rows inserted and updated, UPC-matched and no-UPC rows, skipped
   products, and products that need manual OCR or review. For a large batch,
   give a per-brand checklist before the final upsert.

Brand-specific extraction scripts are scratch tooling and stay out of this
skill unless the format is reusable. When replacing a stale per-brand origin,
`--delete-origin` must match the single input source and rejects `brand_site`,
`dsld` and `dailymed`.

## Repairing existing rows

Everything here is read-only until the final dry run and upsert.

1. For a whole-table view, run `supplement-db-audit.mjs`. It prints aggregate
   JSON; `--candidate-limit <n>` adds a bounded sample of IDs. Missing
   normalized arrays and duplicate groups are review candidates, not proof of
   corruption.
2. Run `supplement-db-brand-site-repair-preview.mjs`. Only rows with
   `automatedBackfillReady: true` are candidates for automated backfill.
   `structured_ready` is parser state and can still carry blockers.
   `partial_parse` and `needs_better_parser` rows stay in the manual, refetch
   or OCR queues.
3. Work the preview's recovery queue
   (`brand_site_evidence_recovery_queue.json`, `.csv` and
   `brand_site_evidence_recovery_by_brand.json`). A row with no real facts
   text needs fresh official evidence, not more parser regex:
   - `supplement-db-brand-site-refetch-preview.mjs` fetches official product
     JSON and media. A Shopify media filename with `SFP` is a Supplement Facts
     Panel image: evidence, not parsed facts. `--hydrate-dsld-upc` copies
     structured facts from DSLD only on an exact UPC match.
   - `supplement-db-brand-site-ocr-preview.mjs` sends the official facts
     images that refetch found to a vision model.
   - For image-heavy brands with a `data_origin_url` and no usable saved
     facts, use the context.dev re-scrape with vision OCR in
     `references/context-dev-and-vision-ocr.md`. Two things decide its yield:
     image selection, and the context.dev rate gate (without it about 60% of
     scrapes fail with a retryable `scrape_error` that looks like "no
     images"). Run a pool through the current selector and gate before calling
     it image-less.
   - The `dailymed` origin needs no scrape:
     `scripts/dailymed-spl-transform.py` structures it from its own SPL array.
4. Run the normal `dry-run` on the exact candidate artifact and read the
   candidates: name, brand, source, `sourceId`, UPC, the normalized arrays.
   Hold back rows the helper accepts that still show a category-like brand, an
   ambiguous variant, lossy facts or missing official provenance.
5. Delete raw evidence fields (`bodyText`, `rawPageText`,
   `allProductFactsText`) only from rows that are `automatedBackfillReady:
   true` with production-quality normalized arrays.

## Worker prompt

```text
Use $research-supplements at <skill-path> to research <brand>.
Find official current product labels and return normalized brand_site supplement JSON rows only.
Do not write to the database.
If static fetches miss official label evidence, you may use Computer Use with Safari for read-only official-page inspection, label image/PDF review, and official label downloads. Do not log in, create accounts, add to cart, purchase, submit forms, solve CAPTCHAs, bypass browser/security/paywall barriers, upload or transmit user data, or use retailer facts as authoritative unless marked lower-confidence/manual-review.
For each row include id, dataOrigin=brand_site, dataOriginId, dataOriginUrl, source, sourceId, name, brand, upc if available, label.sourceFetchedAt, label.ingredientRows, label.servingSizes, label.factsText, label.ingredients or ingredientText, and label.needsManualReview.
Report skipped products and why. Put snack, protein-bar, ready-to-eat, and ready-to-drink food products in skipped/delete-candidate output, not production rows.
```

## Scripts and references

All under `.agents/skills/research-supplements/`:

- `scripts/supplement-db-audit.mjs`: read-only whole-table audit.
- `scripts/supplement-db-brand-site-labels.mjs`: schema inspect, dry-run and
  upsert for `brand_site` rows.
- `scripts/supplement-db-brand-site-repair-preview.mjs`: repair preview and
  recovery-queue artifacts.
- `scripts/supplement-db-brand-site-refetch-preview.mjs`: official refetch
  preview with optional exact-UPC DSLD hydration.
- `scripts/supplement-db-brand-site-ocr-preview.mjs`: OCR preview for official
  facts images.
- `scripts/context-dev-image-fetch.py`, `scripts/vision-ocr-process-batch.py`:
  the context.dev image fetch and the check of each vision extraction against
  its verbatim `factsText`.
- `scripts/dailymed-spl-transform.py`: DailyMed SPL transform; dry-run, then
  `--write`.
- `references/database-contract.md`, `references/source-quality.md`,
  `references/context-dev-and-vision-ocr.md`.
