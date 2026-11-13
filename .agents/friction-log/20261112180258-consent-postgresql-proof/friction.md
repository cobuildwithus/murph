---
title: 'Consent PostgreSQL proof rejects documented isolated test database names'
severity: 'minor'
---

## Expected Behavior

The consent persistence suite accepts an isolated loopback database named `murph_test_<slug>`, as required by the focused PostgreSQL verification guide.

## Current Behavior

The suite rejects that database name before collecting tests. Its guard accepts only the fixed consent database name and development database names, so a serial combined game and consent run cannot use the documented isolated test lane.

## Possible Solution

Accept the existing `murph_test_<slug>` naming convention in the consent suite's loopback safety guard.

## Minimal Reproducible Example

Run `apps/web/test/legal-consent-postgres.test.ts` with `MURPH_CONSENT_TEST_DB_URL` pointing to a migrated loopback database named `murph_test_consent_example`. Collection fails with the dedicated-test-database guard before any test runs.

## Context

This blocks focused game and consent verification in one isolated database. The fix changes only the test database-name allowlist.
