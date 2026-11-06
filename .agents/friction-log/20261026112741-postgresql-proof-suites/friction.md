---
title: 'PostgreSQL proof suites accept different local database names'
severity: 'minor'
---

## Expected Behavior

Every opt-in PostgreSQL proof under apps/web/test accepts the same loopback local database names, so one migrated local database can run any focused set of suites together.

## Current Behavior

Guards differ per file. Some accept any `murph_dev_*` or `murph_test*` database, `better-auth-member-postgres-concurrency.test.ts` accepts only a fixed list of `murph_dev_*` names plus `murph_test*`, and `scripts/run-postgres-tests.mjs` accepts only `murph_test*`. A focused run that pairs a new suite with an auth suite on a `murph_dev_<slug>` database fails at import with "Canonical auth proof requires an isolated local test database."

## Possible Solution

Share one guard helper (the runner's `murph_test(?:_[a-z0-9_]+)?` rule) across the suites and document it in the testing map.

## Minimal Reproducible Example

1. Create and migrate a loopback database named `murph_dev_example`.
2. Run `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/murph_dev_example MURPH_TEST_POSTGRES_CONCURRENCY=1 pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/better-auth-member-postgres-concurrency.test.ts`.
3. The suite throws before running; renaming the database to `murph_test_example` works.

## Context

Hit while proving a new ops seed suite together with the review-account helper's existing auth suite. Cost one database rename and rerun.
