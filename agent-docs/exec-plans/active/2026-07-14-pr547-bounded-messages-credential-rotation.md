# PR 547 Bounded Messages Credential Rotation

Status: active
Created: 2026-07-14
Updated: 2026-07-14

## Goal

- Bound Messages credential persistence to one feature-owned device-agent
  session row per member while preserving fresh credential rotation, ordinary
  device-agent sessions, account-deletion serialization, and every existing
  auth/privacy gate.

## Success criteria

- Every successful enrollment returns a fresh random Messages bearer and
  atomically rotates one deterministic Messages-owned session row for the
  authenticated member.
- Rotation invalidates the prior bearer, clears prior revocation state, and
  does not modify ordinary device-agent rows for that member.
- Re-enrollment remains available after expiry or authenticated
  self-revocation, and enrollment still serializes with account deletion under
  the existing member/access/consent transaction fence.
- Focused regression coverage proves bounded cardinality and credential
  rotation; required verification and completion audits pass.
- The scoped patch is committed and pushed, then one exact-head ReviewGPT round
  runs concurrently with CI. The PR is not merged.

## Scope

- In scope: PR #547 Messages enrollment issuance, removal of the temporary
  generic session-create export, focused route/service/PostgreSQL coverage,
  the existing Messages trust-boundary docs, and any latest-main conflict that
  must be resolved to leave the PR mergeable.
- Out of scope: schema migrations, cleanup workers, retention schedulers, new
  state owners, ordinary device-agent lifecycle changes, iOS/device work, and
  unrelated Vercel build-memory remediation.

## Constraints

- Reuse the existing `DeviceAgentSession` table, hosted-member and sponsorship
  locks, active-access and launch-consent checks, transaction options, and
  Messages-domain-separated token hashing.
- Keep raw bearer values response-only. Never log or persist them.
- Prefer deletion and direct owner-bound code; do not add a queue, table,
  lifecycle manager, rate limiter, or compatibility reader.
- Preserve unrelated work and stop if another worker begins editing this lane.

## Risks and mitigations

1. Risk: deterministic ownership collides with or overwrites an ordinary
   device-agent session. Mitigation: use a feature-namespaced deterministic row
   id and prove ordinary rows remain unchanged.
2. Risk: an upsert accidentally reactivates the old bearer or keeps stale
   revocation/replacement fields. Mitigation: rotate to a fresh domain-separated
   hash and explicitly reset mutable credential state in one transaction.
3. Risk: base reconciliation changes the reviewed patch semantics. Mitigation:
   resolve only the proven conflict union, rerun focused checks, and review the
   final pushed head.

## Tasks

1. Reconcile the clean PR branch with current `main` and preserve the exact
   Messages security contract.
2. Replace append-only Messages session creation with one feature-owned atomic
   upsert and delete the temporary generic create seam.
3. Add focused cardinality, rotation, expiry/revocation, ordinary-session, and
   deletion-race regressions.
4. Run scoped verification, security/privacy and coverage-write audits, and the
   parent final review.
5. Finish the scoped commit, push, update the PR intent contract, and start one
   exact-head ReviewGPT round concurrently with CI.

## Progress

Done:

- Recovered the accepted ReviewGPT bounded-growth finding and proved there is
  no production expiry/revocation deletion path outside whole-account deletion.
- Re-queried the live PR and confirmed the dedicated worktree is clean and
  exclusively owned at pushed head `792c0351bf`.
- Proved current `main` introduces one content conflict, limited to the durable
  Messages security paragraph.

Now:

- Reconcile latest `main`, implement the feature-owned credential rotation,
  and add focused proof.

Next:

- Complete required local verification/audits, commit/push, then run exact-head
  ReviewGPT and CI without merging.

## Decisions

- The Messages credential remains in `DeviceAgentSession`; its bounded owner is
  a deterministic feature-namespaced row id, not a new table or cleanup loop.
- Each enrollment rotates the row to a fresh bearer instead of returning or
  extending the existing bearer.

## Verification

- Pending implementation.
