---
title: 'Dormant PostgreSQL fixtures drift from current production contracts'
severity: 'minor'
---

## Expected Behavior

Existing PostgreSQL integration cases should reach their intended storage and concurrency assertions against the current supported provider inventory and contact-privacy keyring.

## Current Behavior

The opted-in Linq inventory fixtures configure a current key with a higher prior key, which the current keyring contract rejects before SQL runs. The device database-spike suite freezes the provider inventory at 33 sources although the registry now supplies 34, and its hand-built runtime apply payload omits the source firstSeenAt required by the newly included provider. Additional opted-in suites still assume a single developer database name, invalid short KMS project identifiers, removed clinical connection fields, and a dirty revision that does not advance when a new webhook is accepted.

## Minimal Reproducible Example

Apply Web migrations to an isolated loopback murph_test database, enable MURPH_TEST_POSTGRES_CONCURRENCY=1, and run hosted-onboarding-linq-chat-health-inventory-postgres.test.ts, hosted-onboarding-linq-phone-number-inventory-postgres.test.ts, and device-sync-db-spike-resilience-postgres.test.ts through apps/web/vitest.config.ts.

## Context

Enabling the discovered required database gate exposed the stale test inputs. Fixture corrections preserve current schema, URL isolation, keyring restrictions, and provider source authority. Accepted webhook assertions now prove one advance from the seeded revision while rejected admission and duplicate replay preserve their prior state. Companion enrollment now mocks only provider email delivery so actual eligibility and database reads run. No production implementation or migration changes are needed.
