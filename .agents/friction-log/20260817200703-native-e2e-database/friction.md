---
title: 'Native E2E database reset bypasses the canonical migration owner'
severity: 'minor'
---

## Expected Behavior

The dedicated native iOS E2E database reset should recreate the schema under the same canonical `postgres` role enforced by hosted Web migrations.

## Current Behavior

The controller validates the dedicated database URL but passes it directly to `prisma migrate reset`. When the credential logs in through an administrative wrapper role, Prisma recreates the migration ledger and application tables under that login role. The subsequent hosted migration owner guard then fails closed.

## Possible Solution

Add the canonical role connection option before invoking Prisma reset and cover preservation of existing connection options in the focused controller suite.

## Minimal Reproducible Example

Reset a synthetic E2E database using a credential role that may assume `postgres`, then run the hosted migration owner check. The ledger exists but is owned by the credential role unless the reset connection explicitly assumes `postgres`.

## Context

The first isolated Vercel candidate build proved this mismatch after the protected controller had already completed safe cleanup and exact-commit deployment creation.
