# Hosted Web Contract Migrations

Use this directory for destructive hosted web database cleanup that must run
after the new Vercel production deployment is live.

Each migration lives in a timestamped subdirectory with a `migration.sql` file:

```text
apps/web/prisma/contract-migrations/20260707173000_drop_old_columns/migration.sql
```

Keep normal Prisma migrations backward compatible with the currently deployed
app. Additive changes such as new nullable columns, new tables, and new indexes
belong in `apps/web/prisma/migrations` so the Vercel predeploy wrapper can run
them before build. Contract changes such as `DROP COLUMN`, `DROP TABLE`, column
or table renames, `ALTER COLUMN ... SET NOT NULL`, incompatible column type
changes, or other destructive cleanup belong here so GitHub can run them after
Vercel reports the production deployment as successful.

Contract migration SQL must be safe to run inside one transaction and should be
idempotent where PostgreSQL supports it, for example `DROP COLUMN IF EXISTS`.
Do not use commands that PostgreSQL forbids inside a transaction, such as
`CREATE INDEX CONCURRENTLY`.
