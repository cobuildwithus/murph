# Collapse hosted-web Prisma migrations into one greenfield baseline

Status: completed
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Collapse the hosted-web Prisma migration history back to one checked-in baseline migration because the hosted Postgres path is still greenfield.
- Keep the single baseline SQL file aligned with the current `apps/web/prisma/schema.prisma` shape.

## Success criteria

- `apps/web/prisma/migrations/2026040600_init/migration.sql` matches the current Prisma schema, including the hosted vault-sync and hosted AI usage columns/indexes now represented by later follow-up migrations.
- The redundant follow-up migration directories are removed so only one migration SQL file remains under `apps/web/prisma/migrations/`.
- The hosted-web migration guard test reflects the single-baseline layout and still proves the checked-in SQL contains the expected schema details.
- Required verification and completion steps are recorded, and the task lands as a scoped commit without disturbing unrelated dirty-tree work.

## Scope

- `apps/web/prisma/migrations/**`
- `apps/web/test/hosted-onboarding-privacy-foundation-migration.test.ts`
- Active plan and coordination-ledger bookkeeping only

## Constraints

- Treat this as a greenfield schema-history cleanup only; do not change the actual Prisma datamodel in `apps/web/prisma/schema.prisma`.
- Preserve unrelated dirty-tree edits, especially the in-progress research tooling row already active in the coordination ledger.
- Keep the migration baseline generated from the live schema rather than hand-merging drift-prone SQL.

## Tasks

1. [x] Register the task in the coordination ledger.
2. [x] Generate the current hosted-web baseline SQL from the Prisma schema and compare it against the checked-in baseline.
3. [x] Replace the split migration chain with the single refreshed baseline migration.
4. [x] Update the hosted-web migration guard test for the single-baseline layout.
5. [x] Run the required verification and completion workflow.
6. [ ] Create a scoped commit.

## Verification

- Passed: `pnpm --dir apps/web exec prisma validate --config prisma.config.ts`
- Passed: `pnpm --dir ../.. exec vitest run apps/web/test/hosted-onboarding-privacy-foundation-migration.test.ts --project hosted-web-onboarding-core --config apps/web/vitest.workspace.ts --no-coverage`
- Passed: normalized direct proof that `pnpm --dir apps/web exec prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script` matches `apps/web/prisma/migrations/2026040600_init/migration.sql`
- Passed: `pnpm verify:acceptance`
- Passed: `git diff --check -- apps/web/prisma/migrations/2026040600_init/migration.sql apps/web/prisma/migrations apps/web/test/hosted-onboarding-privacy-foundation-migration.test.ts agent-docs/exec-plans/active/2026-04-23-web-prisma-baseline-collapse.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- Audit: required `coverage-write` pass completed with no additional proof changes needed
- Audit: required `task-finish-review` pass completed with no findings; noted the expected greenfield assumption and a residual guard granularity note only
Completed: 2026-04-23
