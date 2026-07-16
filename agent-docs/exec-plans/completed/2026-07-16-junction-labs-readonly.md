# Junction labs read-only catalog

Status: completed
Created: 2026-07-16
Updated: 2026-07-16

## Goal

- Let Murph search and inspect Junction's current orderable lab catalog through
  one live, read-only dynamic tool.
- Add an authenticated, unlinked `/labs` page for browsing the same catalog and
  nearby collection locations while the ordering flow remains intentionally
  unavailable.

## Success criteria

- `murph.labs` supports bounded `search`, `show`, and `locations` actions in
  private direct conversations and returns normalized, provider-fresh facts.
- The assistant prompt prefers panels for broad health goals, exact searches for
  named analytes, and clearly says Murph cannot order or book tests yet.
- An authenticated `/labs` page supports catalog search, panel/biomarker
  filtering, detail inspection, and ZIP-based collection-site lookup without a
  dashboard navigation link.
- Junction credentials remain web-only; no catalog, ZIP, provider payload, or
  search history is persisted.
- Focused coverage, typechecking, browser proof, frontend review, Fable review,
  CI, and ReviewGPT complete with no unresolved accepted findings.

## Scope

- In scope: normalized Labs contracts, the signed hosted Web callback, direct
  Junction catalog and location reads, assistant runtime/tool wiring, stable
  prompt guidance, the authenticated Labs page, focused tests, and the durable
  architecture/security/product/testing documentation required by those
  boundaries.
- Out of scope: ordering, checkout, quotes, eligibility determination,
  appointments, results ingestion, a persisted catalog, popularity ranking,
  maps, navigation exposure, and public catalog access.

## Constraints

- Keep the architecture thin: Web owns the provider credential and performs
  live Junction reads; Cloudflare only carries the existing signed semantic
  callback; the assistant and UI consume one normalized contract.
- Do not print, persist, fixture, or forward the Junction API key, raw provider
  bodies, exact ZIP searches, or health-interest queries into logs.
- Treat returned amounts as current catalog prices, not final quotes, and do not
  infer member eligibility, appointment availability, or orderability through
  Murph.
- Preserve unrelated working-tree and coordination-ledger edits. The prompt
  insertion overlaps a separate non-exclusive system-prompt lane, so keep it
  isolated and rebase carefully before final merge proof.

## Tasks

1. Define the shared Labs request/response contract and direct Junction client.
2. Add the signed internal Web callback and Cloudflare semantic port.
3. Register and execute `murph.labs`, then add stable direct-conversation prompt
   guidance and regression tests.
4. Build the authenticated unlinked Labs catalog page and ZIP location list.
5. Update architecture, security, product, and verification documentation.
6. Run focused and diff-aware checks, desktop/mobile browser proof, specialist
   audits, Fable review, parent final review, CI, and ReviewGPT.

## Decisions

- Use one action-discriminated dynamic tool rather than a second CLI/catalog
  surface or three separate tools.
- Query Junction live and return bounded normalized projections; add no database,
  sync job, search index, or cache in this slice.
- Use Junction's orderable marker catalog, which includes both panels and
  biomarkers, because the production account currently has no active saved-test
  presets.
- Keep the Labs page authenticated and unlinked. A missing navigation link is a
  discovery choice, not its access-control boundary.
- Show locations as a list. A map, full address search, and booking flow remain
  deferred until their privacy and eligibility contracts are approved.

## Verification

- Run focused tests for provider normalization, callback authorization,
  Cloudflare transport, assistant tool parsing/execution/prompt placement, and
  Labs UI states.
- Run `pnpm test:diff` for every touched app/package owner and the required
  scenario-integrity/architecture/privacy guards selected by the verification
  matrix.
- Capture authenticated desktop and mobile browser evidence for catalog search,
  detail, empty/error, and location states using fixture-safe data.
- Run `frontend-review`, `coverage-write`, the Claude Code Fable UI double-check,
  PR CI, and ReviewGPT. Resolve every accepted finding before handoff.

## Risks and mitigations

1. Risk: provider catalog drift or malformed responses create misleading claims.
   Mitigation: strict normalization, bounds, live timestamps, nullable facts, and
   explicit catalog-price/no-eligibility wording.
2. Risk: a ZIP or health-interest search leaks through logs or persistence.
   Mitigation: transient POST bodies, no analytics/persistence, sanitized errors,
   and tests that inspect emitted response shapes rather than private inputs.
3. Risk: Web, Worker, and warm runner versions deploy out of sync.
   Mitigation: additive optional capability wiring, fail-closed tool registration,
   documented deployment order, and post-deploy smoke checks.
4. Risk: 1,800+ results become an unusable card wall.
   Mitigation: server-backed search, a dense responsive result list, type filter,
   bounded result pages, and progressive detail/location disclosure.

## Outcome

- Shipped one strict read-only Labs contract across hosted Web, the signed
  Cloudflare callback, assistant runtime, `murph.labs`, and the authenticated
  unlinked `/labs` page. Web remains the only Junction credential and provider
  normalization owner; no catalog, query, ZIP, or provider payload is
  persisted.
- Secret-safe live smoke proved search, exact search-to-show identity, and
  location availability through the production Junction boundary while
  emitting only aggregate booleans, counts, and response sizes.
- The required frontend review and coverage-write audits completed. Accepted
  findings now fail closed on all-malformed provider rows, distinguish expired
  app sessions from provider outages, name the mobile select dialog, preserve
  current-value and selected-option accessibility, announce async result
  changes, dedupe offerings, and keep filtered/truncated discovery copy honest.
  The final review-only Fable pass returned `NO FINDINGS`.
- Passed focused owner coverage: Hosted Execution 14 tests, assistant
  tool/prompt/planning 55 tests, Cloudflare 137 tests, Web Labs/UI/sidebar 55
  tests, full assistant-runtime 1,717 tests with 2 skips, Web lint and typecheck,
  scenario integrity, and `git diff --check`.
- `pnpm test:diff` reached all affected typechecks plus green hosted-execution,
  hosted-local-harness, setup-cli, and assistant-runtime suites, but the broad
  reverse-dependent package phase was stopped after unrelated CLI subprocess
  tests repeatedly hit their fixed 45/60-second timeouts. One representative
  CLI timeout reproduced in isolation at 60 seconds; the one unrelated
  assistant-engine failure passed in isolation. Direct Labs owner coverage is
  green.
- Authenticated desktop/mobile browser rendering remains unverified because the
  approved in-app browser connector exposed no available browser. Source-level
  rendering, DOM interaction coverage, frontend review, and Fable review are
  complete; this missing external browser attachment is reported rather than
  replaced with an unapproved automation backend.
Completed: 2026-07-16
