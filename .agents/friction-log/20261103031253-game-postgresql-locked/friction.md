---
title: 'Game PostgreSQL locked-preview assertion omits the existing preview reference'
severity: 'minor'
issue: 'cobuildwithus/murph#4499'
---

## Expected Behavior

The isolated PostgreSQL service suite should accept the current locked-entry projection while proving that encrypted payloads and media bytes remain unavailable.

## Current Behavior

The test named "never opens locked payloads, keeps previews separate, and reveals data on recap" fails its exact object assertion because views.ts already adds a same-day preview reference. The assertion omitted that reference even on the unchanged base implementation.

## Minimal Reproducible Example

Run the game-service-postgres.test.ts suite with MURPH_TEST_POSTGRES_CONCURRENCY=1 and a migrated isolated test database. The locked object contains an additional preview with a route kind and media URL.

## Context

Found during PR 5 group chat verification. This task updates the stale expected projection and retains the explicit media authorization denial and poisoned-envelope checks. No pair product behavior changes.
