# Ratchet the workout-delivery runner bundle budget

Status: completed
Created: 2026-08-25
Updated: 2026-08-25

## Goal

- Unblock the production runner deploy after the reviewed workout-delivery
  context extended the existing lazy Assistant Engine graph.
- Preserve the existing bundle guard policy: an exact measured public Linux
  baseline, 32 KiB of reviewed graph allowance, and 8 KiB reserved for the
  managed production overlay.

## Evidence

- The exact merged public Linux bundle measured 9,456,843 bytes.
- The production predeploy bundle measured 9,465,635 bytes and stopped before
  any production mutation because the existing 9,464,796-byte ceiling was 839
  bytes too low.
- Entry and static-startup closure measurements remained within their existing
  limits, and the largest inputs remained in already-bundled packages.

## Scope

- In scope: the vault CLI total byte budget, its measurement comment, and the
  locked boundary test.
- Out of scope: changing bundle contents, dependencies, runtime behavior,
  entry/static-startup limits, Worker behavior, or deployment workflow logic.

## Tasks

1. Ratchet the total ceiling from the exact public Linux measurement while
   preserving the existing allowances.
2. Run the focused budget-policy test, Cloudflare typecheck, and fresh bundle
   assembly.
3. Complete ReviewGPT and exact-head CI, merge, then rerun the protected
   production deploy with immediate container rollout and live smoke.

## Verification

- Focused `runner-bundle-cli-bundle` test.
- Cloudflare typecheck.
- Fresh runner bundle assembly with CLI parity probes.
- Exact-head required CI and protected production deploy smoke.

## Results

- The focused bundle-policy test passed all 14 tests.
- Cloudflare typecheck passed.
- Fresh local runner assembly passed at 9,458,746 total bytes, 671 entry
  bytes, and 24,950 static-startup bytes; all CLI parity probes passed.
- The protected PR and deployment workflows remain the exact-Linux and
  production-overlay proof owners after this implementation commit.
Completed: 2026-08-25
