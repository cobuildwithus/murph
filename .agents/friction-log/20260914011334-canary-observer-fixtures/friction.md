---
title: 'Canary observer fixtures use retired workspace bundle refs'
severity: 'minor'
---

## Expected Behavior

Canonical observer tests should exercise the current v2 snapshot contract and keep its archive fingerprint distinct from the Browser Vault canonical query-source hash.

## Current Behavior

The encrypted-replica fixture uses a retired bundle ref and sets its archive hash equal to the replica source hash. That fixture passes a legacy helper that returns null for every valid v2 ref, concealing a broken current-format success path.

## Possible Solution

Use valid v2 snapshot fixtures with independent archive and canonical-source identities; preserve the encrypted replica and negative boundary assertions.

## Minimal Reproducible Example

Replace the snapshot fixture in `apps/web/test/hosted-onboarding-linq-production-canary-outcome.test.ts` with a valid v2 ref, using the public snapshot AAD builder. The observer returns not-ready for that otherwise valid fixture before the correction.

## Context

Retired fixture formats can produce green unit tests while excluding the current runtime contract. Keep current-format success proof alongside negative cases.
