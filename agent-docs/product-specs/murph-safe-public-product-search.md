# Murph Safe public product search

Status: Active
Last verified: 2026-09-02

## Product promise

Murph Safe is the public product-evidence system. `/search` answers the question
“Is it Murph Safe?” by showing what Murph can substantiate about one product
record. `/food` compares branded foods from the same system. Neither surface
certifies a product as safe, unsafe, or healthy overall.

The first catalog includes every technically available supplement and branded
purchasable-food record in the shared labels database. Generic USDA food
records are excluded because this experience is package and product oriented.

## Experience

- Search is explicit-submit and accepts a product, brand, ingredient, or UPC.
- Supplement and branded-food matches stay in separate ranked groups because
  their rank scores are not comparable.
- A detail page presents identity, exact product tests, ingredients, nutrition,
  known evidence gaps, provenance, and a correction contact in that order.
- Missing tests, serving mass, source dates, or structured label fields appear
  as unknowns. Missing evidence is not a safety finding.
- Product-test screening compares compatible measurements with curated
  thresholds and names the threshold. It is not a diagnosis or a safety
  determination.

### Food comparison

- `/food` lets a visitor search and compare two to four branded foods.
- The main table compares calories, protein, total sugars, and total fat on a
  shared per-100-gram or per-serving basis.
- Each metric names its own winner with one quiet mark and a stated row rule.
  Missing values do not create a winner. A plain sentence may count rows led;
  nothing names a universal healthy or safe product.
- Equal winning values remain ties and do not receive unequal ordinal ranks.
- Evidence stays separate from nutrition as a coverage meter. A confirmed
  result above an available screening limit uses a warning treatment; missing
  tests, no comparable limit, and other gaps stay amber or neutral.
- Metric detail uses a short popover. Linked test results and evidence gaps
  open in one combined side sheet with coverage first and raw reports on demand.
- Bounded evidence states returned and total observation counts. Alert copy is
  scoped to shown observations, and the gap sheet renders the contract-owned
  unknown titles and descriptions directly.
- The tests sheet does not group observations or infer sample coverage. Its
  optional disclosure shows each returned result and the named threshold,
  basis, authority, and exposure policy used for screening.
- Category art is illustrative. It does not identify the package or certify the
  product category.

### Page-scoped WebMCP

On compatible browsers, `/food` registers four read-only page tools:

- `search_food_products` returns at most six branded-food choices.
- `compare_food_products` accepts two to four exact product references and
  updates the visible comparison.
- `get_food_comparison` reads the compact comparison now shown on the page.
- `show_food_evidence` opens the combined evidence sheet for a shown product;
  its `view` input focuses tests or gaps.

The tools use the same page state and public API as manual actions and return
the same bounded observation scope as the visible comparison. Comparison
results also include all four metric values, completeness, ties, winners, and
win counts shown by the page. They exist
only while `/food` is open and unregister through the browser-owned abort
signal. Murph adds no remote MCP server, account access, vault access, writes,
or food logging through this surface.

## Public data contract

The neutral machine-facing brand is the Murph Product Data API. Its current
schema identifier is `murph.public-products.v1`.

- `POST /api/public/v1/products/search` accepts the query only in a JSON body.
- `GET /api/public/v1/products/[productRef]` returns one normalized record.
- `GET /api/public/v1/openapi.json` is generated from the runtime Zod contracts.
- Public product references are deterministic opaque identifiers. They are not
  authorization and do not promise stable formula revisions.
- Search responses do not echo the query. Detail responses expose normalized
  fields and provenance, never raw source payloads or database internals.
- Product tests qualify only through the selected row's exact `food_id` or
  `supplement_id` foreign key. Canonical keys, names, brands, ingredients, and
  fuzzy similarity never transfer test evidence between records.

## Bounds and availability

- Search bodies are at most 4 KiB, queries are 2–128 characters, and each
  corpus returns at most 10 results.
- Public full-text and trigram paths retain at most 250 SQL candidates before
  final ranking.
- Detail reads transfer at most 256 KiB of stored label JSON and return at most
  20 test observations and 5 alerts. A normalized detail is capped at 1 MB; if
  label content would exceed that bound it is omitted and disclosed as an
  explicit evidence gap.
- The labels pool is shared across food and supplement readers and is bounded
  to 3 connections, 5 seconds to acquire, 30 seconds idle, and 8 seconds per
  statement. A database failure becomes a content-free retryable 503.
- Search responses are not cached. Detail and OpenAPI responses use bounded
  shared-cache policies.

## Privacy and abuse controls

Search terms from `/search`, `/food`, or WebMCP must not enter URLs, browser history state, page metadata,
referrers, persistent browser storage, analytics events, or application logs.
Public search uses `credentials: omit`, `no-store`, and `no-referrer`; public
routes suppress third-party analytics and do not enable permissive CORS.

Production uses leading active Vercel custom firewall rules:

- exact `POST /api/public/v1/products/search`: fixed-window per-IP 429 at 30 per
  60 seconds;
- `/api/public/v1/products/*` excluding the search path, plus
  `/search/products/*`: fixed-window per-IP 429 at 120 per 60 seconds.

The production-scoped `MURPH_PUBLIC_ROUTES_WAF_REQUIRED=1` build setting makes
the authenticated active-config verifier fail closed even when Vercel system
environment variables are not exposed. Exact rule ids, project id, optional
team id, and the read-capable provider token stay in server-side deployment
configuration only.

## Non-goals

This release does not add accounts, API keys, writes, corrections, batch
endpoints, downloads, x402, a remote MCP server, plugins, permissive CORS,
formula-revision storage, or inferred product-test linkage.
