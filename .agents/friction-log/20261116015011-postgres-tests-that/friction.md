---
title: 'Postgres tests that seed CURRENT_TIMESTAMP disagree with Prisma when the local server time zone isn''t UTC'
severity: 'minor'
---

## Expected Behavior

An opt-in PostgreSQL test that seeds rows with raw SQL (`CURRENT_TIMESTAMP + interval '1 hour'`) and then reads or filters them through Prisma sees the same instants Prisma writes, as it does in production, where the database runs in UTC.

## Current Behavior

`timestamp(3)` columns have no time zone. Prisma writes and compares them as UTC, but raw `CURRENT_TIMESTAMP` is converted to the session's `TimeZone`. On a local server whose default time zone isn't UTC, a row seeded as expiring a minute ago reads as unexpired (or the reverse) for hours, and expiry tests fail locally only.

## Possible Solution

Pin `TimeZone=UTC` in local test connections (for example `SET TIME ZONE 'UTC'` on raw `pg` clients and `options: "-c TimeZone=UTC"` on Prisma test pools), or note it in the PostgreSQL test section of `agent-docs/references/testing-ci-map.md`.

## Minimal Reproducible Example

With a local server whose `SHOW timezone` is not UTC: insert a row with `expires_at = CURRENT_TIMESTAMP - interval '1 minute'` through `pg`, then run a Prisma `updateMany({ where: { expiresAt: { gt: new Date() } } })`; it matches the expired row.

## Context

Hit while adding the custom connection action-request PostgreSQL proof; fixed in that test by pinning both its raw client and its Prisma pool to UTC.
