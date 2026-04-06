# Hosted-member privacy Batch 1 foundation

Status: completed
Created: 2026-04-06
Updated: 2026-04-06

## Goal

- Add the additive hosted-member privacy foundation under `apps/web` without changing current product behavior.
- Split identity, routing, and billing-reference ownership into focused Prisma tables plus a narrow helper layer, while keeping the legacy `HostedMember` row intact for now.

## Success criteria

- Prisma defines additive `HostedMemberIdentity`, `HostedMemberRouting`, and `HostedMemberBillingRef` models with one-to-one `memberId` relations and the narrow unique indexes needed for lookups and reconciliation.
- One additive migration backfills those tables from existing `HostedMember` rows.
- No new Postgres email identity field is introduced.
- Legacy `HostedMember` columns remain in place, and `HostedSession` remains untouched.
- A focused hosted-member store/helper layer exists for:
  - member lookup by `privyUserId`
  - member lookup by phone lookup key
  - Linq chat binding upsert
  - Telegram routing binding upsert
  - Stripe billing-ref read/write
- Current callers continue to behave the same in this lane; cutover of auth, webhook routing, Telegram sync, and Stripe behavior stays out of scope unless a tiny compatibility fix is required for compilation.
- Focused tests cover the helper semantics and the additive migration/backfill behavior where practical within this owned surface.

## Scope

- In scope:
  - `apps/web/prisma/schema.prisma`
  - new Prisma migration files under `apps/web/prisma/migrations/**`
  - `apps/web/src/lib/hosted-onboarding/member-identity-service.ts`
  - new hosted-member helper/store files under `apps/web/src/lib/hosted-onboarding/**`
  - focused hosted-web tests under `apps/web/test/**`
- Out of scope:
  - auth or request cutover to the new tables
  - webhook routing cutover
  - Telegram settings-sync cutover
  - Stripe behavior changes beyond compatibility needed to compile
  - removal of legacy `HostedMember` columns
  - removal of `HostedSession`

## Constraints

- Preserve unrelated dirty worktree edits from other lanes.
- Keep wallet support possible, but optional and Revnet-aware rather than mandatory for non-Revnet flows.
- Prefer one focused helper layer over widening `member-identity-service.ts`.
- Do not add compatibility grab-bags or repo-wide abstractions.

## Risks and mitigations

1. Risk: The migration and helper layer drift from existing hosted-member invariants.
   Mitigation: Read current schema, services, and tests first; keep the new layer additive and narrow.
2. Risk: Routing and billing helpers accidentally change runtime behavior before the later cutover batches.
   Mitigation: Keep current callers intact and add only targeted compatibility hooks where needed for compile and test stability.
3. Risk: Shared-worktree overlap corrupts adjacent hosted edits.
   Mitigation: Stay inside the declared file set, re-read touched files before patching, and commit only the exact changed paths.

## Verification

- Planned commands:
  - `pnpm typecheck`
  - `pnpm test:coverage`
  - `pnpm --dir apps/web lint`
- Planned direct proof:
  - inspect the generated SQL migration to confirm additive table creation plus backfill statements from `HostedMember`

## Notes

- This is likely large enough to require the repo's `simplify` audit before the final `task-finish-review` pass if the implementation diff reaches the workflow threshold.
Completed: 2026-04-06
