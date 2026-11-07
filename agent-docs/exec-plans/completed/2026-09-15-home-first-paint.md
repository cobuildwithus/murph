# Home load latency

## Outcome

Reduce work that blocks Home content, preserving the existing page presentation.

## Cause and change

Page auth awaits phone-welcome recovery. Previously, that recovery read and
opened a full member snapshot, including unrelated private fields, before
checking whether the account already had a text conversation. The same work
also occurred for accounts without a verified phone.

The phone-welcome entry now selects only the member ID using current suspension,
phone-verification, and current/pending conversation metadata. Non-candidates
finish after that single query without loading recovery or decrypting the
snapshot. Candidates keep the existing locked access, identity, deduplication,
line assignment, mailbox, and signal behavior. There is no cache, new state,
background task, authentication change, or loading-screen change.

## Product UX

- Outcome: fewer synchronous account operations before Home is ready.
- Reaches: returning members, accounts without a verified phone, and suspended
  accounts; newly verified phones and bare-line recovery preserve their existing
  success paths. Shared authentication and companion callers use the same entry.
- Proof: existing Home/auth/companion tests, real crypto-owner comparison, and
  actual PostgreSQL candidate selection. Ready at this local boundary.
- Presentation: unchanged, so no new design representation is necessary.

## Verification

- 153 tests passed across Home, page-auth, authentication completion, companion
  member access, and the hosted crypto domain-root suite.
- 22 phone-welcome tests passed with PostgreSQL enabled. The candidate test covers
  new phones, absent/unverified identity, suspension, current/pending chats,
  bare lines, and a missing account, and verifies one SQL query per candidate
  check. Fixture cleanup removes only this run's synthetic rows.
- Real crypto-owner comparison: the previous established-conversation path reads
  a full snapshot and invokes KMS; the new path performs neither, including when
  KMS is deliberately unavailable.
- 10 changelog rendering tests passed.
- Web typecheck passed. Focused ESLint passed with one existing unrelated warning
  in the crypto fixture. Complexity passed: one runtime function, complexity 2.
- The initial PostgreSQL attempt found an unavailable table grant and an older
  local test schema. Verification used the existing authorized local connection
  and seeded only the relevant metadata through explicit SQL; no shared schema
  or role grants were changed.

## Review and delivery

The preflight is an optimization only; it never grants access or authorizes a
write. Existing routing writers maintain lookup/ciphertext pairs. The recovery
owner still handles a preflight candidate whose state changes before its lock.
No migrations or cross-service rollout order are required. Member-visible
release notes accompany the change. Local scoped commit only; no PR, deployment,
or production latency improvement is claimed. Production end-to-end measurement
remains necessary after deployment.
Status: completed
Updated: 2026-09-15
Completed: 2026-09-15
