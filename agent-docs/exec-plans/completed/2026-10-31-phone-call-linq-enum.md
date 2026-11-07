# Restore direct phone-call enum compatibility and protect migration history

Status: completed
Created: 2026-10-31
Updated: 2026-10-31

## Outcome and boundaries

Restore the existing Linq reservation path by adding its missing PostgreSQL enum
value through an idempotent forward migration. Preserve Telegram and fresh
database initialization. Do not alter existing migrations, schema, unrelated
drift, production state, or provider behavior. Local commit only; no push or PR.

## Implementation

- Add one enum extension with the existing five-second lock timeout convention.
- Extend Pull Request Evidence with an immutable migration history guard.
  Compare merge-base-to-head changes against base-branch migration paths, with
  rename detection disabled. No bypass; new migration paths remain editable.
- Extend the existing production migration guard tests to compare the schema
  against fresh and previously applied Telegram-only migration histories.
- Document immutability in the existing Web Prisma owner.

## Proof and review

All exit codes below were captured from the process result, never a pipeline.

- `pnpm install --frozen-lockfile --prefer-offline`: exit 0.
- `node --test scripts/check-pr-migration-history.test.mjs`: exit 0, seven
  behavioral tests. The first attempt exited 1 because the local privacy hook
  rejected the synthetic fixture email; a synthetic noreply email fixed it.
- `node --test scripts/check-frontend-design-proof.test.mjs scripts/check-pr-architecture-summary.test.mjs scripts/check-pr-changelog.test.mjs scripts/check-pr-complexity-summary.test.mjs scripts/check-pr-deployment-concerns.test.mjs scripts/check-pr-migration-history.test.mjs`:
  exit 0, all 51 PR Evidence tests passed.
- `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/production-migration-guard.test.ts`:
  exit 0, all 74 tests passed, including the unchanged destructive baseline.
- `pnpm --dir apps/web typecheck`: exit 0, including generation prerequisites.
- `pnpm complexity:diff --base origin/main`: exit 0; new guard maximum
  complexity 5, no hotspots or complexity debt.
- `git diff --check`: exit 0.
- `git diff --exit-code origin/main -- apps/web/prisma/migrations/20260815120000_hosted_phone_call_result_notification_channel/migration.sql apps/web/prisma/schema.prisma apps/web/scripts/run-prisma-migrate-deploy.ts`:
  exit 0; original migration, schema and deploy baseline remain untouched.

### Local PostgreSQL proof

`python3 .tmp/verify-phone-call-enum.py`: exit 0. This ignored, task-local
driver created two uniquely named loopback-only databases using `createdb`.
Every subprocess exit code was checked explicitly. Both databases were dropped
after success; the temporary migration-history copy was removed.

Fresh history:
- `pnpm --dir apps/web prisma:migrate:deploy`: exit 0 from an empty database.

Historical fixture:
- Copy the migration history into an ignored fixture, omit the new migration,
  and set only the copied original enum definition to Telegram-only.
- `pnpm --dir apps/web exec prisma migrate deploy --config .tmp/phone-call-enum-proof/prisma.config.ts`:
  exit 0; PostgreSQL enum readback returned only `telegram`.
- `pnpm --dir apps/web prisma:migrate:deploy`: exit 0 against the same database
  using the actual checked-in history, applying the forward migration.

Both histories:
- `psql -XAt -v ON_ERROR_STOP=1 -d <local-proof-db> -c <enum-readback>`:
  exit 0, values exactly `linq,telegram`; both enum casts succeeded and the
  new migration had exactly one finished ledger entry.
- `psql -X -v ON_ERROR_STOP=1 -d <local-proof-db> -f apps/web/prisma/migrations/20261031230000_hosted_phone_call_linq_result_notification_channel/migration.sql`:
  exit 0, proving SQL replay idempotence independently of the Prisma ledger.
- Repeat `pnpm --dir apps/web prisma:migrate:deploy`: exit 0, no pending work.
- `dropdb <local-proof-db>`: exit 0.

Parent review found no ownership or privacy changes. The only DDL adds the enum
value; no DML uses it before commit. The guard uses NUL-delimited Git paths and
disables rename detection, checks exact base/head SHAs, fails closed without
history, and does not mistake unrelated base additions for PR deletions.
No new dependency, workflow, bypass, destructive baseline exemption, or
production diagnostic was needed. Product proof is Ready at the local schema
boundary; actual provider calls and production deployment remain untested.

## Deployment and omissions

The ordinary Vercel predeploy migration lane will apply the additive repair.
Older readers and Telegram writers remain valid; no coordinated runtime change
is needed. No destructive baseline changes or enum removal rollback.
Production restoration is unverified until a separately authorized deployment.
No public release note is published by this local-only task; no PR exists.
Completed: 2026-10-31
