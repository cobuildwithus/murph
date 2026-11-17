# Earn Health and Friends medals from Progress

Status: completed
Created: 2026-11-17
Updated: 2026-11-17

## Outcome and scope

Outcome: Prizes discovers eligible Health and Friends medals without first opening their pages.
Reaches: complete main Progress reads; authorized health with a saved replica; current co-players with complete classified exercise history.
Proof: route contracts execute the post-response callback, read medals back on the next request, and cover denial, missing input, incomplete cohorts and failures.

Server only. Preserve the wire, award rules, baseline coverage and earned dates.
No app change, merge or ReviewGPT; the integrator owns external review.

## Cause and design

Health writes currently live only inside its page reader. Friends writes live
only inside its page reader for the selected exercise. Prizes links those pages
through medals, so first awards are unreachable.

Share Health's baseline/journey/award write function and Friends' exercise
selection and guarded award commit. The authenticated GET boundary schedules
one after-response batch after a complete main read. Run Health and Friends
sequentially with independent failure handling and one constant error code.
Keep session/health checks and pair locks plus commit-time audience checks.

A sealed completion receipt on the existing restingHeartRate measure records
the replica publication timestamp, evaluation instant and both time zones.
Only a successful entire health batch writes it. An unchanged publication and
unchanged member/vault date and settled-step date skip Cloudflare input loading.
Baseline mutation timestamps cannot prove a completed batch; no table or column
is needed. Concurrent reads may duplicate work; existing CAS/unique guards stay
in charge. Failures leave the input eligible on the next ordinary read.

## Plan deviations

The requested background settlement extends the locked plan's page-only timing
and logged background failure handling. The sealed receipt extends existing
measure JSON to bound cost for Prizes (row 1). No new endpoint, table, registry,
flag, column or preference. Scheduling belongs at the authenticated GET boundary
so the internal game-only reader and measure mutation responses retain their
existing contract.

## Verification

- Product UX: Patch / Ready. Synthetic main GET journeys prove baseline freeze,
  Health/age/Steps/Sleep awards, two exercise passes and next-read medal visibility.
  Denial, missing input, incomplete/pending cohorts, commit-time authority changes,
  partial failure, original earned dates and never-revoke behavior are covered.
- Focused Health/Friends/Progress suites: 150 tests, exit 0. Final background
  suite: 25 tests, exit 0, including two 10,000-amount cardinality cases with one
  cohort/game-series load, one award commit and one pair lock per subject.
- `pnpm test:diff` over changed owners: exit 0. Web tests: 16,372 passed,
  2,883 skipped. Selected guards, typecheck, lint, dev smoke and production build
  passed. Local dependency installation and generated Prisma artifacts were
  required before the initial focused invocation could run.
- `pnpm --dir apps/web typecheck`, Web lint, `pnpm complexity:diff`,
  `pnpm docs:drift`, changelog generation and its four route tests: exit 0.
  Existing lint warnings only; no complexity hotspot above 20.
- Candidate diff/privacy review passed. Architecture owns the new sealed receipt
  classification; changelog linked to PR #5142. No production input or deploy
  was exercised; the post-deploy check is the same Progress-then-Prizes journey.
- First CI found one PostgreSQL fixture calling the real `after()` outside a
  Next request scope (shard 5, exit 1). That found-goal fixture now mocks the
  scheduler, as the other foreground fixtures do; the dedicated background
  suite owns callback proof. Its five real PostgreSQL tests pass in an isolated
  local database (exit 0), and the affected Web typecheck passes again (exit 0).
- Local work complete. Final candidate goes through exact-head required CI
  before handoff; no merge or ReviewGPT. No open product questions.
Completed: 2026-11-17
