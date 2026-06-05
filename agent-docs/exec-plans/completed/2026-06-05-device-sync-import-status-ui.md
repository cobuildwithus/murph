# Device sync import status UI

Status: completed
Created: 2026-06-05
Updated: 2026-06-05

## Goal

- Make biomarker/browser-vault UI show when wearable data is still importing so recently connected users do not misread partial private trends as final.

## Success criteria

- Browser-vault session responses carry a boolean device-sync importing signal using existing web dirty-state ownership.
- Browser-vault client/context exposes the signal without changing replica freshness, global sync indicators, or snapshot refresh.
- Biomarker private trend empty/insufficient states use the signal for honest importing copy and avoid premature "connect a device" prompts.
- Focused tests prove response parsing, route metadata, context status, and biomarker copy.

## Scope

- In scope:
  - `apps/web` browser-vault session route, loader, context, and biomarker private trend UI.
  - Focused app tests for the new status propagation and copy.
- Out of scope:
  - Device-sync scheduling, dirty ack semantics, provider importer behavior, browser-vault replica generation, and Oura payload normalization.

## Constraints

- Technical constraints:
  - Do not block browser-vault snapshots on dirty payload drain.
  - Do not add persisted state or a second queue.
  - Reuse existing `PrismaHostedDirtyConnectionStore.hasPendingDirtyConnectionForUser`.
- Product/process constraints:
  - Keep copy concise, neutral, and non-alarming.
  - Preserve unrelated active work in the checkout and coordination ledger.

## Risks and mitigations

1. Risk: The importing flag is mistaken for browser-vault freshness.
   Mitigation: Keep it as separate metadata and separate UI copy.
2. Risk: UI prompts users to reconnect while data is merely still importing.
   Mitigation: Suppress the connect action for importing empty states.

## Tasks

1. Add server/client metadata propagation.
2. Expose browser-vault context metadata without adding a global warning.
3. Update biomarker private trend empty-state copy/actions.
4. Add focused tests.
5. Run required verification and completion reviews.

## Decisions

- Treat pending device-sync dirty state as display metadata only, not a snapshot freshness gate.
- Do not show a global importing warning; only private trend empty/insufficient states use the importing copy.
- Keep ready/stale private trend charts unchanged even when pending imports exist.
- Fail open to `deviceSyncImportPending: false` if dirty-state metadata is temporarily unavailable.

## Verification

- `pnpm --dir apps/web test:prepared browser-vault-loader.test.ts browser-vault-context.test.tsx browser-vault-session-route.test.ts biomarker-private-trend-card.test.ts experiment-detail-client-contract.test.tsx` passed: 5 files, 65 tests.
- `pnpm --dir apps/web lint` passed.
- `pnpm test:diff apps/web/src/lib/browser-vault/session-handler.ts apps/web/src/lib/browser-vault/loader.ts apps/web/src/lib/browser-vault/context.tsx apps/web/src/components/biomarkers/biomarker-detail/biomarker-private-trend-card.tsx apps/web/test/browser-vault-loader.test.ts apps/web/test/browser-vault-context.test.tsx apps/web/test/browser-vault-session-route.test.ts apps/web/test/biomarker-private-trend-card.test.ts apps/web/test/experiment-detail-client-contract.test.tsx` passed dependency/boundary/guards/legal PDF/Prisma generate/health commons/dev smoke/lint/full apps/web tests/build compile, then failed in TypeScript on untouched `apps/web/src/lib/supplements.ts` missing `pg` declarations.
- `pnpm typecheck` failed on the same untouched `apps/web/src/lib/supplements.ts` missing `pg` declarations.
Completed: 2026-06-05
