# Hosted Web Contract Migrations

Use this directory for destructive hosted web database cleanup that must run
after the new Vercel production deployment is live and the prior production
function window has drained.

Each migration lives in a timestamped subdirectory with a `migration.sql` file:

```text
apps/web/prisma/contract-migrations/20260707173000_drop_old_columns/migration.sql
```

Keep normal Prisma migrations backward compatible with the currently deployed
app. Additive changes such as new nullable columns, new tables, and new indexes
belong in `apps/web/prisma/migrations` so the Vercel predeploy wrapper can run
them before build. New required schema shape does not belong here: required
columns, renames, `ALTER COLUMN ... SET NOT NULL`, and incompatible type changes
need an expand/backfill/switch/final-cleanup sequence so both old and new app
deployments can survive the deploy window. Only final cleanup, such as dropping
old columns, tables, indexes, or constraints that deployed code no longer uses,
belongs here so GitHub can run it after Vercel reports the production deployment
as successful, a bounded drain wait has elapsed, and the production alias still
points at that deployment.

Contract migration SQL must be safe to run inside one transaction and should be
idempotent where PostgreSQL supports it, for example `DROP COLUMN IF EXISTS`.
The runner sets short transaction-local lock and statement timeouts before each
migration body; if cleanup cannot run without waiting on live traffic, let it
fail and retry later. Do not use commands that PostgreSQL forbids inside a
transaction, such as `CREATE INDEX CONCURRENTLY`.
