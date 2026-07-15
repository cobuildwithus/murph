# Move Linq invite orphan cleanup behind Vercel drain

Status: completed
Created: 2026-07-15
Updated: 2026-07-15

## Goal

- Close ReviewGPT's accepted rollout finding for PR #668 by ensuring the final
  orphaned Linq signup-delivery scrub runs only after the replacement Vercel
  deployment is promoted and prior functions have drained.

## Success criteria

- Preserve the already-merged Prisma migration as immutable deployment history.
- Add an idempotent contract migration with the same narrow orphan predicate so
  rows created by warm old functions after the predeploy pass are removed.
- Prove with PostgreSQL that a predeploy pass can preserve a then-live row, an
  old-bundle deletion can orphan it, and the post-drain pass removes it while
  preserving live-member and unrelated delivery rows.
- Keep the existing live account-deletion and delayed-dispatch fences unchanged.
- Complete scoped verification, the required coverage audit, parent final
  review, a follow-up PR, ReviewGPT, CI, and mergeability proof.

## Scope

- In scope: one post-drain contract migration, migration inventory/static proof,
  one focused PostgreSQL rollout regression, the existing CI PostgreSQL proof
  command, and concise deployment/deletion documentation.
- Out of scope: changing the live account-deletion implementation, changing
  signup dispatch behavior, rewriting the merged Prisma migration, adding a new
  migration runner, or broad Linq retention changes.

## Constraints

- Technical constraints: the contract SQL must remain idempotent and use the
  existing `Hosted Web Contract Migrations` owner, advisory lock, drain wait,
  and production-alias proof.
- Product/process constraints: account deletion must continue to complete for
  authorized members while raw member identifiers do not survive indefinitely;
  preserve unrelated working-tree and migration history.

## Risks and mitigations

1. Risk: deleting or editing the merged Prisma migration creates migration-history
   drift if the pending production deploy already applied it.
   Mitigation: leave that migration byte-for-byte intact and add a separately
   tracked contract migration for the authoritative post-drain pass.
2. Risk: the final scrub deletes live-member or unrelated delivery state.
   Mitigation: retain the exact two-template, canonical-prefix, parsed-member-id,
   and missing-member predicate and cover positive controls in PostgreSQL.
3. Risk: the contract migration runs against a stale deployment.
   Mitigation: reuse the existing workflow's deployed-commit ancestry check,
   bounded old-function drain, final alias recheck, and advisory lock.

## Tasks

1. Revalidate the ReviewGPT finding against Vercel predeploy and contract-lane
   repository evidence.
2. Add the post-drain contract migration without mutating Prisma history.
3. Add static inventory and production-faithful PostgreSQL rollout proof.
4. Update durable deletion/deployment docs with the two-pass ownership and
   rollback/deploy implication.
5. Run focused and routed verification, required audits, parent final review,
   commit/plan closure, follow-up PR, ReviewGPT, CI, and merge proof.

## Decisions

- ReviewGPT's High rollout finding is accepted. The old bundle remains live
  while `pnpm release:production:migrate && pnpm build` runs, so the predeploy
  scrub cannot be the final deletion authority.
- PR #668 merged and its main deployment entered `pending` before the review
  returned. Preserve the merged Prisma migration; a second idempotent scrub in
  the existing post-drain contract lane is the smallest production-safe fix.

## Verification

- Focused migration inventory: 37 tests passed.
- Direct PostgreSQL 17 proof passed: the predeploy pass preserved a then-live
  row, deletion orphaned it, the post-drain pass removed exactly that row while
  preserving live and unrelated controls, and a repeated pass removed nothing.
- `pnpm test:diff` passed twice, including the dedicated `coverage-write` pass:
  hosted web typecheck, lint, build, 425 files, and 5,121 tests passed.
- Required `coverage-write` audit completed with no edits or findings; parent
  final review found no remaining patch-specific proof gap.
- `pnpm verify:acceptance` completed the workspace/app checks but its unrelated
  package-coverage fanout was red: one CLI test timed out under load and the
  assistant-engine coverage worker exhausted its heap. The CLI test passed in
  3.7 seconds in isolation; assistant-engine's no-coverage lane passed 154 files
  and 2,208 tests, while its standalone coverage lane reproduced the heap limit.
- Follow-up PR CI, ReviewGPT, and mergeability remain as post-commit gates.
Completed: 2026-07-15
