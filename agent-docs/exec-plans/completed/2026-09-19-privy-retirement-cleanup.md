# Prepare guarded Privy signup cleanup

Status: completed
Created: 2026-09-19
Updated: 2026-09-19

## Outcome and invariants

Prepare the additive operator cleanup endpoint while retaining valid sessions
and supported native recovery until retirement gates pass. No account
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

## Delivered scope and handoff

1. Implemented and tested bounded Ops admission and locked eligibility, preserving
   ordinary deletion and encrypted cleanup retry semantics.
2. PR #3589 passed 141 focused cases, Web typecheck, lint and complexity checks.
   Round 2 full ReviewGPT passed on the corrected candidate. Exact-head CI remains
   the merge gate and will be checked by this session's completion owner.
3. No production mutation ran. Targeted execution waits for legacy session expiry,
   reviewed deployment and a fresh complete predicate check; the durable owner is
   `docs/hosted-auth-migration.md`.
4. Broader retirement reconciliation continues in PR #3134 with its own plan.
   Native SDK setup repair is Android PR #44. Privy-only browser PR #3221 was
   closed as obsolete without deleting its branch.

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
141 cases, including activation committed while deletion waits on the member
lock, wrong target generation, restored/protected accounts, live sessions with unchanged signup timestamps
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

Round 2 found no remaining serious issue. The correction adds only an existing
session-authority predicate and regression proof; no visit tracking or new
compatibility state. This plan closes the additive preparation work, not the
production cleanup or overall retirement.
Completed: 2026-09-19
