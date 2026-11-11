---
title: 'Concurrent root typecheck can remove Prisma imports during Web test collection'
severity: 'minor'
issue: 'cobuildwithus/murph#4813'
---

## Expected Behavior

The declared root typecheck and Web unit suite either coordinate their shared generated client or clearly require serialization.

## Current Behavior

Running root typecheck while the Web suite collects tests can produce a missing `.prisma/client/default` module. Root typecheck invokes Prisma generation; the affected test suite then fails before collecting any tests. Once generation finishes, that suite passes alone without a source change.

## Possible Solution

Document the shared generation boundary or coordinate generation and test collection through the existing verification owner. Avoid adding a separate test retry loop.

## Minimal Reproducible Example

1. In one checkout with dependencies prepared, start `pnpm --dir apps/web test` and `pnpm typecheck` concurrently.
2. When Prisma regeneration overlaps test collection, a suite importing the client can fail with a missing generated module.
3. Wait for typecheck to finish and rerun the affected suite without concurrent generation.

## Context

Observed during silent group line move verification. The environment suite collected zero tests during the overlap, then passed all 27 tests alone. The full Web suite needed another serialized run. No product-code change was needed for this collection failure.
