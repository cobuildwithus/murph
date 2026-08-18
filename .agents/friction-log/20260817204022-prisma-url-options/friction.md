---
title: 'Native E2E owner option test normalized away its transport encoding'
severity: 'minor'
---

## Expected Behavior

The native iOS hosted E2E controller test should prove that PostgreSQL startup options are serialized in the exact URL form Prisma forwards successfully.

## Current Behavior

The controller test parsed the generated URL before asserting the `options` value, while the downstream hosted migration test expected the raw `+` form. The normalization made `+` and `%20` look identical at one boundary and encoded the broken transport as expected behavior at the next, even though Prisma forwarded `+` literally and PostgreSQL rejected the resulting `+role` configuration parameter.

## Possible Solution

Assert both the decoded option value and raw query string at both existing owner-composition boundaries, keeping spaces percent-encoded for Prisma.

## Minimal Reproducible Example

Serialize `-c role=postgres` with `URLSearchParams`, pass the resulting `options=-c+role%3Dpostgres` URL through Prisma, and observe PostgreSQL reject the unknown `+role` parameter. The equivalent `%20` encoding connects successfully.

## Context

The first live sweep after the canonical-owner correction failed closed during the dedicated database reset, before deployment or native dispatch.
