# Game storage parent review and PR completion

## Outcome

Unify joined and never-joined pair departures on retained player tombstones;
keep invitation labels single-purpose and pair wire output unchanged. Rebase PR 2
onto current main, preserve scheduled automation games/polls behavior, and finish
ReviewGPT plus required CI without merge or deploy.

## Work

- [x] Replace overloaded invitation departures and inline Prisma type import.
- [x] Add composed invited-deletion proof; update current architecture owner.
- [x] Rebase on current origin/main and verify affected integrations.
- [x] Run focused PostgreSQL suites, typecheck, lint, complexity and docs checks.
- [ ] Push draft, complete PR evidence, mark Ready and start ReviewGPT on vonneumann concurrently with CI.
- [ ] Resolve findings, validate reasoning duration and exact-head CI, close plan.

## Boundaries

One direct migration, unchanged SQL unless evidence requires otherwise. Production
remains pair-only; no public changelog, contract, notification or chat expansion.
All commits retain the requested co-author. No merge or deployment. Existing
completed execution plans remain historical and immutable.

## Evidence

- Rebased on `7ebfff430b8bb5b74153c72a7848e13edec19c37`; scheduled game reads
  and native poll support remain intact.
- `DATABASE_URL="$LOCAL_POSTGRES_URL" pnpm --dir apps/web prisma:migrate:deploy`
  and `pnpm --dir apps/web prisma:generate`: pass. Migration bytes and the exact
  checksum exception are unchanged.
- Isolated PostgreSQL run: 52 suites, 1,050 tests passed. Selection: `game-`,
  `hosted-account-deletion`, game Ops/phone allowance/runtime-owner suites,
  production migration guard, hosted poll authority and poll tool. Includes the
  real old-schema migration proof and new invited-account-deletion projection.
  Flags: `MURPH_TEST_POSTGRES_CONCURRENCY=1`, `--no-coverage --maxWorkers=2
  --no-file-parallelism`, Web Vitest config. No shared database used; the task
  database and migration-test database were removed after verification.
- `pnpm --dir apps/web typecheck:prepared`: pass.
- `pnpm --dir apps/web lint`: pass with existing warnings.
- `pnpm complexity:diff`: pass; two unchanged thread-container routing hotspots
  (31 and 21). Only the nullable member-id projection changes there; refactoring
  unrelated routing functions would broaden scope without simplifying this work.
- `pnpm docs:drift` and `pnpm docs:gardening`: pass, zero documentation issues.
- Parent review confirms invitation labels have one meaning and the new test
  exercises preparation, locked application, persisted erasure and pair views.
- PR review and required CI remain pending.
