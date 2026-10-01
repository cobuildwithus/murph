# Serialize account deletion group and member locks

Status: completed
Created: 2026-08-26
Updated: 2026-08-26

## Goal

- Prevent the terminal hosted-account deletion transaction from deadlocking
  with ordinary hosted-group operations by preserving the established
  `hosted_group` then `hosted_member` row-lock order.

## Success criteria

- Account deletion prepares, locks, and revalidates the exact affected group
  set before acquiring terminal member-row locks.
- Both group-first and deletion-first real-PostgreSQL interleavings complete
  without PostgreSQL `40P01` and preserve final deletion behavior.
- A changed group set aborts before destructive deletion and preserves all
  privacy-owned rows for a safe retry.
- Focused unit tests, the opt-in PostgreSQL concurrency suite, and hosted Web
  typecheck pass.

## Scope

- In scope: terminal account-deletion group/member ordering and focused tests.
- Out of scope: mailbox, runtime-log, Stripe, provider cleanup, group-outreach
  implementation, schema changes, retries, queues, and broader deletion
  decomposition.

## Constraints

- Technical constraints: keep the transaction database-only, use stable sorted
  row locks, and revalidate exact sets before destructive writes.
- Product/process constraints: preserve account-deletion privacy atomicity and
  all existing deletion fences; keep the patch small and owner-local.

## Risks and mitigations

1. Risk: a concurrent group creation changes the deletion target after the
   prepared snapshot.
   Mitigation: re-read the exact target group set after member locks and abort
   the transaction on any difference.
2. Risk: a test proves only one side of the historical cycle.
   Mitigation: exercise both lock acquisition orders with real PostgreSQL
   clients and explicit barriers.

## Tasks

1. Add prepared group-set locking and exact revalidation to terminal deletion.
2. Add focused unit accounting and real-PostgreSQL interleaving/rollback proof.
3. Run focused verification and inspect the complete diff.
4. Commit, push, open a draft PR, and start exact-head ReviewGPT gates.

## Decisions

- Keep canonical ordering at the account-deletion owner instead of adding a
  shared lock manager, retries, queues, or new state.
- Treat group outreach and runtime-log as unchanged prerequisites: neither
  participates in this primary-database group/member lock cycle.
- ReviewGPT agreed that the cycle is reachable and that this isolated ordering
  correction can land without the broader account-deletion decomposition.

## Verification

- `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-account-data-service.test.ts`: 132 passed.
- Opt-in local PostgreSQL concurrency suite filtered to the three new cases:
  3 passed; both interleavings settled without `40P01`, and set-change rollback
  preserved the group, members, runtime container, and outreach for retry.
- `pnpm --filter @murphai/hosted-web typecheck:prepared`: passed after generating
  the fresh worktree's ignored changelog and Health Commons inputs.
- `pnpm docs:drift`: passed.
- `git diff --check`: passed.
Completed: 2026-08-26
