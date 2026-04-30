# Biomarker Browser Vault Panel

## Goal

Land the clean long-term primitive for private wearable data on public Health Commons biomarker pages.

Success criteria:

- Biomarker pages derive private panels from the existing encrypted browser-vault replica instead of calling providers or materializing duplicate panel payloads.
- Health Commons bindings stay provider-agnostic and use existing browser-vault metric domain/key pairs.
- The private card no longer shows mocked personal data when no browser-vault session exists.
- Focused tests cover ready, empty, unsupported, and insufficient-data behavior.

## Constraints / Assumptions

- Preserve unrelated dirty work in this checkout.
- Do not introduce a generic vault read API or direct WHOOP/page coupling.
- Do not expose provider account ids, raw provider refs, raw payloads, tokens, or PHI in logs.
- Keep connection/scope/sync authority outside the selector for this slice; `apps/web` can compose a separate hosted device-sync summary later.

## Key Decisions

- Implement a browser-safe selector in `packages/query/src/browser-replica/` over existing `BrowserVaultQueryClient` metric/source rows.
- Treat the biomarker panel as a view model, not persisted state.
- Keep `apps/web` as a renderer of the selector result.

## State

Implemented; verification and completion audits in progress.

## Done

- Reviewed repo docs, current biomarker page, current browser-vault replica, and GPT-5.5 review conclusions.
- Added `selectBrowserVaultBiomarkerPanel` as a browser-safe selector over existing browser-vault metric/source rows.
- Wired the biomarker private trend card through the selector and removed mocked private data fallback.
- Mounted the private trend card on the biomarker overview and removed the old mock-backed trend detail component.
- Added contract validation that rejects provider-field-path metric bindings.
- Added focused query, contracts, and web tests.
- Required audits run: security/privacy, frontend, coverage-write, simplify, task-finish-review; post-fix frontend/task-finish re-review in progress.
- Verification passed: focused query/contracts/web tests, package query/contracts/web typechecks, query/contracts coverage, web eslint, smoke, diff check.
- Verification blocked: root `pnpm typecheck` and scoped `test:diff` fail in unrelated `packages/assistant-runtime/test/hosted-runtime-system-mailbox-notification.test.ts`.

## Now

- Wait for post-fix review results and close the execution plan.

## Next

- Close the execution plan after final verification.

## Open Questions

- UNCONFIRMED: whether coarse hosted device-sync connection summary is already available to biomarker pages; this slice should leave a typed extension seam without pulling provider state into the selector.

## Working Set

- `packages/query/src/browser-replica/**`
- `packages/query/test/**`
- `packages/query/src/browser.ts`
- `packages/query/src/browser-replica.ts`
- `packages/contracts/src/health-commons.ts`
- `packages/contracts/test/health-commons.test.ts`
- `apps/web/src/components/biomarkers/biomarker-detail/biomarker-overview.tsx`
- `apps/web/src/components/biomarkers/biomarker-detail/biomarker-private-trend-card.tsx`
- `apps/web/src/components/biomarkers/biomarker-detail/biomarker-trend-detail.tsx`
- `apps/web/test/biomarker-private-trend-card.test.ts`
Status: completed
Updated: 2026-05-01
Completed: 2026-05-01
