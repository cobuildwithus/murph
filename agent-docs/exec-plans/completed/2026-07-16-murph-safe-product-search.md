# Murph Safe public product search

Status: completed
Created: 2026-07-16
Updated: 2026-07-16

## Goal

- Ship Murph Safe as a public, read-only product evidence surface at `/search`.
- Let people and future agents retrieve the same normalized supplement, branded
  food, label, nutrition, and exact product-test data through a stable public
  API contract.
- Preserve Murph's open, composable direction without adding API keys, x402,
  MCP, downloads, revision infrastructure, or a second app in this release.

## Product contract

- The recurring question is "Is it Murph Safe?" Murph Safe names the evidence
  checking process. Results never certify a product as safe or unsafe.
- Every detail view distinguishes label contents, exact linked product tests,
  and known evidence gaps. Missing tests are an unknown, not a safety finding.
- The launch catalog includes every technically available supplement and
  branded purchasable-food source. Generic foods remain outside the first
  release because the product is record and package oriented.
- The public API is the Murph Product Data API and uses schema identifier
  `murph.public-products.v1`.
- Search terms stay out of URLs, page titles, referrers, persistent browser
  storage, analytics events, and application logs.

## Success criteria

- `/search` provides an explicit-submit, accessible search flow with grouped
  supplement and branded-food results, complete empty/error/rate-limit states,
  and stable product detail links.
- `/search/products/[productRef]` presents identity, tests, label contents,
  nutrition, unknowns, provenance, and correction contact in that order.
- `POST /api/public/v1/products/search` and
  `GET /api/public/v1/products/[productRef]` expose bounded normalized DTOs.
- `/api/public/v1/openapi.json` documents the exact runtime contract without a
  new dependency or hand-maintained divergent schema.
- Browser search calls the public HTTP API. Server-rendered detail calls the
  same shared service directly rather than self-fetching.
- Existing private `/api/foods` and `/api/supplements` behavior remains
  unchanged.
- Labels-database work is bounded by explicit pool, timeout, query-count, row,
  and payload limits suitable for public reads.
- Product tests are exact foreign-key matches only, SQL bounded, and include
  total, returned, and truncated semantics.
- Public routes suppress third-party analytics and set a no-referrer policy.
- A production preflight verifies the required Vercel WAF/rate-limit shape
  without downloading or exposing provider secrets.
- Focused proof, full acceptance, desktop/mobile browser evidence, Fable UI
  review, required specialist audits, green PR CI, and ReviewGPT `PASS` all
  complete on the final pushed head.

## Scope

- In scope: shared public contracts, public product service and DTO mapping,
  labels-database pool hardening, three public API endpoints, OpenAPI, Murph
  Safe search/detail UI, route privacy controls, Vercel WAF verifier, focused
  tests, browser proof, and current durable docs.
- Out of scope: writes or community corrections, API credentials, x402,
  billing, MCP/skills/plugins, bulk export, batch endpoints, permissive CORS,
  product/formula revision tables, a separate deployment, or inferred/fuzzy
  product-test linkage.

## Architecture decisions

1. Keep the feature in `apps/web` under `/search` and `/api/public/v1`.
2. Put wire contracts in the existing `@murphai/contracts` owner and product
   reads in one web-owned service. Route handlers stay thin.
3. Use deterministic opaque product references that encode only the record
   kind and current database id. They are identifiers, not authorization.
4. Return grouped search results because supplement and food rank scores are
   not comparable across their separate corpora.
5. Normalize structured rows when the source has them; preserve a label's raw
   ingredient statement when it does not. Never invent structure by splitting
   free text.
6. Publish all current sources, with source attribution and timestamps, while
   avoiding raw source payloads and internal database details.
7. Keep human search free. Application behavior is bounded in code; Vercel WAF
   supplies abuse controls before production exposure.
8. Add no dependency. Use existing Zod and JSON Schema support for OpenAPI.

## Risks and mitigations

1. Risk: brand language can imply a binary safety certification.
   Mitigation: evidence-first copy, exact test semantics, explicit unknowns,
   and no safe/unsafe result badge.
