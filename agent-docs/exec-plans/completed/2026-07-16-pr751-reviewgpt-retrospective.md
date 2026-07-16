# PR 751 ReviewGPT retrospective and simplification

Status: completed
Created: 2026-07-16
Updated: 2026-07-16

## Goal

Complete the required ReviewGPT anomaly retrospective for hosted usage top-ups,
remove redundant lifecycle and ledger concepts without weakening payment or
usage invariants, re-prove the resulting implementation, and take the exact
pushed PR head through CI and a credible non-Mountain ReviewGPT PASS.

## Success criteria

- One durable purchase status lifecycle and one append-only four-kind ledger
  remain; duplicate persisted Checkout request fields and timestamps are absent,
  while the fixed Checkout request policy version remains as the reconstruction
  guard.
- Checkout creation remains replay-safe inside Stripe's minimum-expiry contract,
  webhook fulfillment remains the only grant authority, and refunds/disputes
  converge through signed adjustments.
- Current docs and the PR body record the minimum v1, concept ownership,
  review-driven source movement, safe staged rollout, rollback floor, and
  explicitly deferred group semantics.
- Focused proof, real-Postgres concurrency, full acceptance, specialist audits,
  exact-head CI, and a sustained healthy-lane ReviewGPT round all pass.

## Tasks

1. Collapse redundant checkout lifecycle, request snapshots, ledger kinds,
   eligibility cutoff, duplicate timestamp, and UI projections.
2. Update focused tests and durable docs, including the derived 30-minute
   Checkout create-retry window and 90-minute ambiguity fence.
3. Run specialist frontend and coverage passes plus local focused, database,
   hosted-local, diff-aware, and full acceptance proof.
4. Commit and push the scoped correction, update the PR retrospective and
   change-shape contract, and start CI and ReviewGPT concurrently.
5. Resolve any accepted PR-specific finding, require exact-head green CI and a
   credible ReviewGPT PASS, and report the deployment order and rollback floor.

## Constraints

- Keep the immutable first-reviewed head
  `699e6a0c345212b78f08d3c0e586cb55f3bacb65` as the review baseline.
- Do not add a queue, service, state owner, dependency, compatibility shim, or
  speculative group lifecycle.
- ReviewGPT must use a healthy non-Mountain browser lane; reject a concrete
  model response that returns in under ten minutes.
- Preserve unrelated worktree and coordination-ledger entries.

## Verification

- Focused Web usage-credit, allowance, billing UI, route, and message tests.
- Fresh committed-migration PostgreSQL concurrency/replay suite.
- Hosted-local blocked-input/grant/resume E2E.
- Web typecheck/lint, docs drift, diff/privacy hygiene, `pnpm test:diff`, and
  serialized `pnpm verify:acceptance`.
- Required frontend-review and coverage-write passes.
- PR CI plus ReviewGPT correction round on the exact pushed head.
Completed: 2026-07-16
