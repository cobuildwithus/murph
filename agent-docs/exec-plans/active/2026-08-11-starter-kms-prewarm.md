# Prewarm Starter activation roots before enrollment transactions

Status: active
Created: 2026-08-11
Updated: 2026-08-11

## Goal

- Preserve Starter enrollment and activation behavior while ensuring GCP KMS
  decrypt and other provider-capable domain-root preparation finish before the
  enrollment transaction begins.

## Success criteria

- Control and ingress roots are prewarmed before the transaction for both
  existing roots and missing prepared candidates.
- The transaction revalidates the exact prepared root identities under the
  existing root-authority locks before any prepared state can commit.
- A concurrent root provision or transition gets at most one fresh
  prepare-before-transaction attempt, without writing ciphertext under stale
  root authority.
- Every started prewarm operation settles before transaction entry, and
  focused proof fails if any provider/KMS work executes while the transaction
  callback is active.
- Existing grant idempotency, activation, instant-start admission, post-commit
  wake, and welcome behavior remain unchanged.

## Scope

- In scope: the Starter usage enrollment owner, its focused tests, and live
  reliability documentation needed to state the new transaction boundary.
- Out of scope: shared member-activation refactors, mailbox redesign, domain
  root rotation policy, schema changes, new durable state, and unrelated
  onboarding or billing behavior.

## Constraints

- Start from the ReviewGPT-returned implementation patch and treat it as
  untrusted behavioral intent; inspect every hunk before applying it.
- Keep production changes out of `member-activation.ts` so this PR remains
  independent of the open Linq roster-fanout work.
- Reuse the request-scoped unwrap cache, prepared domain-root candidates,
  transaction-scoped root-authority locks, and existing typed retry contract.
- Add no queue, retry owner, table, schema, provider abstraction, or
  compatibility path.

## Risks and mitigations

1. Risk: a missing-root candidate loses a concurrent provisioning race after
   prewarm.
   Mitigation: re-read under the existing root-authority lock and retry the
   full preparation once on an exact identity mismatch.
2. Risk: one failed prewarm returns while a sibling KMS request is still
   running and the transaction begins.
   Mitigation: drain both control and ingress outcomes and preserve the first
   failure before transaction entry.
3. Risk: a cache miss silently performs KMS work inside activation.
   Mitigation: keep one request-scoped cache across preparation and commit and
   add a deterministic transaction-active provider guard.
4. Risk: retry broadening repeats grants or external post-commit effects.
   Mitigation: retry only the preparation-invalidated transaction and preserve
   the existing semantic grant key, instant-start token, and post-commit effect
   owners.

## Tasks

1. Receive and inspect the fresh ReviewGPT implementation patch and verify its
   claimed hash and path scope.
2. Apply the scoped service and focused-test changes, then make only bounded
   corrections required by repository invariants or executable proof.
3. Add or align live reliability documentation if the final implementation
   changes the documented Starter activation transaction contract.
4. Run focused Vitest, Web typecheck, diff/docs/privacy hygiene, and direct
   transaction-active provider-call proof.
5. Commit and push the exact candidate, open the PR with the full intent and
   change-shape contract, and run the preliminary specialist and final
   ReviewGPT gates with exact-head CI.
6. Resolve accepted findings, perform the parent final review, archive this
   plan through `scripts/finish-task`, and prove current-base mergeability.

## Decisions

- Crypto preparation is speculative capability work, never enrollment or
  activation authority. The database transaction remains the canonical owner
  of grant, activation, and admission decisions.
- Exact root drift is retryable only once. A second mismatch fails closed
  rather than spinning while holding or repeatedly acquiring pooled
  connections.
- No intended member-visible flow, copy, or entitlement changes are part of
  this reliability refactor.

## Verification

- Focused Starter enrollment Vitest, including existing, missing, partial-race,
  bounded-retry, and transaction-active provider guard scenarios.
- The focused owner suite uses staged transaction state to prove rollback and
  exact post-commit effect ownership across device/runtime retry seams. It
  composes with the real lower-level domain-root and member-activation suites;
  it is not represented as a new real-PostgreSQL end-to-end owner matrix.
- Hosted Web typecheck.
- `git diff --check`, architecture/doc drift checks when live docs change, and
  a diff-only identifier/secret scan.
- Exact pushed-head preliminary specialist ReviewGPT, final ReviewGPT, required
  GitHub CI, and `git merge-tree --write-tree HEAD origin/main`.
