# PR 547 Account Deletion Enrollment Race

Status: completed
coordinator's host-guard exception
Created: 2026-07-14
Updated: 2026-07-14

## Goal

- Prevent Messages enrollment from recreating account-linked agent-session
  state after account deletion begins, while preserving the normal foreground
  enrollment and self-revocation flows.

## Success criteria

- Enrollment parses its bounded request body before identity or authority
  reads, then serializes issuance with account deletion on the existing hosted
  member row lock.
- Active access and current launch consent are rechecked under that lock, and
  the session insert commits in the same transaction.
- Real-Postgres concurrency coverage proves both deletion-first and
  enrollment-first lock orders leave no post-deletion session row.
- Focused verification, required coverage/security audits, exact-head CI, and
  one fresh ReviewGPT round complete on the pushed PR head.

## Scope

- In scope: PR #547 Messages enrollment route/service, its bearer-auth contract
  comment, the existing agent session create primitive, focused route/service
  and Postgres concurrency coverage, and matching durable trust-boundary docs.
- Out of scope: schema/FK changes, new state owners or queues, iOS/device work,
  PRs #542 and #620, and PR #573.

## Constraints

- Technical constraints: reuse the existing hosted-member lock and transaction
  options; keep credential hashing and storage shape unchanged; do not weaken
  authentication, access, consent, proof-action, or self-revocation behavior.
- Product/process constraints: preserve unrelated work, avoid the host's heavy
  verification slot while another lane owns it, run the required coverage and
  security/privacy passes, do not merge.

## Risks and mitigations

1. Risk: a fix that only reorders route awaits leaves an insert/delete race.
   Mitigation: perform the final gates and insert under one member-fenced
   transaction and prove both lock orders against Postgres.
2. Risk: broad store refactoring or a new FK/migration expands a narrow review
   fix.
   Mitigation: expose only the existing create primitive to a transaction
   client and keep all other session behavior unchanged.

## Tasks

1. Prove the exact deferred-body/delete/insert path on the current PR head.
2. Move bounded body validation before auth and add transaction-bound issuance
   with member/access/consent fencing.
3. Add focused unit and real-Postgres lock-order regressions.
4. Run focused checks and required coverage/security audits.
5. Finish the scoped commit, push, and launch one exact-head ReviewGPT round in
   parallel with CI.

## Progress

Done:

- Proved the deferred-body, post-deletion session-create race on the original
  PR head.
- Implemented bounded body-first validation plus member/sponsorship locks,
  locked access and consent rechecks, and transaction-bound session creation.
- Added focused unit coverage and opt-in real-PostgreSQL proofs for both lock
  orders.
- Completed coverage-write and security/privacy review with zero
  medium-or-higher findings; clarified the one low-severity auth-contract
  comment without changing runtime behavior.

Now:

- Finish and push the exact scoped patch under the host-guard verification
  exception directed by the coordinator.

Next:

- Run the real-PostgreSQL proof, required verification and completion audits,
  then finish, push, and start exactly one fresh exact-head ReviewGPT round
  concurrently with CI.

## Decisions

- Do not add a DeviceAgentSession foreign key in this review fix. The existing
  hosted-member serialization boundary is already shared with account deletion
  and avoids a migration for a feature that has not shipped.

## Verification

- Focused Messages route/service Vitest: 19 tests passed.
- Focused database-test discovery without its dedicated URL: one file and two
  tests skipped as intended.
- Package-local ESLint for all changed TypeScript and test files: passed.
- `git diff --check` and changed-file privacy scan: passed.
- Focused real-Postgres Vitest for both lock orders under the host guard:
  not run because the shared heavy slot remained unavailable; the suite is
  opt-in and ordinary CI excludes database tests.
- Truthful scoped verification selected from the final diff once the heavy
  host slot is available: deferred to exact-head CI under the coordinator's
  host-guard exception.
- Required `coverage-write` and `security-privacy-review` completion passes.
  Both completed with zero medium-or-higher findings.
- Exact local/remote/PR-head equality, CI green, and one completed fresh
  ReviewGPT response with no accepted findings.
Completed: 2026-07-14
