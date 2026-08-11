# Replace Linq inventory loops with set-based synchronization

Status: completed
Created: 2026-08-09
Updated: 2026-08-10

## Goal

- Make Linq configured-line and authoritative provider-inventory synchronization
  converge through bounded set-based PostgreSQL writes without an in-transaction
  per-phone write loop.
- Preserve a transaction-scoped inventory publication lock so member-facing
  backup reads never observe partially published ownership.
- Preserve encrypted phone storage, lookup-key compatibility, provider-id move
  handling, freshness/status semantics, and all existing assignment/read paths.

## Success criteria

- The complete normalized/encrypted input is prepared before opening a database
  transaction.
- Each multi-phone synchronization path uses a bounded `VALUES`/CTE bulk write;
  it does not call the per-phone upsert loop.
- Set-based configured/provider snapshot writers and candidacy snapshots share a
  transaction-scoped publication lock; member backup reads fail soft while a
  writer is in flight.
- Existing unique phone lookup keys and unique provider phone-number ids remain
  the convergence owners, including moved-id and reversed-input-order races.
- Focused unit and real-PostgreSQL tests prove exact final state, bounded query
  count, rollback, and absence of deadlock under concurrent synchronization.
- Web typecheck and the exact-head PR checks pass with no unresolved accepted
  ReviewGPT finding.

## Scope

- In scope: `HostedLinqLine` configured/provider snapshot writers, their focused
  unit and PostgreSQL tests, and narrow owner documentation where required.
- Out of scope: schema changes, new state, provider API shape changes, line
  assignment policy, webhook/delivery single-phone writers, and frontend work.

## Constraints

- Technical constraints: keep private phone plaintext out of SQL diagnostics and
  durable artifacts; use Prisma parameterization; preserve lookup-key read
  compatibility without `as any` or broad assertions; keep cardinality bounded
  by the existing 250-line limit.
- Product/process constraints: smallest owner-local deletion; Pro returns a
  scoped patch for parent inspection; complete the worktree/PR, specialist,
  final ReviewGPT, and exact-head CI workflow.

## Risks and mitigations

1. Risk: provider-id moves can collide with the unique provider-id index.
   Mitigation: release stale pairings and claim the authoritative snapshot in
   one serializable transaction with real PostgreSQL race coverage.
2. Risk: historical lookup-key candidates can create duplicate phone rows.
   Mitigation: resolve a deterministic existing/current target key before the
   statement and retain unique-key convergence tests.
3. Risk: bulk SQL can accidentally overwrite newer provider-health evidence.
   Mitigation: preserve the existing field-specific timestamp predicates and
   add mixed fresh/stale evidence assertions.

## Tasks

1. Trace current line, inventory, encryption, lookup-key, and provider-health
   owners and package the exact task for ReviewGPT Pro.
2. Inspect and integrate Pro's patch, reducing it to the smallest maintainable
   owner-local change and accepting ReviewGPT's publication-lock correction.
3. Run focused unit and real-PostgreSQL concurrency/query-count proof plus Web
   typecheck/diff checks.
4. Commit, push, open the PR, then resolve specialist/final ReviewGPT and CI.

## Decisions

- Keep per-phone locking for unrelated single-phone writers unless direct proof
  shows it is obsolete there; this task removes the per-phone write loop only
  from the multi-phone synchronization paths.
- Keep a transaction-scoped advisory publication lock for set-based writers and
  candidacy snapshots, because ReviewGPT found a stale backup-read race during
  in-flight ownership moves.
- Use current `origin/main` in an isolated task worktree because the primary
  checkout contains unrelated edits and was stale.

## Verification

- Commands to run: focused hosted-Web Vitest slices for line store and inventory;
  opt-in local PostgreSQL inventory concurrency proof; Web typecheck or truthful
  diff-aware verification selected after the final file set is known.
- Expected outcomes: all checks pass; concurrent reversed-order snapshots finish
  without deadlock and converge to unique authoritative rows; member-facing
  backup reads fail soft while a publication is in flight.
Completed: 2026-08-10
