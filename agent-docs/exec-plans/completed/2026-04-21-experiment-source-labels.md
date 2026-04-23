# Experiment source labels and titles

Status: completed
Created: 2026-04-21
Updated: 2026-04-24

## Goal

- Make experiment detail source cards show the real source surface, such as X Post, LinkedIn Post, Substack Post, or Blueprint Page, instead of falling back to Web Page when Health Commons metadata identifies a platform.
- Replace ID-only Bryan Johnson X source titles with readable titles that reflect the underlying post content.

## Success criteria

- Experiment detail source cards no longer render X, LinkedIn, Substack, or Blueprint sources as generic Web Page labels.
- Bryan Johnson X source titles shown in experiment source cards are no longer raw post-id labels.
- Health Commons generated outputs are regenerated from the content changes.
- Focused tests/typecheck for the touched Health Commons and hosted web experiment-detail slice pass, or any unrelated blocker is named precisely.
- A scoped commit includes only this task's files plus plan/ledger closeout.

## Scope

- In scope: Health Commons source metadata for the Bryan Johnson sauna source artifacts, generated Health Commons outputs, experiment-detail source label formatting, and directly coupled tests.
- Out of scope: changing source keys/slugs/routes, changing protocol claims, changing research ordering, broad Health Commons schema migrations, and unrelated experiment-detail UI layout work.

## Constraints

- Preserve unrelated dirty-tree edits and active Health Commons sauna/protocol UI rows.
- Do not expose direct personal identifiers in generated files, docs, commit messages, or handoff.
- Prefer a display-layer label mapping over a schema migration unless the existing schema cannot represent the requested behavior.

## Tasks

1. [x] Add platform-aware experiment source label formatting and focused tests.
2. [x] Replace ID-only X source titles in source frontmatter.
3. [x] Regenerate Health Commons generated files.
4. [x] Run focused verification and required completion audits.
5. [x] Create a scoped commit.

## Verification

- `pnpm --dir packages/health-commons generate`
- `pnpm --dir packages/health-commons generate:check`
- `pnpm --dir packages/health-commons typecheck`
- `pnpm --dir packages/health-commons test`
- `pnpm --dir apps/web typecheck:prepared`
- `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/health-commons-experiment-detail-page.test.ts`
- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff apps/web/src/lib/health-commons/experiment-detail.ts apps/web/test/health-commons-experiment-detail-page.test.ts packages/health-commons/content/sources/sauna/x-bryan-johnson-comprehensive-sauna-guide-2025-12-06.md packages/health-commons/content/sources/sauna/x-bryan-johnson-most-people-sauna-wrong-2025-11-12.md packages/health-commons/content/sources/sauna/x-bryan-johnson-fired-review-2026-04-06.md packages/health-commons/content/sources/sauna/x-bryan-johnson-core-temp-update-2026-04-03.md packages/health-commons/content/sources/sauna/x-bryan-johnson-core-temp-2026-04-16.md packages/health-commons/content/sources/sauna/x-bryan-johnson-ice-balls-2026-04-09.md packages/health-commons/generated/catalog.hash packages/health-commons/generated/catalog.json packages/health-commons/generated/entities.ndjson`
Completed: 2026-04-24
