# Murph Safe public product search

Status: Active
Last verified: 2026-07-16

## Product promise

Murph Safe is the public evidence-checking surface at `/search`. It answers the
question “Is it Murph Safe?” by showing what Murph can substantiate about a
specific product record. It never certifies a product as safe or unsafe.

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

Search terms must not enter URLs, browser history state, page metadata,
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
endpoints, downloads, x402, MCP, plugins, permissive CORS, formula-revision
storage, or inferred product-test linkage.
