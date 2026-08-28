# PR 2382 stale Privy authority remediation

Status: completed
Created: 2026-08-27
Updated: 2026-08-27

## Goal

- Preserve terminal account-deletion authority when Ops App Review prepares
  Privy identity and KMS material before opening its short database transaction.

## Success criteria

- An existing member deleted after the exact Privy read cannot be recreated
  from that stale prepared identity.
- A genuinely new member remains creatable without provider or KMS work inside
  the pooled transaction.
- Real PostgreSQL proof covers the exact read-to-transaction deletion window.
- Focused tests, Web typecheck, ReviewGPT, exact-head CI, deployment, and live
  database telemetry pass.

## Scope

- In scope: the Ops App Review preparation path, the existing transactional
  identity-resolution owner, focused service/PostgreSQL tests, and exact owner
  documentation.
- Out of scope: new state, schema, retry policy, queues, leases, managers,
  account-deletion redesign, and unrelated onboarding flows.

## Constraints

- Technical constraints: all Privy and KMS/provider work stays outside database
  transactions; the transaction remains bounded and database-only; the existing
  two-attempt preparation-mismatch bound remains the only retry.
- Product/process constraints: preserve internal Ops behavior, record the
  requirement-level retrospective before mutation, and use exact-head
  specialist/final ReviewGPT plus required CI.

## Risks and mitigations

1. Risk: an expected-member check could reject a legitimate concurrent first
   creation.
   Mitigation: compare the nullable preflight member identity and reuse the
   existing whole-preparation mismatch retry so the winner is adopted on the
   fresh attempt.
2. Risk: checking only the member row leaves a prior deletion-cleanup window
   where its provider identity is still being removed.
   Mitigation: consult the existing pending-deletion owner before preparing the
   new-member path and retain the same check in the final transaction.

## Tasks

1. Record the round-two requirement-level retrospective on PR 2382.
2. Bind prepared identity authority to the nullable preflight existing-member
   state through the existing transactional resolver.
3. Add real PostgreSQL stale-authorization proof and focused service coverage.
4. Run focused tests, typecheck, docs/diff/privacy checks, and candidate review.
5. Finish the plan, commit, push, update PR evidence, and run exact-head
   specialist/final ReviewGPT concurrently with CI.
6. When all gates pass, mark Ready, merge exactly, verify production and
   database telemetry, and retire the worktree safely.

## Decisions

- Continue rather than expand or revert: first-reviewed production source was
  +87/-27 and the round-two shape was +105/-28. The repeated issue is an
  authority-binding omission, not size. Reuse the deletion-cleanup and
  transactional identity owners; add no durable concept.

## Verification

- Commands to run: focused App Review service/PostgreSQL Vitest, targeted
  ESLint, hosted Web typecheck, docs drift, diff/privacy checks, current-base
  merge-tree, exact-head GitHub Actions, and post-deploy log/DB queries.
- Expected outcomes: stale prepared identity is rejected after committed
  deletion, no identity is recreated, provider/KMS calls remain outside the
  transaction, and all merge/deploy health checks are green.
- Completed local proof:
  - focused service suite: 12/12 passed;
  - isolated real-PostgreSQL authority suite: 3/3 passed, including deletion
    receipt and member deletion after the exact Privy read;
  - hosted Web typecheck and targeted ESLint passed;
  - agent-docs drift, doc gardening, diff whitespace, and identifier scan
    passed.
Completed: 2026-08-27
