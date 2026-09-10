# Switch hosted SMS sign-in to Twilio Verify

Status: active
Created: 2026-09-10
## Outcome and invariants

SMS login uses Twilio-managed senders and provider-generated codes. Better Auth
continues to own users and sessions; canonical contacts and member IDs retain
their current owners. Existing sessions and rollout flags are unaffected.
No provider work occurs inside database transactions. Wrong codes, replay,
expired or replaced challenges never issue a session.

## Evidence and design

Programmable Messaging requires a provisioned sender pool. Verify supplies that
delivery infrastructure. The installed Better Auth 1.7.3 phone plugin supports
an external verifier, but that callback bypasses its internal expiry and attempt
checks. Calling Verify there would also put network work inside login locks.

Extend the existing encrypted verification record with a closed, versioned
Verify challenge value. Reserve three attempts under the current OTP lock;
perform the provider check outside it; retain only a bound approval digest for
same-code retry after a failed canonical commit. Revalidate the exact generation
and expiry and consume it with canonical writes/session issuance in the existing
transaction. Resends replace the generation before provider work, preventing
late responses from restoring superseded authority. No new table or dependency.

## Product UX

Effort: Patch.
Outcome: deliver and accept six-digit SMS sign-in codes through Verify.
Reaches: browser/native new and existing members, resend, wrong/expired codes,
provider failure, interrupted completion, and concurrent verification.
Proof: provider-shaped HTTP tests and real PostgreSQL composed login tests;
live service qualification and phone receipt remain required before activation.

## Work

1. Replace raw Messaging transport with bounded Verify start/check calls.
2. Extend encrypted OTP preparation/consumption at the existing auth owner.
3. Update configuration and current security/architecture/rollout contracts.
4. Test limits, generation fencing, retries, atomicity, and unchanged email flow.
5. Run focused tests, typecheck, lint, complexity and parent review; open a draft
   PR, run required ReviewGPT concurrently with exact-head CI, and reconcile.
6. Provision supplied Verify configuration opaquely and perform an authorized
   live send/check once the service and restricted-key permissions are ready.

## Deployment and proof limits

Issuance remains paused during this preparation. A new reader rejects old raw
SMS codes; old readers cannot accept the new structured challenge value.
Email and existing session formats do not change. Deploy and qualify Verify
configuration before the held client-adoption release enables first-party auth.
The provider's consumed approval cannot be rolled back; an encrypted local
approval digest permits same-code retry only within the original challenge
expiry and generation. Ambiguous provider/network failures remain fail-closed.

## Progress

- Confirmed installed plugin behavior and current canonical transaction boundary.
- Requested Verify service configuration and narrowly scoped key permissions.
- Replaced raw SMS delivery with Verify start/check and encrypted challenge ownership.
- Provider/admission tests: 16 passing; real PostgreSQL adapter/member/SMS proofs:
  47 passing, including composed browser/native completion and unchanged email.
- Typecheck, focused ESLint and complexity guard passed. Parent reviewed the
  complete candidate, provider/transaction boundaries and privacy. No changed
  source function exceeds complexity 20. Final ReviewGPT and exact-head CI remain
  pending. No public changelog: replacement issuance is still gated off.
- Live service read remains unauthorized; key permissions and live send/check
  qualification are outstanding. No rollout flag has been enabled.
- Held client-adoption credential-change owner needs the same preparation and
  transaction-bound approval check before activation; recorded in rollout owner.
