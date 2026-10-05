---
title: 'Usage-denial PostgreSQL proof needs a migrated schema unlike its latency-query sibling'
severity: 'minor'
---

## Expected Behavior

The opt-in PostgreSQL proofs that exercise the reply-latency health query run against any isolated loopback test database, as `testing-ci-map.md` describes for `hosted-runtime-latency-alert-query-postgres.test.ts`.

## Current Behavior

`apps/web/test/hosted-mailbox-usage-denial-postgres.test.ts` creates its own temp tables for traces, deliveries and mailbox items, but also calls `tx.hostedLinqAlert.deleteMany()`, so it fails on an unmigrated test database with "The table `public.hosted_linq_alert` does not exist". The latency-query proof passes on the same database. Running both together needs a migrated local database instead.

## Possible Solution

Create a temp `hosted_linq_alert` table in the proof like its other fixtures, or document that this proof requires a migrated database.

## Minimal Reproducible Example

1. Create an empty loopback database.
2. `DATABASE_URL=<empty loopback db> MURPH_TEST_POSTGRES_CONCURRENCY=1 pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/hosted-runtime-latency-alert-query-postgres.test.ts apps/web/test/hosted-mailbox-usage-denial-postgres.test.ts`
3. The query proof passes and the usage-denial proof fails on `hosted_linq_alert`.

## Context

Hit while changing the reply-latency health query, which both proofs exercise. It cost one rerun against a migrated database.
