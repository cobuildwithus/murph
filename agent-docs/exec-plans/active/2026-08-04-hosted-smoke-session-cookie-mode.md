# Hosted smoke session cookie parity

## Goal

Make source-side hosted-local session minting use the same cookie contract as a
production-built Next artifact, without adding a test-only authentication path
or weakening the production `__Host-` cookie boundary.

## Proven failure

- The required hosted-local browser journey reaches the real consent-status
  route on a production-built Next artifact and receives `401 AUTH_REQUIRED`.
- The production artifact reads `__Host-murph-session`, while the source-side
  session helper currently derives `murph-session` from `NODE_ENV=test`.
- The stored session and HMAC authenticator are otherwise valid; the route
  cannot observe the differently named cookie.
- Once the cookie mismatch is corrected, the same journey reaches Junction's
  signed connect-link boundary but calls the deleted callback `complete` POST
  route and receives `404`. The production callback now completes directly on
  the exact provider redirect URL with `GET`.

## Success criteria

- One shared boolean selects both the hosted session cookie name and its
  `Secure` attribute.
- That boolean is true for ordinary production runtime and for the explicit
  hosted-local smoke-artifact mode.
- Development and ordinary test lanes retain the non-secure `murph-session`
  contract.
- Session validation, HMAC binding, revocation, and route authentication are
  unchanged; no compatibility cookie or bypass is introduced.
- Focused tests prove production, smoke-artifact, and ordinary test behavior,
  and the production-built hosted-local browser flow reaches authenticated
  consent status and completes through the current Junction callback route.

## Implementation

1. Extend the existing hosted app-session owner with one shared secure-cookie
   mode derived from production runtime or explicit smoke-artifact mode.
2. Use that mode for both cookie-name selection and `Secure` serialization.
3. Add focused regression coverage for smoke-artifact mode and preserve the
   existing production and test assertions.
4. Keep the Junction hosted-local journey on the provider redirect URL emitted
   by production code instead of reconstructing a removed callback route.
5. Run focused Web and hosted-local proof, then push the coordinated public
   branch so the paired private integration PR can select the exact fix.
6. Complete the required specialist, final ReviewGPT, CI, and parent-review
   gates before closing the plan.

## Verification

- Focused hosted app-session Vitest coverage for production, smoke-artifact,
  and ordinary test modes.
- Hosted Web typecheck or the truthful focused diff lane.
- Production-built hosted-local browser/session scenario proving the real
  consent route accepts the minted cookie.
- Exact-head public CI and the paired private integration workflow.
