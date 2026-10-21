---
title: 'First-party session fixture omits its crypto preparation scope'
severity: 'minor'
---

## Expected Behavior

The hosted browser smoke fixture should create a first-party session using the same request-scoped encryption preparation required by the installed issuer.

## Current Behavior

Session issuance reaches the cache-only transaction without the prepared domain root. The browser smoke fails with HOSTED_DOMAIN_ROOT_PREPARATION_MISMATCH before navigation.

## Minimal Reproducible Example

Seed a synthetic canonical member with real hosted encryption and invoke issueHostedAppSession without an outer request cache. The transaction cannot decrypt the newly created authentication user.

## Context

The fixture must retain prepared roots across issuance, prewarm existing authentication records outside locks, and preserve the production prohibition on provider calls inside transactions.
