# context.dev Re-scrape + Vision-OCR Recovery

Recovery path for `brand_site` rows that have a `data_origin_url` but no usable saved
facts evidence (empty/partial `factsText`, no `label.ingredientRows`). Proven on a large
backfill: it lifted structured `brand_site` rows well past target where the existing
HTML-parser and refetch/OCR-preview helpers stalled.

Use this **after** the repair/refetch preview helpers leave a row in the recovery queue,
as an alternative to hand-expanding parser regexes.

## When each layer applies

1. **HTML facts text is present** → the existing parser + `supplement-db-brand-site-repair-preview.mjs` already handle it. Do not re-scrape.
2. **Facts are HTML but the saved row missed them** → context.dev `scrape/markdown` returns the page as clean markdown tables (far cleaner than saved OCR). Re-scrape, then extract from the markdown.
3. **Facts are a LABEL IMAGE on the page** (the common case for high-volume brands: bluebonnet, carlson, codeage, doctors-best, double-wood, jarrow, …) → context.dev `scrape/markdown?includeImages=true` to enumerate images, then read the facts-panel image with a **vision model** (Claude vision via subagents). Reading the image natively avoids the OCR-corruption (`PhosphatidyIcholine`) that plagues text-OCR pipelines.
4. **Front-of-bottle photos only, no facts image anywhere** (some bluebonnet, natures-plus) → genuinely unrecoverable from the page. Leave in the queue; do not burn calls.

## context.dev API notes

- Key in `.env` as `CONTEXT_DEV_API_KEY` (never print it). Endpoint `GET https://api.context.dev/v1/web/scrape/markdown?url=...`, header `Authorization: Bearer <key>`.
- **Cloudflare blocks the default urllib UA** with HTTP 403 / "error code: 1010". Always send a normal browser `User-Agent`.
- Rate limit observed at 120 req/min (raise with the provider). The fetch script gates to ≤115/min.
- The `brand/ai/product` endpoint does NOT return supplement facts (only generic product attributes) — use `scrape/markdown`, not product extraction.
- A scraped page often contains a second bare "Supplement Facts" string in nav/marketing; the real panel is the first block containing an amount **table**. Take the first table-bearing block.

## Vision-OCR pipeline (the scalable recovery loop)

Stage A — fetch + select images (context.dev key only):
`scripts/context-dev-image-fetch.py <tag> <pool_start> <count>` reads a pool of
`{id,url}` rows, scrapes each with `includeImages=true`, **selects candidate facts
images**, downloads them locally, and writes `manifest_<tag>.json` + `chunks_<tag>/`.

Stage B — vision extraction (subagents, on the subscription, $0 API key):
Run a workflow of haiku subagents, one per chunk file, each `Read`-ing its rows' local
image paths and extracting structured rows (see prompt below). Writes `chunk_NN_out.json`.

Stage C — validate + write:
`scripts/vision-ocr-process-batch.py <chunks_dir> <manifest> <out_items.json>` anchors
every extracted row against the model's own verbatim `factsText` readout (locale-aware
number matching), drops failures, and emits `labels.mjs` items. Then the standard
`supplement-db-brand-site-labels.mjs dry-run` (production guard) → `upsert`.

### Image selection is the bottleneck, not vision

Vision reads any facts panel it is handed almost perfectly. Yield is governed entirely by
whether the **right image** reaches it. Selection scoring that works (in the fetch script):

- **+4** facts-filename signals: `supp_facts`, `_SF_`, `supplement-facts`, `nutrition`, `_back`, `_panel`, `_label`.
- **+2** the image's alt-text or filename contains a **product-name token** — this isolates the product's OWN images from the cross-sell/"recommended products" carousel that floods many pages (the main contamination risk).
- **+1** gallery position 2/3 (`_2`/`_3` — labels often sit here).
- Exclude logos, menus, banners, thumbnails, `.svg`, tiny variants.
- Keep top 5 candidates (a wider window than 3 materially raised yield).

Measured progression: top-3-keyword ≈ 29% → name-match + facts-patterns + top-5 ≈ 62% overall, ~95% on brands whose own product images dominate the page.

### Vision prompt (per chunk)

Each subagent reads `chunk_NN.json` (`[{id,name,brand,images:[paths]}]`) and for each row
`Read`s every image, finds **that product's** facts panel, and emits one object per row:
`{id, status: extracted|insufficient_evidence, servingSizes, ingredientRows, otherIngredientRows, factsText}`.
Hard rules: only values literally visible; amount/unit separate; macros count; blends get
the total only (constituents no amount unless individually printed); fractions stay
fractions; transcribe foreign-language panels faithfully; `factsText` = verbatim readout.
CRITICAL contamination guard in the prompt: only extract a panel whose actives are
consistent with the row's product name — never a cross-sell product's panel.

## Safeguards (what actually keeps writes clean)

- **Anchor check** (in the process script): every emitted ingredient name/amount must trace
  to the verbatim `factsText` the model read. This is the primary guard.
- **Dose-in-name vs panel match** confirms the right product (e.g. "Chromium Picolinate 500 mcg" → panel shows 500 mcg). Used for spot-checking, not auto-reject.
- A naive "product-name token must appear in the panel" guard has **many false positives**
  (Buffered C → calcium ascorbate; Baby's DHA → fish oil; any multivitamin) — do not
  hard-reject on it; rely on the anchor check + name-matched image selection instead.
- The `supplement-db-brand-site-labels.mjs` dry-run/upsert `assertProductionReady` guard is
  the final backstop; it physically refuses blocked rows.
- Store the scraped facts as `label.factsText` with `evidenceStatus: "vision_ocr_label_image"`;
  strip `bodyText`/`rawPageText`/`rawHtml`/`allProductFactsText` from merged labels.

## Cost / scale

- Vision via subagents (workflow): ~$0 on the API key, ~75-270s per 50-agent / 250-row batch.
- Vision via direct API (haiku): ~$0.003/image if you prefer not to use subagents.
- context.dev: one scrape per row. Skip dead brands (front-only images) to avoid waste.
- Pipeline the next batch's Stage-A fetch while the current batch's vision runs.
