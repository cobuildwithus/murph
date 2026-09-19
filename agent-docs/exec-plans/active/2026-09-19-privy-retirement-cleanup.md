# Privy retirement cleanup and qualification

Status: active
Created: 2026-09-19
Updated: 2026-09-19

## Outcome and invariants

Complete authorized preparation and unused-signup cleanup while retaining valid
sessions and supported native recovery until retirement gates pass. No account
is inferred to be disposable from missing authentication alone. The existing
account-deletion service owns suspension, revocation and encrypted cleanup
receipts; provider credentials remain hosted.

## Evidence and ownership

The existing self-service deletion route requires the target's session; Ops has
an authenticated, same-origin admission owner but no unused-signup deletion
entrypoint. Add a narrow temporary Ops entrypoint that selects one explicitly
named target and verifies its creation time and unused state under the existing
deletion locks before suspension or external effects. No batch selection,
impersonation, new credentials, schema, provider cleanup implementation or
account-specific compatibility behavior.

Private target identity and production query results stay outside this record.
The operator has authorized deletion and the hosted execution path. A current
Ops session is available. Production execution follows reviewed deployment and
fresh target verification; completion requires canonical absence and cleanup
receipt outcomes, not merely an HTTP success.

## Tasks

1. Implement and test the bounded Ops deletion entrypoint and locked eligibility
   check. Preserve ordinary deletion and retry semantics.
2. Review, commit and submit the additive cleanup candidate; complete focused
   tests, Web typecheck, required external review and exact-head CI.
3. Execute authorized cleanup after deployment and verify canonical/provider
   outcomes through read-only metadata.
4. Reconcile retirement PR #3134 with current main and passkey repair, preserving
   canonical-login proof, established-factor protection and session revocation.
5. Reconcile native retirement/CI cleanup and diagnose current canary failures;
   distinguish simulator proof from distributed installed-device qualification.
6. Refresh rollout ownership and explicitly dispose of obsolete Privy-only
   browser proof. Keep schema/vendor removal and valid-session revocation gated.

## Product UX and proof

Internal operator cleanup only. Retained members' login, recovery, approvals,
data and native access remain intact. Wrong target, changed/used account,
unapproved operator and cross-origin requests must fail before deletion.
Qualifying cleanup reuses normal suspension and receipt-owned vendor cleanup;
partial failure remains retryable. No new member-facing flow or changelog item.

Focused route and PostgreSQL tests cover authority, eligibility and concurrent
activation; existing account-deletion tests cover receipt preservation. Run Web
typecheck, lint, complexity and docs checks. CI owns broad regression proof.

## Retirement holds

Natural legacy-browser drain, native distribution and skipped-version recovery,
provider-orphan and wallet/export inventory remain operational prerequisites.
Preserve the shared HMAC key. Remove the temporary Ops entrypoint with the
importer during final retirement, after receipt-owned cleanup converges.

## Additive cleanup candidate evidence

Focused route, canonical deletion and isolated PostgreSQL admission proof passes
140 cases, including activation committed while deletion waits on the member
lock, wrong target generation, restored/protected accounts, returning sessions
and preservation of the encrypted cleanup receipt. Web typecheck passes.
Complexity passes after keeping the preparation order in one owner-local helper;
maximum complexity in the deletion module decreases from 19 to 15. No production
mutation has run. The local proof database was created by this task and uses only
synthetic fixtures.

## Review disposition

Round 1 accepted one admission bug: legacy cookie reads do not update
`lastSeenAt`, so signup-only timestamps cannot establish inactivity. Admission
now refuses every live legacy session under the existing deletion lock. This
uses existing expiry/revocation authority without new visit tracking. Production
execution must wait for target-session expiry and repeat every other predicate.
