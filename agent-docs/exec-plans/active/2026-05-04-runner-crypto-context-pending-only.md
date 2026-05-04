# Runner crypto context pending-only cache

Status: active
Created: 2026-05-04
Updated: 2026-05-04

## Goal

- Remove the runner-outbound resolved plaintext crypto-context cache so shared Worker memory keeps only pending single-flight loads, not decrypted root material.

## Success criteria

- Concurrent outbound artifact requests for the same user/domain/environment still coalesce while the crypto context load is pending.
- Once the load resolves or rejects, the runner-outbound pending entry is deleted.
- Sequential requests can still benefit from the lower-level verified signed/encrypted envelope JSON cache, but they re-unwrap fresh `HostedUserCryptoContext` objects.
- Focused tests prove no resolved plaintext context reuse, pending coalescing, and rejected-load non-poisoning.
- Required verification and completion audits pass or unrelated blockers are documented.

## Scope

- In scope:
  - `apps/cloudflare/src/runner-outbound/shared.ts`
  - Focused runner outbound tests in `apps/cloudflare/test/runner-outbound.test.ts`
- Out of scope:
  - Changing the lower-level signed envelope JSON cache.
  - Adding production metrics for cache events.
  - Hosted web crypto provisioning or envelope signing behavior.

## Constraints

- Technical constraints: do not retain decrypted `HostedUserCryptoContext`, `rootKey`, or `keysById` in module-scope success caches; preserve fail-closed fetch/unwrap behavior.
- Product/process constraints: preserve unrelated dirty work and avoid exposing local account identifiers or home paths.

## Risks and mitigations

1. Risk: removing the success cache regresses burst behavior.
   Mitigation: keep a bounded pending-only single-flight map and add concurrent-load coverage.
2. Risk: sequential artifact requests trigger extra web-control calls.
   Mitigation: rely on the existing verified signed/encrypted envelope JSON cache and prove sequential calls re-unwrap without refetching when the envelope cache is valid.
3. Risk: stale pending promises delete newer entries.
   Mitigation: keep per-entry tokens and delete only when the token still matches.

## Tasks

1. Inspect current runner outbound cache and related tests.
2. Change the runner outbound crypto-context map to pending-only single-flight.
3. Update tests for no plaintext context retention and pending coalescing.
4. Run focused Cloudflare verification, typecheck, and required audits.
5. Close the plan and commit safely if no overlapping dirty work blocks a scoped commit.

## Decisions

- Keep environment-aware pending keys from the prior cache-key work, but do not keep resolved `HostedUserCryptoContext` promises after completion.
- Let the lower-level runtime envelope cache own post-resolution reuse because it stores signed/encrypted envelope JSON instead of plaintext roots.

## Verification

- Commands to run: focused runner outbound Vitest, `bash scripts/workspace-verify.sh test:diff ...`, `pnpm typecheck`, completion audits, and `git diff --check`.
