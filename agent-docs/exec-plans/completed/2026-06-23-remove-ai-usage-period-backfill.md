Goal (incl. success criteria):
- Remove the hosted AI usage period counter backfill migration from source so clean environments no longer run it.
- Keep migration coverage tests aligned with the remaining migration history.

Constraints/Assumptions:
- Production has already recorded `2026062100_hosted_ai_usage_period_counter_backfill` as applied.
- Do not mutate the applied migration into a different SQL body; delete the source migration instead.
- Preserve unrelated active work and working-tree edits.

Key decisions:
- Treat this as a narrow apps/web migration-history change.

State:
- Active.

Done:
- Confirmed production `_prisma_migrations` has the migration applied.

Now:
- Delete the migration and update the migration inventory test.

Next:
- Run focused migration test, typecheck/app verification as required, audit, final review, and commit.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `apps/web/prisma/migrations/2026062100_hosted_ai_usage_period_counter_backfill/migration.sql`
- `apps/web/test/hosted-onboarding-privacy-foundation-migration.test.ts`
Status: completed
Updated: 2026-06-23
Completed: 2026-06-23
