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
4. **Front-of-bottle photos only, no facts image anywhere** (e.g. most natures-plus) → genuinely unrecoverable from the page. Leave in the queue; do not burn calls. **But confirm this with the CURRENT selector + the gate first** — see "Do not declare a pool image-less" below; this verdict was wrong three times before the selector/gate were fixed.

## context.dev API notes

- Key in `.env` as `CONTEXT_DEV_API_KEY` (never print it). Endpoint `GET https://api.context.dev/v1/web/scrape/markdown?url=...`, header `Authorization: Bearer <key>`.
- **Cloudflare blocks the default urllib UA** with HTTP 403 / "error code: 1010". Always send a normal browser `User-Agent`.
- Rate limit observed at 120 req/min (raise with the provider). **Both** fetch scripts MUST gate — a single global 0.55s lock (≈109/min), not per-worker. This is non-negotiable:
  - **Failure mode (cost us a full pool):** 8 unthrottled `ThreadPoolExecutor` workers tripped the limit and ~60% of scrapes silently returned `scrape_error`. The rows then looked "image-less" and were nearly declared dead — they were only rate-limited. Adding the gate took the same pool from `{ok:537, scrape_error:842}` to `{ok:774, scrape_error:0}` on retry.
  - `scrape_error` is **retryable**, not terminal. Always re-run the error subset (with the gate) before concluding a brand has no facts.
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

- **+8 ALT TEXT match** (`FACTS_ALT`): the image's alt text contains panel phrasing — `serving size`, `servings per`, `amount per serving`, `supplement facts`, `nutrition facts`, `daily value`, `% dv`. **This is the single highest-yield signal and was the breakthrough.** Many CDNs name the file `img_1234.jpg` but set descriptive alt text; filename-only scoring misses those panels entirely.
- **+4** facts-filename signals (`FACTS_FN`): `supp_facts`, `suppfacts`, `_sf_`/`_sfp_`/`-sfp.` (the common `SFP` = "supplement facts panel" abbreviation), `supplement-facts`, `nutrition`, `_back`, `_panel`, `_label`.
- **+2** the image's alt-text or filename contains a **product-name token** — isolates the product's OWN images from the cross-sell/"recommended products" carousel that floods many pages (the main contamination risk).
- **+1** gallery position 2/3 (`_2`/`_3` — labels often sit here).
- Exclude logos, menus, banners, thumbnails, `.svg`, tiny variants.
- Keep **top 6** candidates (widened from 3→5→6; each widening materially raised yield on the hard tail).

Measured progression: top-3-keyword ≈ 29% → name-match + facts-patterns + top-5 ≈ 62% → **+alt-text scoring (+8) + SFP + top-6 ≈ 93-97%** on brands whose own product images dominate the page. The alt-text signal alone reopened ~780 rows previously written off as image-less.

**Do not declare a pool "image-less" until it has been run through the CURRENT selector.** Over the backfill, "floor reached" was declared three times prematurely — each time the cause was a selector gap or the rate-gate bug, not genuinely absent facts. Re-run with the latest `context-dev-image-fetch.py` before concluding a brand publishes no panel.

**Second lever — sonnet re-read of cached images.** Images are saved locally by Stage A. For rows that fail haiku extraction/anchoring, re-run vision with `model: 'sonnet'` over the **same downloaded chunks** (no re-scrape, no new context.dev calls). Sonnet reads low-res / foreign / dense panels that haiku misses. On the hard tail this recovered an extra ~3% — diminishing, but free of scrape cost.

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

## Free recovery to try BEFORE any scrape or delete

### DSLD UPC hydration
Many unstructured `brand_site` rows carry a `upc`. If a `dsld` row shares that exact UPC and is
already structured, copy its `ingredientRows`/`servingSizes` straight over — zero cost, fully
authoritative. **Drop DSLD `unit:"NP"` (Not Provided) placeholder rows** when copying; a product
whose DSLD facts are all `NP` yields nothing. Low absolute hit-rate on the tail (single digits)
but it is free and exact, so run it before deleting anything.

### DailyMed (the `dailymed` origin) is not a scraping problem
`dailymed` rows already hold a fully structured FDA SPL array in `label.ingredients`
(`{name, quantity:{amount,unit,denominatorAmount,denominatorUnit}, classCode}`). They land
unstructured only because nobody mapped that array into `ingredientRows`/`servingSizes`. Run
`scripts/dailymed-spl-transform.py` (dry-run, then `--write`) — a pure deterministic map, **no
context.dev / vision / LLM**. Key facts:
- `classCode` `ACTIB`/`ACTIM`/`ACTIR` = active (→ `ingredientRows`); `IACT` = inactive
  (→ `otherIngredientRows`, names only). Across this corpus the three active codes are
  **distinct ingredients**, not base/moiety duplicates of one another, so include all three.
- Serving size comes from the active rows' denominator: a weight/volume denom is used directly
  (`15 mL`, `20 g`); a per-unit denom (`1 1`) → dosage form parsed from the SPL `title`
  (`1 Tablet`); `1 serving` when the title has no form word (~half the corpus).
- Normalize units (`ug`→`mcg`, `[iU]`→`IU`, `[CFU]`→`CFU`, `[USP'U]`→`USP Units`, `meq`→`mEq`)
  and clean SPL naming (`.ALPHA.`→`Alpha-`, strip `, UNSPECIFIED`, title-case with an acronym
  whitelist, collapse double-hyphens). Applies the same food/non-standalone guards as brand_site.
- Result: `dailymed` 0% → 99.7% in one pass (only combo-pack "kits" held back). `search_text`
  already carries the ingredient names, so the write is an in-place `label || patch` jsonb merge.

## Deleting the genuinely-dead tail (last resort, reversible)

Once a pool has been exhausted by the CURRENT selector + gate (and DSLD/DailyMed recovery), the
true residue is image-less brands + panels neither haiku nor sonnet can read. Before deleting:
1. **Re-confirm exhaustion** — the whole pool went through the latest fetch script, errors were
   retried, sonnet re-read the cached images. (Don't delete a rate-limit artifact.)
2. **Back up first** — `SELECT json_agg(row_to_json(s)) FROM (… the to-delete set …) s` to a
   dated file. The delete is then fully reversible.
3. **Guarded delete** — `DELETE … WHERE data_origin='brand_site' AND jsonb_array_length(...
   ingredientRows ...)=0`, wrapped in `BEGIN/COMMIT`, so it can only remove unstructured rows.
