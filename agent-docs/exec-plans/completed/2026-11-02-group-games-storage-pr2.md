# Canonical game storage and deletion ownership

## Outcome and invariant

PR 2 replaces scalar invitation/departure/ticket storage directly while preserving released pair wire behavior and pair-only production admission. Stable seats, explicit shared-ciphertext ownership, and viewer-owned labels must survive successive account deletions. No new HTTP, contract, notification, or chat behavior.

## Owners and evidence

The existing game command/rule/view path remains authoritative. Prisma owns rows; account-deletion prepares crypto before locking and revalidates before applying. Current code cascades player rows, infers ciphertext ownership from creator/departure, and supports only one survivor. Replace those assumptions at their owners.

## Decisions

- Owner-authorized direct SQL migration, including data conversion, primary/FK transition, checks, and old-column removal. No expand/backfill/drain stages or fallback readers.
- Preserve pair deleted-player names with a bounded viewer-owned encrypted label projection on retained seats. Unjoined deleted invitees remain invitations, never fabricated players.
- Labels stay with their original viewer. Deterministic surviving ownership transfers shared words only. Empty games are explicitly deleted.
- Production creates and admits only pairs; group lifecycle and client capability remain later work.
- The predeploy migration guard needs an exact migration exception for the approved downtime. Migration commits before new Web is live, so old schema-dependent game routes fail during that window. The new schema-aware Web is the rollback floor.
- Work remains in this checkout, local commits only. No push, PR, or external review upload.

## Work

- [x] Final schema and direct migration, guarded fail-loud conversion.
- [x] Replace all old storage readers/writers with invitations, retained seats, explicit words owner and ticket seat arrays.
- [x] Generalize deletion, label isolation, owner transfer and race revalidation.
- [x] PostgreSQL migration and pair/deletion regression proof.
- [x] Typecheck, lint, complexity, docs and candidate review; scoped commit.

## Verification

Use isolated loopback database `murph_test_group_games_pr2`, apply real migrations, run focused game and account deletion suites, then remove it. Prove migration conversion and failure rollback, unchanged pair views, FK preservation, successive three-player deletion, encrypted label isolation, and ownership revalidation. Run Web typecheck/lint, complexity diff and docs guards. Record results and deploy/rollback boundaries below before closure.

## Outcome and proof

Local implementation complete on `codex/group-games-storage`, based on
`7294434dad`. No push, PR, deployment, production mutation or other worktree
edit. PR 1 reconciliation remains a later rebase if its reviewed head changes.

- Final schema and one atomic migration; all dropped-column production readers
  and writers removed. No dual writes, fallback readers, backfill job, drain
  step or residual storage cleanup remains.
- Released `contract.ts` and HTTP routes are unchanged. Pair invitations,
  unjoined placeholders, private labels, ticket aliases and deletion views keep
  their existing expectations. Both creator and non-creator deletion pass.
- Three-player storage fixtures prove repeated owner transfers, retained seat
  tombstones, viewer-private names, stale preparation rejection, live-game
  survival with two remaining, and final removal when nobody remains.
- Joined times are written from the effective command clock and remain fixed
  when the development clock advances. Group admission explicitly rejects.
- Migration proof applies the actual prior SQL history in its own temporary
  database, seeds encrypted live/settled/rematch/invitation data and entries,
  then compares complete pair views. It checks conversion, restrictive owner
  deletion, preserved entry FK, array/seat/nullability constraints and atomic
  refusal for legacy departures, missing owners and ticket parties without seats.

## Changed owners

| Files | Change |
| --- | --- |
| `apps/web/prisma/schema.prisma`, `apps/web/prisma/migrations/20261102230000_game_seat_storage/migration.sql` | Final tables, keys, FKs, constraints and direct row conversion/removal. |
| `apps/web/scripts/run-prisma-migrate-deploy.ts` | Exact migration-id/checksum exception for approved downtime. |
| `apps/web/scripts/run-production-contract-migrations.ts` | Retire the immutable one-off recovery that requires a removed column. |
| `apps/web/src/lib/game/account-deletion.ts` | Outside-transaction crypto, ordered locked revalidation, deterministic shared-word transfer and per-viewer tombstones. |
| `apps/web/src/lib/game/service.ts` | Canonical invitation and words owners, explicit admission time, seat-based tickets, legacy pair projections. |
| `apps/web/src/lib/game/rules.ts`, `roster.ts`, `views.ts` | Pair admission gate, nullable-seat helpers, canonical ticket seats and unchanged pair wire aliases. |
| `apps/web/src/lib/game/access.ts`, `change-words.ts`, `chat-access.ts`, `chat-membership.ts` | Replace scalar ownership and invitation predicates. |
| `apps/web/src/lib/game/chat-bootstrap.ts`, `chat-delivery-authority.ts`, `chat-delivery.ts`, `chat-lifecycle.ts`, `chat-tool.ts`, `post-notification.ts`, `recap-regeneration.ts` | Adapt existing consumers to invitations and retained/deleted seats; no prompt, notification copy, timing or chat contract change. |
| `apps/web/src/lib/hosted-ops/app-review-game.ts`, `apps/web/src/lib/hosted-routing/thread-container-service.ts` | Seed final storage and respect nullable identities. |
| `apps/web/test/game-storage-migration-postgres.test.ts`, `game-account-deletion-postgres.test.ts` | Real migration and multi-survivor deletion proof. |
| `apps/web/test/game-service-postgres.test.ts`, `game-rules.test.ts`, `production-migration-guard.test.ts` | Frozen admission clock, pair-only admission, exact-checksum guard proof. |
| `apps/web/test/game-late-recap-postgres.test.ts` | Preserve historical SQL replay/refusal proof in an isolated legacy schema; current deletion race uses tombstones. |
| Other changed Web tests | Update storage fixtures, mock projections and teardown for the restrictive owner FK; released pair expectations retained. |
| `ARCHITECTURE.md`, `apps/web/README.md`, contract-migration README, weekly-game spec, account-deletion doc, testing map and index | Document final ownership, proof routing, approved downtime and rollback floor. |

