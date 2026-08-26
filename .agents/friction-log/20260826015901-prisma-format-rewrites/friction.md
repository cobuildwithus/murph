---
title: 'Prisma format rewrites the full hosted schema and breaks format guards'
severity: 'minor'
---

## Expected Behavior

Formatting a small additive Prisma model should either preserve the repository's established schema layout or have a documented command that formats only the edited block.

## Current Behavior

Running `pnpm --dir apps/web exec prisma format` for a small schema addition mechanically rewrites roughly half of the large schema and changes spacing asserted by existing migration tests. The unrelated churn must be restored before the intended model can be reapplied.

## Possible Solution

Document that contributors should not run full-schema Prisma formatting until the checked-in schema and exact-format guards are intentionally normalized together, or provide a scoped schema-format workflow.

## Minimal Reproducible Example

1. Add one small model to `apps/web/prisma/schema.prisma`.
2. Run `pnpm --dir apps/web exec prisma format`.
3. Inspect the schema diff and run the hosted privacy-foundation migration test.

## Context

This adds avoidable review noise and recovery work to ordinary additive schema changes.
