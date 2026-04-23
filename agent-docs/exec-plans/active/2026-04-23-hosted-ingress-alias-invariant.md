# Harden hosted ingress alias invariants

Status: in_progress
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Make hosted ingress alias correctness mechanical so wake identity resolution stays deterministic even if application-level serialization is bypassed or prior rows have drifted.

## Success criteria

- Postgres enforces at most one current alias per `(user_id, ingress_event_id)` where `replaced_by_event_id IS NULL`.
- `replaced_by_event_id` cannot point at a missing alias row for the same user.
- Current-alias reads stop depending on nondeterministic `findFirst` selection.
- Alias replacement treats an unexpected zero-row update as invariant breakage instead of silently continuing.
- Focused regression coverage exists for the schema baseline and store-level invariant behavior.

## Scope

- In scope:
- `apps/web/prisma/{schema.prisma,migrations/2026040600_init/migration.sql}`
- `apps/web/src/lib/hosted-ingress/{store-data.ts,store-append.ts}`
- directly coupled `apps/web/test/{hosted-ingress-store-data,hosted-onboarding-privacy-foundation-migration}.test.ts`
- `agent-docs/exec-plans/active/{2026-04-23-hosted-ingress-alias-invariant.md,COORDINATION_LEDGER.md}`
- Out of scope:
- broader hosted-ingress lifecycle, queue, or hosted-run refactors
- cleanup or data backfill for already-drifted production rows outside fail-closed invariant enforcement
- unrelated schema churn already active in the shared `apps/web` migration files

## Constraints

- Technical constraints:
- Treat this as a high-risk `apps/web` persisted-state change: prefer DB-backed invariants over read-time convention.
- Preserve the existing alias ownership model keyed by `(user_id, event_id)`.
- Keep changes additive on top of the current dirty-tree rename/hard-cut edits in the same files.
- Product/process constraints:
- Preserve unrelated in-flight work in `apps/web/prisma/schema.prisma`, `apps/web/prisma/migrations/2026040600_init/migration.sql`, `apps/web/src/lib/hosted-ingress/store-data.ts`, and `apps/web/src/lib/hosted-ingress/store-append.ts`.
- Follow the high-risk completion path: required verification, direct proof if needed, `coverage-write`, and `task-finish-review`.

## Risks and mitigations

1. Risk: a new FK or uniqueness rule could conflict with legitimate alias replacement writes.
   Mitigation: align the write order and store helpers with the new invariant, then cover the replacement path in focused tests.
2. Risk: Prisma schema changes for a self-reference could introduce generator friction.
   Mitigation: keep Prisma declarations minimal and fall back to migration-only SQL where Prisma cannot truthfully model the DB rule.
3. Risk: existing drift in local fixtures/tests could fail once reads stop choosing an arbitrary current alias.
   Mitigation: update tests to assert the intended single-current invariant explicitly and fail closed on broken replace paths.

## Tasks

1. Done: registered the task in the ledger and created this active plan.
2. Done: inspected the current alias schema/store code and the existing dirty overlap in the touched files.
3. Done: implemented the DB and runtime invariant hardening for hosted ingress aliases.
4. Done: added focused regression coverage and updated the hosted-ingress migration guard expectations.
5. Done: ran the required verification lane, completed the required `coverage-write` and `task-finish-review` audit passes, and reran the affected checks after the post-review proof update.
6. Pending: create a scoped commit only if exact staging is possible in the current shared dirty tree.

## Decisions

- Added a migration-level partial unique index on `hosted_ingress_event_alias(user_id, ingress_event_id)` filtered to `replaced_by_event_id IS NULL` so Postgres enforces one current alias per wake.
- Added a self-referential `(user_id, replaced_by_event_id)` foreign key to `hosted_ingress_event_alias(user_id, event_id)` and made it `DEFERRABLE INITIALLY DEFERRED` so the existing replace-then-insert transaction shape remains valid.
- Kept the partial unique index migration-only because Prisma cannot express filtered unique indexes directly; Prisma now models only the self-referential alias relation.
- Hardened current-alias reads to fail closed when multiple current rows already exist instead of choosing one with `findFirst`.
- Hardened alias replacement to throw on zero-row updates instead of returning a boolean the caller can ignore.
- Added lazy materialization of the current dedupe-key alias in write paths so replacement rows never point at a missing current alias.

## Verification

- Commands to run:
- `pnpm verify:acceptance`
- focused `apps/web` Vitest coverage for the touched alias tests during local iteration
- `git diff --check`
- required `coverage-write` and `task-finish-review` audit passes
- Expected outcomes:
- alias replacement fails closed when the prior current row cannot be replaced
- alias reads become deterministic under the enforced one-current-row invariant
- schema baseline tests reflect the added uniqueness and FK guarantees
- Results so far:
- `pnpm --dir apps/web prisma:generate` passed.
- `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/hosted-ingress-store-data.test.ts --no-coverage` passed.
- `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/hosted-onboarding-privacy-foundation-migration.test.ts -t 'single checked-in baseline|hosted-ingress runtime storage aligned' --no-coverage` passed.
- `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/hosted-ingress-store-append.test.ts apps/web/test/hosted-ingress-store-data.test.ts apps/web/test/hosted-onboarding-privacy-foundation-migration.test.ts --no-coverage` passed during the `coverage-write` pass.
- `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/hosted-ingress-store-append.test.ts apps/web/test/hosted-ingress-store-data.test.ts apps/web/test/hosted-onboarding-privacy-foundation-migration.test.ts -t 'appendHostedCoalescingWakeTx|single checked-in baseline|hosted-ingress runtime storage aligned' --no-coverage` passed.
- `pnpm --dir apps/web typecheck` passed on the final rerun after the post-review append-path test landed.
- `pnpm verify:acceptance` failed on unrelated pre-existing `packages/query/**` typecheck errors in `src/wearables*.ts` and `test/wearables-source-health-final.test.ts` before the acceptance lane reached this task's `apps/web` coverage stage.
- `git diff --check -- apps/web/prisma/schema.prisma apps/web/prisma/migrations/2026040600_init/migration.sql apps/web/src/lib/hosted-ingress/store-data.ts apps/web/src/lib/hosted-ingress/store-append.ts apps/web/test/hosted-ingress-store-data.test.ts apps/web/test/hosted-onboarding-privacy-foundation-migration.test.ts agent-docs/exec-plans/active/2026-04-23-hosted-ingress-alias-invariant.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md` passed.
- `git diff --check -- apps/web/prisma/schema.prisma apps/web/prisma/migrations/2026040600_init/migration.sql apps/web/src/lib/hosted-ingress/store-data.ts apps/web/src/lib/hosted-ingress/store-append.ts apps/web/test/hosted-ingress-store-append.test.ts apps/web/test/hosted-ingress-store-data.test.ts apps/web/test/hosted-onboarding-privacy-foundation-migration.test.ts agent-docs/exec-plans/active/2026-04-23-hosted-ingress-alias-invariant.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md` passed.

## Outcome

- Production fix plus focused regression coverage landed in the shared dirty tree.

## Audits

- `coverage-write` added `apps/web/test/hosted-ingress-store-append.test.ts` to cover lazy current-alias materialization in append paths without touching production code.
- `task-finish-review` found one medium proof gap in the newer-arrival coalescing update path; that gap was closed locally by extending `apps/web/test/hosted-ingress-store-append.test.ts`, then rerunning the focused proof bundle.

## Commit note

- No scoped commit was created. The touched schema and hosted-ingress files already contain overlapping unrelated active changes in this shared dirty tree, so staging exact paths would absorb work outside this alias task.
