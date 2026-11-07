# Switch hosted SMS sign-in to Twilio Verify

Status: completed
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
  source function exceeds complexity 20. ReviewGPT Round 1 passed at
  `e8421bcaa936411dd2bdfbfbb7c31446c3413046`, with exact-turn/hash matching,
  a concrete `gpt-6-pro` model receipt, and a 293-second capture stage. Parent
  accepted its full-snapshot boundary/race analysis; no findings remain. All
  required CI passed on that head. No public changelog: issuance is still off.
- Live diagnostic-key qualification confirmed the expected service/account,
  six-digit configuration, actual SMS receipt, approved verification and rejected
  replay. The application key's original policy allowed only Messaging create;
  its actual Verify send was rejected before changing permissions.
- Added only Verify verification/create and verification-check/create to the
  existing restricted application key, preserving its old Messaging permission
  through deployment. Readback confirms those three permissions and no others;
  service-read/admin access was not added. The unchanged restricted application
  key completed a live send (HTTP 201), accepted the received code (HTTP 200),
  and rejected its immediate replay (HTTP 404, provider code 20404). This proves
  provider delivery and one-use verification, not canonical member/session login.
- Synced only the four selected application Twilio variables to Vercel production
  using opaque local values, sensitive writes and metadata-only readback. The
  diagnostic key stays local. No rollout flag has been enabled.
- The held client-adoption PR #3132 now prepares and consumes the same Verify
  proof for phone credential changes. Its integration head
  `62e5518073b6138f3f437acb1286fbc53f17917d` passed 92 focused tests, Web
  typecheck, ReviewGPT round 4 and exact-head CI. Hosted login and installed-device
  migration remain activation gates owned by the broader migration plan.
- Parent final review confirms this closure changes explanatory evidence only;
  reviewed authentication source and tests remain unchanged. Required CI passed
  on `a13afffd963ac478d9a8bca779b20cfae67a3861`; the final plan-bearing head
  must also pass required checks before merge. Backend preparation and provider
  qualification are complete. No deployment or activation is claimed.
Updated: 2026-09-10
Completed: 2026-09-10