2. Risk: public search can amplify database connection or query pressure.
   Mitigation: retain a small singleton pool, add acquisition/idle/statement
   timeouts, bound rows and request bodies, SQL-limit test observations, and
   exercise concurrent failure paths.
3. Risk: search terms reveal health interests through analytics or URLs.
   Mitigation: POST body search, no query persistence or telemetry, no-referrer
   route policy, and explicit privacy tests.
4. Risk: WAF configuration drifts outside the repository.
   Mitigation: a fail-closed authenticated production verifier modeled on the
   existing Vercel WAF preflight, with secrets kept only in operator env.
5. Risk: a new public schema diverges from the website.
   Mitigation: one contract and service; client search consumes the public API,
   and detail rendering consumes the same service result.

## Tasks

1. Inspect current data schemas, search functions, product-test queries,
   analytics mounting, headers, and existing WAF verifier conventions.
2. Add the durable product specification and public contract.
3. Implement bounded search/detail reads and labels-pool lifecycle hardening.
4. Add public handlers and generated OpenAPI.
5. Build and refine the Murph Safe search and detail experience.
6. Add privacy/WAF gates, focused tests, and documentation.
7. Run verification, browser proof, Fable and specialist audits, then close the
   plan with a scoped commit.
8. Push, open the intent-complete PR, run CI and ReviewGPT concurrently, and
   resolve accepted findings until the final exact head is green and passes.

## Verification

- During implementation: focused contract, service, route, privacy, database,
  OpenAPI, and component/page tests.
- Final local gates: `pnpm test:diff`, `pnpm verify:acceptance`,
  `pnpm --dir apps/web test:viewport-overflow`, `git diff --check`, rendered
  desktop/mobile evidence, required Fable UI review, `frontend-review`, and
  `coverage-write`.
- PR gates: exact pushed-head preflight, green required CI, ReviewGPT full-patch
  round followed by correction rounds only when accepted behavioral findings
  change the implementation, and zero unresolved accepted findings.

## Audit outcomes

- Contract/API, database/service, UI/privacy, WAF/config, and scope/coverage
  reviews completed. Their accepted findings were resolved with focused
  regressions: exact-record test evidence, bounded database and response work,
  existing label-shape normalization, request-only error mapping, HTTP(S)-only
  public URLs, platform-opaque 429 documentation, privacy-safe request races,
  accessible errors, exact WAF route separation, and current durable docs.
- Fable completed the requested full UI review. Its ten findings were resolved,
  and the fresh remediation review returned zero remaining findings.
- Required `frontend-review` found two evidence-display issues and one contrast
  issue; the remediation review found two low-severity copy/width issues. All
  were fixed with component and rendered proof, and the final pass had no high-
  or medium-severity finding.
- Required `coverage-write` added direct empty-success and ordinary-server-error
  client coverage. The final focused Murph Safe suite passed 85 tests, the
  contracts suite passed 197 tests, and the PostgreSQL search/evidence suite
  passed 128 tests.
- The canonical low-contention `pnpm verify:acceptance` rerun passed repository
  guards, all workspace typechecks, package coverage and boundaries, 5,604 web
  tests, lint, dev smoke, the production Next build, 1,832 Cloudflare tests,
  and scenario-manifest coverage.
- Playwright production-seam and client-state coverage passed on phone and
  desktop, including the real search API, server-rendered detail, exact selected
  evidence, privacy-safe POST behavior, and opaque rate limiting. The full
  viewport command passed 67 of 69 checks; both remaining failures were the
  existing `/growth` redirect navigation race, while every Murph Safe viewport
  passed at 320, 375, 390, 768, and 1280 pixels.
- Live Vercel configuration now has separate bounded search and detail WAF rules
  ahead of the preserved existing rules, and the authenticated live-shape
  verifier passed without downloading or exposing provider secrets.
- Parent final diff, source-policy, privacy-identifier, docs-drift, and
  whitespace checks passed. ReviewGPT and PR CI remain post-push gates on the
  exact PR head.
Completed: 2026-07-16
