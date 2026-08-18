---
title: 'Native E2E owner option test normalized away its transport encoding'
severity: 'minor'
---

## Expected Behavior

The native iOS hosted E2E controller test should prove that PostgreSQL startup options are serialized in the exact URL form Prisma forwards successfully.

## Current Behavior

The test parsed the generated URL before asserting the `options` value. That normalization made `+` and `%20` look identical even though Prisma forwarded `+` literally and PostgreSQL rejected the resulting `+role` configuration parameter.

## Possible Solution

Assert both the decoded option value and the raw query string, keeping spaces percent-encoded for the Prisma connection boundary.

## Minimal Reproducible Example

Serialize `-c role=postgres` with `URLSearchParams`, pass the resulting `options=-c+role%3Dpostgres` URL through Prisma, and observe PostgreSQL reject the unknown `+role` parameter. The equivalent `%20` encoding connects successfully.

## Context

The first live sweep after the canonical-owner correction failed closed during the dedicated database reset, before deployment or native dispatch.
