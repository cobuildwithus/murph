# PR 179 ReviewGPT Round 1

## Goal

Resolve the accepted ReviewGPT round-1 finding for PR 179's Junction direct
provider Link token change.

## Constraints

- Keep the fix scoped to Junction provider slug normalization and focused tests.
- Preserve generic Junction Link sessions and selected-source allowlist checks.
- Do not commit local ReviewGPT response artifacts under `audit-packages/`.

## Current Evidence

- ReviewGPT found that `JunctionClient.createLinkToken` used a looser provider
  normalizer than the rest of Junction connect routing.
- The production selected-source path is already allowlist checked before
  reaching the client, but direct client callers can still pass hyphenated
  provider text.

## Plan

1. Normalize direct Link-token `provider` with `normalizeJunctionProviderSlug`.
2. Add focused client proof for hyphen-to-underscore normalization.
3. Run device-sync focused verification.
4. Commit, push, and rerun ReviewGPT.

## Status

Implemented. Focused device-sync typecheck and coverage passed, root typecheck
passed, and required security/privacy plus coverage-write audit passes reported
no required changes.
Status: completed
Updated: 2026-06-15
Completed: 2026-06-15
