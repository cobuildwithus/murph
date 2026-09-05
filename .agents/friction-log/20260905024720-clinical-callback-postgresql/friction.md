---
title: 'Clinical callback PostgreSQL proof uses invalid KMS project identifiers'
severity: 'minor'
---

## Expected Behavior

The opt-in clinical callback PostgreSQL concurrency proof should reach its controlled transaction barriers using local synthetic crypto configuration.

## Current Behavior

Its crypto fixture uses a four-character project identifier rejected by the current exact KMS resource-name validator, so every case fails before the concurrency proof begins.

## Minimal Reproducible Example

Apply Web migrations to an isolated loopback PostgreSQL database and run the clinical-records-account-deletion-postgres-concurrency test with MURPH_TEST_POSTGRES_CONCURRENCY=1 and that local DATABASE_URL.

## Context

Found while adding clinical consent-withdrawal race coverage. The task updates the synthetic project identifier to satisfy the existing validator; production validation is unchanged.
