# PR 547 Bounded Messages Credential Rotation

Status: completed
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
4. Risk: a stale bearer authenticates before stable-row rotation, then revokes
   or expires the replacement by reused row id. Mitigation: compare-and-set
   every post-authentication revocation on the exact lookup hash and treat
   generation loss as invalid.

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
- Merged current `main`, resolved the one durable-doc conflict by preserving
  both security contracts, and implemented one deterministic Messages-owned
  row with a fresh hash on every enrollment.
- Removed the temporary generic session-create export while leaving ordinary
  device-agent creation and rotation unchanged.
- Accepted and fixed the security audit's stale-generation ABA finding with
  exact token-hash compare-and-set for explicit revocation and expiry cleanup.
- Added focused route, service, store, and opt-in real-PostgreSQL proof for
  bounded cardinality, prior-token invalidation, stale-generation safety,
  revocation/expiry recovery, ordinary-session isolation, and both deletion
  lock orders.
- Completed the security/privacy re-audit with no remaining medium-or-higher
  findings and the coverage-write pass with no additional test churn required.

Now:

- Finish the scoped commit and push the corrected PR head.

Next:

- Update the PR intent contract, then run one exact-head ReviewGPT round and CI
  without merging.

## Decisions

- The Messages credential remains in `DeviceAgentSession`; its bounded owner is
  a deterministic feature-namespaced row id, not a new table or cleanup loop.
- Each enrollment rotates the row to a fresh bearer instead of returning or
  extending the existing bearer.
- Because the row id is stable, explicit and expiry revocation bind authority
  to both the row id and exact credential hash; id-only mutation is unsafe.

## Verification

- `pnpm exec vitest run --config apps/web/vitest.config.ts
  apps/web/test/prisma-store-agent-session.test.ts
  apps/web/test/imessage-mini-app-routes.test.ts
  apps/web/test/imessage-mini-app-service.test.ts --no-coverage` — 25/25 passed.
- Changed-file ESLint — passed with no warnings or errors.
- The opt-in real-PostgreSQL suite was discovered correctly but skipped all
  three tests because no dedicated local test URL is configured.
- Pre-CAS `pnpm test:diff` passed fully. The corrected run passed repository
  guards, dependency/boundary checks, lint, build, and TypeScript, with 410 web
  test files passing; one unrelated shared-load timing assertion failed in
  `hosted-onboarding-linq-http.test.ts`. Its exact isolated workspace rerun then
  passed all 19 tests.
- Required security/privacy re-audit: no remaining Critical, High, or Medium
  findings. Required coverage-write pass: proof sufficient; no edits.
Completed: 2026-07-14
