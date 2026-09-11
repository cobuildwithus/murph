---
title: 'Production canary replica fixture expires against the wall clock'
severity: 'minor'
---

## Expected Behavior

The production canary outcome observer tests should exercise canonical cardinality, authorization, decryption, and error privacy independently of the day they run.

## Current Behavior

The fixture uses a fixed replica generation timestamp while the real freshness owner defaults to the current clock and a 24-hour maximum age. Once that age expires, ten cases return the not-ready result before reaching their intended assertions. The same ten failures reproduce in the focused local file and the release Web test shard.

## Possible Solution

Pin Date.now to the synthetic fixture generation time using the test suite's existing automatic mock restoration. Keep timers and cryptographic operations real. Add an explicit expired-replica case so the production freshness boundary remains covered.

## Minimal Reproducible Example

After the fixed fixture is more than 24 hours old, run `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-onboarding-linq-production-canary-outcome.test.ts` before the clock correction. Ten tests fail by returning not-ready before canonical observation or decryption.

## Context

This is an isolated test-clock defect. Production freshness, source matching, member authority, and browser behavior require no changes.
