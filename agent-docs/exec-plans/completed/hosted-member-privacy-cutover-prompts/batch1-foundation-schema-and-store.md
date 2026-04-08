Repository bootstrap:

- Before editing, read `AGENTS.md` and follow it.
- Treat that file as required worker bootstrap, not optional background context.
- If it points to additional repo docs, follow the stated read order before making code changes.
- If it requires coordination or audit workflow steps, do those explicitly rather than assuming the parent wrapper handled them.

You are implementing Batch 1 foundation for the hosted-member privacy cutover on the current live repo.

Why this lane exists:

- The current `HostedMember` row still mixes identity, routing, and billing-reference state.
- The live repo already has the right privacy primitives for blind-index contacts and masked phone display.
- In this repo shape, the additive Prisma models, migration/backfill, and new helper layer are one coupled surface. Own them together instead of splitting schema and repository work across competing workers.

Live-tree findings to respect:

- Verified email already lives in hosted execution user env, not in a hosted member Postgres field.
- `HostedSession` still exists in Prisma, but runtime use looks unproven. Do not remove it in this lane.
- Revnet is environment-gated. Keep wallet support possible, but do not make wallet mandatory for non-Revnet flows.

Constraints:

- Preserve unrelated dirty-tree edits and work from other workers.
- Stay inside the additive foundation surface. Do not cut over auth, webhook routing, Telegram settings sync, or Stripe behavior yet unless a tiny compatibility adjustment is required for compilation.
- Prefer one focused helper layer over further widening `member-identity-service.ts`.
- Do not add any Postgres email identity fields.
- Do not remove legacy `HostedMember` columns yet.
- Do not drop `HostedSession`.
- Return a concise handoff with changed files, verification run, and any blocker or proof gap.
- You are working in the shared live worktree with other workers. Do not revert or overwrite adjacent edits.

Goals:

- Add `HostedMemberIdentity`, `HostedMemberRouting`, and `HostedMemberBillingRef` to Prisma.
- Backfill those tables from existing `HostedMember` rows in one additive migration.
- Add one-to-one `memberId` relations plus the narrow unique indexes needed for lookup and reconciliation.
- Introduce a focused hosted-member store/helper layer that can:
  - find a member by `privyUserId`
  - find a member by phone lookup key
  - upsert Linq chat bindings
  - upsert Telegram routing bindings
  - read and write Stripe billing refs
- Keep runtime behavior unchanged for current callers; the new helper layer can be additive in this lane.
- Add focused tests for the new helper semantics and for the migration/backfill behavior if you can keep them within this owned surface.

Suggested primary files:

- `apps/web/prisma/schema.prisma`
- new Prisma migration under `apps/web/prisma/migrations/**`
- `apps/web/src/lib/hosted-onboarding/member-identity-service.ts`
- new hosted-member store/helper file(s) under `apps/web/src/lib/hosted-onboarding/**`
- focused tests under `apps/web/test/**`
- a concise architecture/update note only if required to explain the new additive owner surface

Acceptance:

- New tables exist and backfill from `HostedMember`.
- No legacy `HostedMember` columns are removed yet.
- New helper functions exist for identity, routing, and billing refs without changing product behavior.
- Wallet fields live on the identity side only as optional Revnet-aware state.
- No email identity field is added to Postgres.
