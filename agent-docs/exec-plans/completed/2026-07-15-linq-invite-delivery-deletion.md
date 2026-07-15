# Delete Linq invite-delivery identifiers with hosted accounts

Status: completed
Created: 2026-07-15
Updated: 2026-07-15

## Goal

- Ensure permanent hosted-account deletion removes Linq signup-link delivery
  records that carry the deleted member's raw identifier, including historical
  orphan rows left by earlier deletions.

## Success criteria

- Account deletion removes every `invite_signup` and `invite_signup_fallback`
  delivery row whose raw source reference belongs to the deleted personal or
  owned thread-container member.
- A side effect that resumes after the account-deletion suspension fence cannot
  recreate an invite-delivery row for that member.
- A migration removes historical invite-delivery rows whose referenced member
  no longer exists without touching live-member delivery state.
- The account-data store inventory, durable deletion documentation, focused
  tests, scoped verification, required coverage audit, ReviewGPT, and PR CI all
  confirm the privacy fix with no unresolved accepted finding.

## Scope

- In scope: the Linq signup-link effect-id owner; Linq side-effect dispatch
  preparation; hosted account deletion counts and transaction; one bounded
  orphan-row cleanup migration; focused tests and current deletion docs.
- Out of scope: general Linq observability retention, provider-side message
  deletion, invite retry semantics, unrelated account-deletion stores, and any
  new persisted ownership model.

## Invariants

- Live signup-link receipts can still reopen or restore the same member/day
  notice claim before account deletion.
- Account suspension remains the first local deletion fence, and deletion keeps
  its existing fail-closed provider cleanup and transaction ordering.
- Late or duplicate Linq work cannot recreate account-linked operational rows
  after the suspension fence.
- Historical cleanup targets only recognized signup-link rows whose parsed raw
  member identifier has no matching hosted member.
- No provider credential, raw contact value, invite code, or message content is
  added to storage, logs, tests, docs, or review artifacts.

## Implementation steps

1. Add one shared builder for the canonical per-member signup-link effect-id
   prefix and use it to select account-owned delivery rows.
2. Fence signup-link delivery claiming on the existing hosted-member row lock
   plus an unsuspended matching invite/member check.
3. Count and delete the selected rows in the account-deletion transaction.
4. Add a data-only migration that deletes recognized orphan rows from previous
   account deletions.
5. Update focused tests and the account-data deletion store matrix/docs.
6. Run the routed verification, coverage audit, parent final review, scoped
   commit, PR, ReviewGPT loop, CI, and mergeability proof.

## Verification

- Focused Vitest for hosted account deletion, Linq transport, Linq observability,
  and privacy migration guards.
- `pnpm test:diff` over the touched web owner, tests, migration, and docs when it
  truthfully selects the hosted-web lane.
- Direct readback of the migration predicate and account-deletion `deleteMany`
  predicate proving live-member rows are preserved while deleted-member rows are
  removed.
- Required `coverage-write` audit; ReviewGPT is the sole cross-cutting gate for
  the PR lane.

## Risks and mitigations

- Risk: deleting a live member's delivery row breaks receipt-driven retry state.
  Mitigation: transactional deletion selects only the exact deleting member ids;
  migration cleanup requires that the parsed member id no longer exists.
- Risk: a delayed side effect recreates a row after the deletion transaction.
  Mitigation: claim under the existing member row lock and require the member to
  remain unsuspended with the matching invite before writing.
- Risk: an over-broad string predicate deletes unrelated observability rows.
  Mitigation: require the two signup templates, the canonical prefix, and an
  exact parsed member-id match; cover personal and owned runtime member ids.

## Progress

- [x] Traced the audit finding to raw signup-link `sourceRef` persistence and the
  missing deletion coverage.
- [x] Implemented account-linked delivery deletion, the late-dispatch fence,
  historical cleanup, store inventory/docs, and focused regression proof.
- [x] Completed the required `coverage-write` pass, web typecheck, lint, build,
  smoke, focused suites, and disposable PostgreSQL migration scenario. The full
  web test lane passed 5,244 of 5,245 tests; its sole unrelated connection-close
  timing failure passed immediately in isolation.
- [ ] Commit, PR, ReviewGPT, CI, and mergeability proof.
Completed: 2026-07-15
