# Food Label Search (Fridge Scan, Phase 1)

## Goal

Add a hosted food label database + search tool mirroring the existing supplement
label tool, so the assistant can resolve foods (from photos or text) to nutrition
facts. Source: USDA FoodData Central (public domain). Phase 2 (later, do NOT build
now) adds a `product_tests` contaminant-report table joined onto foods/supplements.

## Architecture decisions (settled, do not relitigate)

- Same labels Postgres DB as `supplements`. Read the URL as
  `MURPH_LABELS_DB_URL ?? MURPH_SUPPLEMENT_DB_URL` (new name with fallback; no
  deploy churn tonight). One shared pg pool for both tables (do not create a
  second pool); set a pool-level `statement_timeout` (~8s) so one bad query
  cannot eat a whole request.
- New `foods` table clones the `supplements` column shape
  (`apps/web/sql/supplements/schema.sql` is the template), same index style
  (GIN tsvector on search_text, GIN trigram on name only; btree on brand, upc,
  canonical_key), PLUS two freshness columns:
  `fdc_release_date DATE NOT NULL` (the release the row last appeared in) and
  `last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()`. Imports refresh both; rows
  disappearing from future releases stay but stop advancing (never delete).
- `id` = `fdc:<fdcId>`. `data_origin` ∈ `usda_foundation` (priority 10),
  `usda_sr_legacy` (20), `usda_fndds` (25, data_type 'Survey (FNDDS)' — prepared/
  restaurant/mixed dishes as actually eaten; no brand/upc; keep ALL nutrients +
  portions like the other generics), `usda_branded` (30); `research` (200)
  reserved for later.
  Future origins (e.g. `usda_fndds` survey foods, restaurant/chain menu data such
  as McDonald's) are just new `data_origin` values + priorities — schema must not
  assume UPC or packaged-goods shape (brand carries the chain name for menu items).
- Branded brand precedence: display `brand` = first non-empty of
  `brand_name`, `subbrand_name`, `brand_owner`; canonical-key brand = first
  non-empty of `brand_name`, `brand_owner`; keep all three raw fields in `label`.
  (Prevents Quaker products canonicalizing under PepsiCo.)
- `canonical_key` = normalized(brand)+'|'+normalized(name) (lowercase, alnum+spaces
  collapsed), fallback `fdc:<fdcId>` when brand and name are both empty. This makes
  the existing dedupe_rank partition collapse FDC duplicate SKUs/size variants.
- `off_market` = true when FDC `discontinued_date` is set.
- `upc` = digits-only normalized GTIN/UPC as TEXT (preserve leading zeros,
  never numeric), same as supplements.
- `search_text` = name + brand fields + upc ONLY. Do NOT include ingredients
  (food ingredient lists are noisy — "milk" must not match every cookie — and
  excluding them keeps the GIN index small). Ingredients stay in `label` for the
  model to read.
- `label` JSONB is a TRIMMED projection, not the raw FDC record:
  `ingredients`, `notSignificantSourceOf`, `servingSize`, `servingSizeUnit`,
  `householdServing`, `category`, `brandOwner`/`brandName`/`subbrandName`,
  `packageWeight`, `publishedDate`/`modifiedDate`/`availableDate`, and
  `nutrientsPer100g`: compact list `[{id, number, name, value, unit}]`.
  Nutrient scope: for `usda_foundation`/`usda_sr_legacy` keep ALL measured
  nutrients (tiny datasets, high value). For `usda_branded` keep the full
  US-nutrition-label-relevant set including vitamins/minerals (macros + the
  declarable micronutrient panel: protein 203, fat 204/605/606, carbs 205,
  kcal 208, sugars 269/539, fiber 291, cholesterol 601, sodium 307, plus
  vitamins A/C/D/E/K, B vitamins incl. folate and B12, calcium, iron,
  potassium, magnesium, zinc, phosphorus, selenium, copper, manganese,
  choline — resolve exact nutrient_nbr values from nutrient.csv at import).
  Exclude only the research-grade long tail (individual amino acids, fatty
  acid fractions). CSV `food_nutrient.amount` is per-100g — do NOT fabricate
  per-serving values; the model derives them from serving metadata. For
  Foundation/SR Legacy generics also include `portions`:
  `[{amount, description, gramWeight}]` from `food_portion.csv` (users think in
  "1 large egg", not 100g). Drop all FDC derivation metadata.
- Read path: generalize the existing hybrid FTS+trigram+brand-scope search into a
  table-parameterized factory shared by supplements and foods. No new query logic.
- CLI: `food search-labels` + `food search-labels-batch` added to the existing
  `food` command group, mirroring the `supplement` equivalents, via a generalized
  data-API client (path + source parameterized).
- Batch limits: MAX batch queries 10 → 50 for BOTH tools (shared constant);
  POST body caps 8KB → 32KB (CLI client side, web route side, egress intercept).
  Batch route handlers: trim + dedupe queries before DB work (mapping results
  back to every original query), run searches with small bounded concurrency
  (tiny local mapLimit, no new dependency).
- Egress intercept: allow pathname ∈ {`/api/supplements`, `/api/foods`} for the
  hosted data API host; everything else about authorization unchanged.
- API stays read-only. No write endpoints. Imports run operator-side via psql.
- Import is re-runnable and upsert-only, `ON CONFLICT (data_origin,
  data_origin_id) DO UPDATE` (source identity is the idempotency boundary); rows
  are never deleted (future product_tests FK safety). Filter branded rows to
  `market_country = 'United States'`. Staging tables TEMP or UNLOGGED; on a fresh
  table, build indexes after the bulk load. Imports refresh `fdc_release_date` +
  `last_seen_at`. Log row counts by data_type, market_country, off_market,
  null-upc, null-brand at the end of each run.

## Source data (already downloaded + unzipped locally)

`/Users/willhay/startup1/fdc-data/full/` — the FULL FDC CSV archive 2026-04-30
(all data types, one consistent set of support files incl. `food_portion.csv`).
Filter `food.data_type IN ('Branded','Foundation','SR Legacy','Survey (FNDDS)')`
during import (branded ≈2M products, foundation ≈450, sr_legacy ≈7.8k,
fndds ≈26k). Inspect the actual CSV
headers there before writing transforms. The per-dataset zips under
`/Users/willhay/startup1/fdc-data/{branded,foundation,sr_legacy}/` are
backup only — do not mix formats. The full archive's `food_nutrient.csv` is tens
of millions of rows: pre-filter it locally (awk or similar) to the core nutrient
numbers above before any `\copy` to the DB, and keep DB-side temp usage bounded.

## Work chunks (disjoint file sets)

- **A — schema + import**: `apps/web/sql/foods/schema.sql`,
  `apps/web/sql/foods/import-*.sql`, a small runner script under
  `apps/web/sql/foods/` or `scripts/` (document required env vars; never print
  secrets). Template: `apps/web/sql/supplements/{schema,import}.sql`.
- **B — web lib + route**: generalize `apps/web/src/lib/supplements.ts` into a
  table-parameterized factory (keep existing exports working), add foods variant,
  add `apps/web/app/api/foods/route.ts` cloning the supplements route, bump batch
  constants (50 / 32KB) in both routes, tests mirroring
  `apps/web/test/supplements-{lib,route}.test.ts` plus keeping those green.
- **C — CLI**: generalize `packages/cli/src/supplement-labels.ts` into a shared
  labels client, add `food-labels` usage + `search-labels`/`search-labels-batch`
  commands in `packages/cli/src/commands/food.ts`, register in
  `packages/cli/src/vault-cli-command-manifest.ts`, regenerate generated command
  surfaces as the repo requires, bump batch constants (50), tests mirroring
  `packages/cli/test/supplement-labels.test.ts`.
- **D — egress intercept**: `apps/cloudflare/src/runner-egress-intercept.ts`
  path allowlist {supplements, foods} + POST body cap 32KB + matching test updates.
- **E — system prompt**: `packages/assistant-engine/src/assistant/system-prompt.ts`
  — food lookups go to `vault-cli food search-labels` (one item) /
  `search-labels-batch` (several) BEFORE web lookup, mirroring the supplement
  guidance style; add fridge/pantry scan guidance (enumerate visible products from
  the photo, one batch call, summarize findings, offer to save items as vault
  `food` records); update any prompt-snapshot tests.

## Verification

Per chunk: focused vitest for touched packages + `pnpm typecheck`. Final:
`bash scripts/workspace-verify.sh test:diff <changed files>` before commit.
Live import + real fridge-scan smoke happens after merge prep, operator-side.

Results (2026-06-12, unsandboxed in the murph-food-labels worktree):
- Passed: `pnpm typecheck` (workspace package/app typecheck via workspace-verify)
- Passed: apps/web foods/supplements lib+route+pool suites (5 files, 63 tests)
- Passed: packages/cli labels/commands/contract suites (5 files, 108 tests)
- Passed: apps/cloudflare runner-egress-intercept (146 tests)
- Passed: packages/assistant-engine model-behavior (34 tests)
- Import pipeline validated end-to-end against a throwaway local Postgres 17
  using a sampled full-archive dataset (all 13,694 generics + 20k branded):
  33,694 rows imported across 4 origins; FNDDS rows carry wweia categories,
  65-nutrient panels, and portions; branded labels carry ingredients/dates/
  per-100g panels; re-run is idempotent (same 33,694 rows, no duplicates).

Operational follow-up (after merge, operator-side): run
`apps/web/sql/foods/import-fdc.sh` against the labels DB with the full
2026-04-30 archive, then live `food search-labels` + fridge-photo smoke.

Status: completed
Updated: 2026-06-12
Completed: 2026-06-12