## Verification commands and results

All PostgreSQL work used the isolated loopback database
`murph_test_group_games_pr2`; the migration suite created/dropped a separate
UUID-named test database. Both test databases were removed after verification.
`LOCAL_POSTGRES_URL` below denotes that isolated local URL, never production.

```sh
DATABASE_URL="$LOCAL_POSTGRES_URL" pnpm --dir apps/web prisma:migrate:deploy
DATABASE_URL="$LOCAL_POSTGRES_URL" pnpm --dir apps/web prisma:validate
pnpm --dir apps/web prisma:generate
DATABASE_URL="$LOCAL_POSTGRES_URL" MURPH_TEST_POSTGRES_CONCURRENCY=1 pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage --maxWorkers=2 --no-file-parallelism apps/web/test/game- apps/web/test/hosted-account-deletion apps/web/test/hosted-ops-app-review-game-postgres.test.ts apps/web/test/phone-calls-game-allowance-postgres.test.ts apps/web/test/hosted-runtime-owner-postgres.test.ts apps/web/test/production-migration-guard.test.ts
pnpm --dir apps/web typecheck:prepared
pnpm --dir apps/web lint
pnpm complexity:diff
pnpm docs:drift
pnpm docs:gardening
git diff --check
```

- Migration deploy/schema presence, Prisma validation and client generation: pass.
- Full routed run: 50 suites, 990 tests passed. After final refinements, affected
  deletion/migration/chat-setup/late-recap suites: 44 passed; service/rules/
  delivery-authority/late-recap/allowance suites: 169 passed, including two new
  admission tests; strengthened migration suite: 1 passed. No skipped PG proof.
- Web typecheck: pass. Web lint: exit 0; existing repository warnings remain,
  with new unused test imports removed.
- Complexity: pass against PR 1 head. Deletion maximum 19, service maximum 20.
  The only remaining hotspots are unchanged thread-container functions (31/21);
  this patch only narrows nullable participant identities there. No new debt.
- Docs drift: pass; gardening: zero issues; whitespace check: pass.
- Parent candidate review: checked conversion/failures, owner/cascade order,
  label isolation, locked revalidation, pair projection and deletion success paths.
  Internal storage change: pair UX Ready from composed API/service/view proof.
  No changed provider input, tool schema, assistant instruction or reply policy,
  so no new live-model journey is necessary. No new network/provider calls.
- Changelog: not applicable; internal storage only, pair behavior preserved and
  group creation/admission unavailable. No new repository friction entry required.

## Deployment and rollback

One migration: `20261102230000_game_seat_storage`. Merge triggers predeploy
migration before the new Web build becomes live. SQL commits conversion, checks,
PK/FK replacement and dropped columns together. A fail-loud conversion rolls
back; there is no partial backfill or second rollout step.

Accepted downtime starts at SQL commit and ends when the new Web is live and
old invocations have drained. A failed build/promotion extends it until a
compatible forward deployment. Old code can fail on game Home/history/create/
read, invitations and accept/negotiate, entries/changes/reports, ticket redeem,
block and shared-media authorization, public `/g/[token]`, internal game tools/
recaps/lifecycle, and `/api/settings/privacy/delete` for every account (its game
preparation runs unconditionally). Game-sponsored runtime access/allowance
fallbacks also fail; with a nonempty game allowlist, shared access predicates can
break dependent runtime admission and sweeps beyond members with games.
The exact route families and postdeploy checks are in `apps/web/README.md`
§ Direct game storage cutover.

Rollback floor: schema-aware Web immediately after migration commit. No automatic
reverse migration or compatibility with old Web is promised. Reverting requires
separately authorized restoration/downconversion plus matching Web, with loss of
later writes; prefer a forward fix. Existing recap lifecycle receipts survive
retirement of the legacy one-off SQL recovery. New recovery uses existing Ops.

Deferred by scope: group lifecycle/admission, capable-client contract/HTTP,
notification and chat behavior belong to later PRs. Storage cleanup is complete.
Push, external ReviewGPT and exact-head CI remain unrun under the local-only
instruction; they remain PR gates when pushing is authorized.

## Change size

Classification: production TypeScript under `src` is source; tests/fixtures are
Web tests; schema/migration/scripts are configuration/tooling; Markdown is docs.
No dependency, lockfile, generated or binary change.

| Category | Added | Removed | Net |
| --- | ---: | ---: | ---: |
| Source | 344 | 328 | +16 |
| Tests/fixtures | 368 | 124 | +244 |
| Docs (including this completed plan) | 268 | 26 | +242 |
| Configuration/tooling | 137 | 28 | +109 |
| Total | 1117 | 506 | +611 |
Status: completed
Updated: 2026-11-02
Completed: 2026-11-02
