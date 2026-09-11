---
title: 'Linq inventory PostgreSQL rotation fixture declares a future privacy key'
severity: 'minor'
---

## Expected Behavior

The opt-in configured-line inventory proof should seed a v1 row, rotate to v2 with v1 retained, and exercise the real synchronization SQL.

## Current Behavior

Its initial fixture declares v1 as current while also supplying v2. The current contact-privacy parser rejects a keyring whose other version is newer, so the proof fails before its database behavior is reached.

## Possible Solution

Seed with only v1, then install v2 plus v1 when rotating. This task updates the existing fixture without relaxing the production keyring validation.

## Minimal Reproducible Example

Against an isolated migrated loopback test database, run `MURPH_TEST_POSTGRES_CONCURRENCY=1 pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/hosted-onboarding-linq-phone-number-inventory-postgres.test.ts`. The legacy configured-row case fails when calculating its first lookup key.

## Context

This pre-existing fixture defect blocked the local PostgreSQL evidence for removing a retired Linq policy field. All identifiers and keys in the reproduction are synthetic.
