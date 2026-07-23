# Remove redundant Privy member metadata

Status: active
Created: 2026-07-22
Updated: 2026-07-22

## Goal

- Stop hosted signup from waiting on a best-effort Privy custom-metadata write.
- Remove the obsolete `murph_member_id` token/session hint and its maintenance
  surface.
- Keep the database-backed Privy identity binding as the only member-resolution
  authority.

## Success criteria

- Hosted signup completes without calling Privy's user-management metadata API.
- Request authentication resolves the member from the verified Privy user ID
  through the canonical database identity binding, regardless of stale or absent
  custom metadata.
- App-review setup no longer writes or reports this obsolete provider metadata.
- Focused tests, scoped verification, product/recovery review, CI, and the
  required exact-head ReviewGPT gates pass.

## Scope

- Hosted Privy verification, session projection, and request-auth resolution in
  `apps/web/src/lib/hosted-onboarding/`.
- App-review member preparation only where it maintains or reports the removed
  metadata.
- Directly affected Web tests and current durable documentation, if any.

## Constraints

- Preserve Privy token verification and canonical database identity binding.
- Do not weaken fail-closed handling for missing, suspended, or mismatched
  identities.
- Do not edit immutable completed execution plans or bulk-delete historical
  metadata already stored by Privy.
- Keep the overlapping signup-timezone lane intact; limit changes in
  `authentication-service.ts` to the obsolete metadata call and helper.

## Tasks

1. Delete the metadata writer, read helper, key, and signup wait path.
2. Remove the metadata field from hosted Privy session state and simplify
   request authentication to the canonical identity binding.
3. Remove app-review metadata maintenance/reporting and obsolete tests/mocks.
4. Add focused regression coverage for signup and authentication without the
   metadata hint.
5. Complete scoped verification, product/recovery review, PR CI, and exact-head
   ReviewGPT gates.

## Evidence

- The request-auth path already performs the canonical database lookup by the
  verified Privy user ID on every request; the token metadata does not avoid a
  database query.
- The signup metadata update is best-effort but awaited before completion, so a
  slow provider-management request lengthens the user-visible signup path.
