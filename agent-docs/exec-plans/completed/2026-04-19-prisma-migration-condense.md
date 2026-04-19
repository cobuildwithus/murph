# Condense hosted-web Prisma history into a single baseline migration for greenfield local resets.

Status: completed
Created: 2026-04-19
Updated: 2026-04-19

## Goal

- Replace the current multi-step `apps/web` Prisma migration chain with one baseline migration that matches the current schema so greenfield local databases can bootstrap from a single file.

## Success criteria

- `apps/web/prisma/migrations/` contains one hosted-web schema migration plus `migration_lock.toml`.
- The remaining migration SQL reflects the current hosted-web Prisma schema, including the latest hosted wake tables and owner-scoped external event identity shape.
- Tests and docs that pin the old incremental chain are updated to the new single-baseline expectation.
- Hosted-web typecheck and targeted tests pass against the condensed history.

## Scope

- In scope:
- `apps/web/prisma/migrations/**`
- `apps/web/test/hosted-onboarding-privacy-foundation-migration.test.ts`
- `apps/web/README.md`
- Out of scope:
- Runtime behavior changes in `apps/web/src/**`
- Cloudflare or assistant-runtime hosted wake execution changes
- Non-hosted-web Prisma or database workflows

## Constraints

- Technical constraints:
- Keep the resulting baseline aligned with the current checked-in Prisma schema, not an intermediate historical state.
- Treat this as a greenfield reset; do not preserve data backfills that only matter for upgrading an already-populated database.
- Product/process constraints:
- Preserve unrelated in-flight `apps/web` edits outside the migration-history/docs/test slice.
- Record clearly that existing local databases created from the old chain may need a reset or fresh migration application after this change.

## Risks and mitigations

1. Risk: The condensed baseline could accidentally drop schema elements that only existed in later migrations.
   Mitigation: Generate the replacement SQL from the current Prisma schema and keep a targeted test that asserts the key hosted tables and indexes exist in the single baseline.
2. Risk: Docs or tests could keep describing the old incremental chain.
   Mitigation: Update the migration-history test and hosted-web README in the same change.

## Tasks

1. Generate a single hosted-web baseline migration from the current Prisma schema and remove the superseded incremental migrations.
2. Update the hosted Prisma migration-history test to assert the new single-baseline shape.
3. Update hosted-web docs to describe the greenfield single-baseline setup.
4. Run hosted-web verification focused on Prisma/typecheck/test coverage, then commit via the plan-aware finish flow.

## Decisions

- Use a greenfield-only baseline migration that matches the current schema rather than preserving upgrade/backfill steps from the deleted incremental history.

## Verification

- Commands to run:
- `pnpm --dir apps/web prisma:generate`
- `pnpm --dir apps/web typecheck`
- `pnpm --dir apps/web test -- --run hosted-onboarding-privacy-foundation-migration.test.ts`
- Expected outcomes:
- Prisma client regenerates cleanly, hosted-web typecheck stays green, and the migration-history test matches the new single-baseline layout.
Completed: 2026-04-19
