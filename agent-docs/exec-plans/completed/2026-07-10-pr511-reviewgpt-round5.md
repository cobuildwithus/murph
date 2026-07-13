# PR 511 ReviewGPT Round 5

## Goal

Close the two accepted ReviewGPT findings with the fewest possible authority
primitives: isolate revoked-access conversation replay from system work, and
replace process-clock roster ordering with one database-owned ordinal.

## Constraints

- Reuse the existing runtime processing-mode and mailbox-lane protocols; do not
  add a replay queue, scheduler, durable access state, or second mailbox path.
- The revoked-access exception may process committed conversation work only.
  System mailbox work, locally queued system work, maintenance, timers, and
  automations remain current-access gated and untouched for later processing.
- Keep active-access behavior unchanged.
- Restore lane-aware fetch and payload authorization: conversation rows remain
  owner-bound; system rows require current active access.
- Replace the route timestamp watermark instead of keeping parallel timestamp
  and ordinal authority.
- Allocate the database ordinal before the external Linq roster read, and never
  hold a Prisma transaction open across that read.
- Once a complete snapshot wins the route ordinal claim, apply it without
  per-participant wall-clock ordering. Keep timestamps diagnostic only.

## Working Set

- `apps/web/prisma/schema.prisma`
- `apps/web/prisma/migrations/20260709120000_hosted_thread_route_participant_addition/migration.sql`
- `apps/web/src/lib/hosted-routing/linq-thread-roster.ts`
- `apps/web/src/lib/hosted-orchestration/runtime-reconciliation-facts.ts`
- `apps/web/app/api/internal/hosted-mailbox/{fetch,payload/fetch}/route.ts`
- `packages/hosted-execution/src/{orchestration-control,runtime-control}.ts`
- `packages/hosted-orchestrator-temporal/src/workflows/hosted-user-runtime.ts`
- `apps/cloudflare/src/**` processing-mode propagation
- `packages/assistant-runtime/src/**` hosted runtime processing
- focused tests for every changed boundary

## Tasks

1. Add one `conversation_replay` processing mode and propagate it through the
   existing web, Temporal, Cloudflare, and assistant-runtime control path.
2. In replay mode, import and process conversation work only, checkpoint its
   disposition, and leave all system work untouched.
3. Make mailbox fetch and payload authorization lane-aware.
4. Replace roster timestamp authority with one PostgreSQL sequence and one
   nullable route `BigInt` applied ordinal; delete participant timestamp races.
5. Run focused and full verification plus required completion audits.
6. Commit and push through `scripts/finish-task`, then run a fresh exact-head
   ReviewGPT pass and replacement CI to zero findings and green checks.

## Verification Plan

- Focused web, Temporal, Cloudflare, hosted-execution, and assistant-runtime
  tests covering replay isolation, lane-aware authorization, mode fencing, and
  roster observation ordering/failure gaps.
- Prisma format/generate and migration/privacy guards.
- Root typecheck and repo-required full verification.
- Coverage, security/privacy/reliability, simplicity, and task-finish audits.
- Saved exact-head ReviewGPT response ending in `REVIEW_COMPLETE`, followed by
  green exact-head CI and a clean mergeability check.

## Audit Resolutions

- Coverage found one post-checkpoint member-channel escape. Replay delivery now
  bypasses that system barrier, and a foreground delivery regression test proves
  the current reply drains without mailbox, cron, wake, or cleanup work.
- Security/reliability found a default-runtime revocation race. A replay request
  now aborts and replaces an active default fence through the existing mode
  transition path before narrow processing starts.
- Simplicity collapsed processing-mode ownership to one tuple, deleted duplicate
  Cloudflare normalizers, and removed dead processing-mode plumbing from blocked
  reconciliation facts.
- The roster sequence/default and newer-wins conditional update were proven on a
  fresh PostgreSQL database with reversed ordinal application. The existing unit
  suite separately covers reversed timestamps and stale/equal snapshots; no new
  database-test harness was added solely for this one SQL invariant.

## Verification Results

- Root workspace typecheck passed.
- Full web verifier passed: 376 files passed (1 skipped), 4,125 tests passed
  (9 skipped), lint had zero errors, dev smoke passed, and the 181-route
  production build completed.
- Full Cloudflare verifier passed: 94 files and 1,690 tests, including hosted-local
  coverage; the post-audit mode-transition suite and typecheck also passed.
- Assistant runtime passed 70 files and 1,502 tests (2 skipped), including the
  replay post-checkpoint regression; typecheck passed.
- Hosted execution passed 28 files and 287 tests; Temporal focused coverage
  passed 34 tests; both typechecks passed.
- Focused web coverage passed 6 files and 158 tests, with the final
  reconciliation-facts test and web typecheck rerun after simplification.
- Prisma schema validation/generation, PostgreSQL `db push`, the real ordinal
  authority proof, and `git diff --check` passed.

## Deployment Order

1. Deploy the Cloudflare worker and hosted runner bundle with an immediate
   container rollout, then verify the expected runner fingerprint.
2. Deploy the matching Temporal worker while web still omits the new fact field.
3. Deploy web and the additive migration. Once web emits `conversation_replay`,
   the matching Cloudflare/runner and Temporal versions are the rollback floor.
Status: completed
Updated: 2026-07-10
Completed: 2026-07-10
