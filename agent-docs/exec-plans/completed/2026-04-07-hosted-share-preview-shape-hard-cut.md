# Hard-cut hosted share preview to a tiny summary shape

Status: completed
Created: 2026-04-07
Updated: 2026-04-07

## Goal

- Replace the hosted-share preview metadata with a deliberately tiny UX-only summary so Postgres does not store copied item titles or a mini mirror of the share payload.

## Success criteria

- `HostedSharePreview` contains only category/count summary data plus the existing `logMealAfterImport` flag.
- Hosted share preview metadata in Postgres no longer stores copied food/recipe/protocol titles.
- Hosted share pages and invite flows render generated copy from that tiny preview shape.
- Acceptance/import still uses the opaque Cloudflare-owned share payload and remains fail-closed when that payload is missing.
- Focused tests and docs reflect the hard cut with no mixed old/new preview shape left behind.

## Scope

- In scope:
- Shrink the hosted-share preview contract, codec, UI copy, tests, and schema/migration shape.
- Remove preview-title/title-array storage and related rendering logic.
- Update docs to describe the simpler ownership split.
- Out of scope:
- Changing the actual share-pack import contract or broad hosted onboarding UX beyond the share-preview copy.

## Constraints

- Treat this as greenfield and prefer a hard cut over compatibility scaffolding.
- Keep Cloudflare as the owner of the opaque acceptance-time share payload only.
- Preserve unrelated dirty-tree edits outside the hosted-share lane.

## Risks and mitigations

1. Risk: The UI could become too vague after dropping titles.
   Mitigation: Generate clear headline/subtitle copy from category and count summary.
2. Risk: Leaving mixed preview shapes around would complicate future reads.
   Mitigation: Hard-cut the preview codec, tests, and migration shape together with no fallback reader.
3. Risk: Removing `previewTitle` could break expired/consumed rendering.
   Mitigation: Use generic expired/consumed copy derived from the tiny preview shape rather than persisted titles.

## Tasks

1. Shrink the preview type/codec/schema to category/count summary only.
2. Update hosted-share and invite UI to render generated copy from that summary.
3. Update focused tests, migration/docs, and scenario proof to the new shape.
4. Run verification, required review, and a scoped commit.

## Decisions

- Keep counts because they are low-sensitivity and still useful UX.
- Remove copied food/recipe/protocol titles from Postgres preview metadata entirely.
- Prefer generated UI labels over storing a preview headline/title in Postgres.
- Treat the migration rewrite as a greenfield hard cut; previously applied richer `preview_json` rows are intentionally out of scope for this lane.

## Verification

- Completed:
- `node node_modules/.pnpm/prisma@7.5.0_@types+react@19.2.14_better-sqlite3@12.6.2_react-dom@19.2.4_react@19.2.4__react@19.2.4_typescript@5.9.3/node_modules/prisma/build/index.js generate --config apps/web/prisma.config.ts`
- `./node_modules/.bin/tsx scripts/ensure-next-route-type-stubs.ts apps/web`
- `node scripts/check-workspace-package-cycles.mjs`
- `./node_modules/.bin/tsc -b tsconfig.json --pretty false`
- `node ../../node_modules/.pnpm/eslint@9.39.4_jiti@2.6.1/node_modules/eslint/bin/eslint.js src components test app --ext .ts,.tsx` (from `apps/web`) with warnings only outside this lane
- `./node_modules/.bin/vitest run --config apps/web/vitest.workspace.ts apps/web/test/hosted-share-service.test.ts apps/web/test/hosted-share-internal-create-route.test.ts apps/web/test/hosted-share-import-complete-route.test.ts apps/web/test/hosted-execution-contract-parity.test.ts apps/web/test/share-link-client.test.ts apps/web/test/join-invite-client.test.ts apps/web/test/join-page.test.ts --no-coverage`
- `./node_modules/.bin/vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-execution-contract-parity.test.ts --no-coverage`
- `../../node_modules/.bin/vitest run --config vitest.config.ts test/hosted-share-issuer.test.ts --no-coverage` (from `packages/hosted-execution`)
- `./node_modules/.bin/vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-share-service.test.ts apps/web/test/share-link-client.test.ts apps/web/test/join-invite-client.test.ts --no-coverage`

## Review

- Required audit pass completed.
- Findings about previously applied richer preview rows were accepted as out of scope because this lane is explicitly greenfield-only.
- Follow-up coverage was added for the generic share preview UI copy and meal-log messaging.
Completed: 2026-04-07
