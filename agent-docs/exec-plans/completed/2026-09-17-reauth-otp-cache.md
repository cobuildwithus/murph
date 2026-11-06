# Restore verification-code requests during reauthentication

Status: completed
Created: 2026-09-17
Updated: 2026-09-17

## Outcome and invariant

Restore phone and email code requests for an existing signed-in account.
Keep current-session and linked-contact checks, rate limits, and passkey
requirements intact. Prepared encryption keys remain request-scoped and wiped.

## Cause and smallest correction

The OTP send request calls bound reauthentication preparation without an unwrap
cache. Its control-root preparation requires that scope and throws before code
delivery. Verification already has the scope. Wrap send-time preparation with
the existing fresh-cache owner; no new state, dependencies, or authority.

## Proof and product walkthrough

- Reproduce phone and email send failures using the real root preparation and
  cache owners with synthetic KMS/database ports.
- Prove successful preparation reaches delivery, rejected preparation prevents
  delivery, and keys are wiped on success and failure.
- Preserve ordinary sign-in and existing admission checks.
- Run focused Web tests, Web typecheck, changelog rendering, and complexity.
- Review the diff and make a scoped commit. Production deployment and an actual
  delivered code remain separate from local proof.

## Progress

- Root cause confirmed in the send path and production error classification.
- Added the missing scope around send-time bound reauthentication only.
- Before the fix, all four new phone/email success/rejection cases failed with
  the real missing-cache exception. After the fix, all four pass.
- `pnpm --dir apps/web test:prepared -- test/hosted-crypto-domain-root-store.test.ts test/better-auth-request-boundaries.test.ts test/auth-reauthentication-continuation.test.tsx test/changelog-page.test.tsx`: 91 tests passed.
- `pnpm --dir apps/web typecheck`: passed.
- `pnpm complexity:diff`: passed; maximum remains 11, no hotspots above 20.
- Product UX: Patch, Ready for review. Phone/email preparation reaches the send
  boundary; rejection remains closed; success/failure wipe retained root keys.
  Existing admission and continuation tests pass. No visual interaction changed.
- Parent review: no remaining local findings. No canonical data, schema, auth
  policy, rate limit, provider call count, or passkey requirement changed.
- Local implementation is complete. Exact-head CI and final ReviewGPT are PR
  gates; production rollout and actual delivery are not claimed by local proof.
Completed: 2026-09-17
