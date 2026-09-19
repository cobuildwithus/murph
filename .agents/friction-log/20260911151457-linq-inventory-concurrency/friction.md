---
title: 'Linq inventory concurrency proof exhausts retries and misses commit conflicts'
severity: 'minor'
---

## Expected Behavior

Two bounded authoritative provider inventory replacements should converge using the existing serializable transaction retry owner.

## Current Behavior

The maximum-cardinality PostgreSQL proof can consume all three attempts within tens of milliseconds. A separate local reproduction fails at commit with a direct adapter serialization error that the inventory classifier does not recognize.

## Minimal Reproducible Example

Prepare an isolated loopback test database with the current schema, enable MURPH_TEST_POSTGRES_CONCURRENCY, and run the concurrent maximum-cardinality case in hosted-onboarding-linq-phone-number-inventory-postgres.test.ts.

## Context

This interrupts the required PostgreSQL CI lane and exposes incomplete convergence recovery in the production inventory owner.
