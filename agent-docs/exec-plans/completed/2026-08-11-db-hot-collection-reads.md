# Bound hot collection reads and latency publication

Status: completed
Created: 2026-08-11
Updated: 2026-08-12

## Goal

- Prevent bounded Family, operator-usage, and hosted-latency reads from
  multiplying historical row counts into long-lived transactions or per-row
  interactive transactions while preserving their existing authority owners.

## Success criteria

- Family owner snapshots inspect private accepted-invite fields only for the
  current active roster and retain deterministic label selection.
- Operator usage reporting admits at most one 25-member page, uses page-scoped
  set reads, and evaluates canonical allowance gates sequentially in short
  transactions rather than retaining one transaction across the collection.
- Checkpoint-publication expectations update with constant transaction
  ownership and bounded database work.
- Focused tests prove maximum-cardinality statement, decrypt, and transaction
  bounds; typecheck, lint, diff, and privacy checks pass.
- ReviewGPT implementation intent is inspected hunk by hunk and the local
  commits contain no unresolved accepted findings.

## Scope

- In scope: Family owner snapshot invite lookup, the low-frequency operator
  usage projection, checkpoint-publication latency milestone updates, focused
  tests, and architecture/testing documentation only if the live contract
  materially changes.
- Out of scope: Linq roster reconciliation owned by PR #1641, device snapshot
  work owned by PR #1645, unrelated schema/index changes, and provider or
  product behavior changes.

## Constraints

- Technical constraints: short database-only transactions, server-owned
  cardinality limits, stable ordering, query-aligned indexes only, no
  KMS/provider work under locks, no new lifecycle state, and unchanged
  privacy/crypto/authorization semantics.
- Product/process constraints: smallest maintainable patches, separate commits
  per owner where practical, ReviewGPT attachment workflow, focused local proof,
  local commits only, and no published private evidence.

## Risks and mitigations

1. Risk: A set-based usage projection can drift from the canonical per-member
   gate.
   Mitigation: reuse the gate's pure decision inputs/owners and add parity
   tests for active, inactive, Family, thread-container, credit, and plan reset
   shapes.
2. Risk: A bulk latency update can transfer stale runtime ownership.
   Mitigation: preserve runtime-attempt, lease-generation, terminal-non-reply,
   and earliest-timestamp predicates in one database-owned statement and test
   race-shaped rows.
3. Risk: Bounding accepted invites can lose a current member label.
   Mitigation: derive admitted member ids from the current active roster, keep
   deterministic earliest-invite selection, and retain target-label precedence.

## Tasks

1. Inspect current owners, tests, open-PR overlap, and ReviewGPT patches.
2. Land and verify the Family snapshot correction.
3. Land and verify the operator usage correction.
4. Land and verify the latency milestone correction.
5. Inspect the full diff, close the plan, and create scoped local commits.

## Decisions

- PR #1641 fully owns the Linq roster slice, so it is excluded.
- Device connection-list residual work is isolated as a separate stacked branch
  on the exact PR #1645 head.
- Family accepted-invite selection uses one lateral `LIMIT 1` lookup per
  admitted current non-owner member and one matching partial index; this keeps
  both history reads and decrypts under the six-seat invariant.
- Ordinary Family owner snapshots read roster, capacities, and accepted-invite
  authority from one short repeatable-read database snapshot and close it
  before private invite decryption. Existing transaction clients are reused
  without a nested transaction.
- Operator usage pagination admits 25 primary keys with cap-plus-one proof.
  Empty strict boundary scans use one bounded inclusive reverse scan so an
  endpoint or deleted cursor can navigate back without dropping a member.
  Page-scoped messages and usage remain set reads; canonical usage-gate
  decisions run sequentially with at most one short transaction active.
- Checkpoint-publication collection milestones select at most 251 newest
  eligible rows, lock/update at most 250 in one statement, preserve terminal
  evidence and lease-generation ownership, and return a content-free warning
  signal when more eligible work exists.
- No changelog item is expected because these are internal database-load
  corrections with no member-visible behavior change.

## Verification

- Passed: focused Family, usage allowance/operator usage, usage UI, latency
  store, and internal-route Vitest coverage, including maximum-cardinality and
  reverse-boundary cases.
- Passed: hosted Web typecheck and zero-warning scoped ESLint.
- Passed: all migrations applied to an isolated local PostgreSQL database,
  Prisma schema validation and migration status, and the opt-in real-PostgreSQL
  latency concurrency proof.
- Passed: `git diff --check`, direct-identifier privacy scan, and excluded-scope
  guard.
- Passed: same-thread ReviewGPT correction verification found the accepted
  repeatable-read correction complete with no actionable regression or patch.
- The first diff-aware repository verifier ran 770 files and 10,099 tests; its
  only failures were four Family transition fixtures missing newly selected
  sort keys. Those test-only fixtures were corrected, their complete 234-test
  owner passed, and the final diff-aware rerun passed all 770 files and 10,099
  tests, full hosted Web lint, dev smoke, and the production Next build.
Completed: 2026-08-12
