# Many concurrent games per pair

Status: completed
Created: 2026-11-01
Updated: 2026-11-01

## Outcome and invariants

Allow two players up to ten open games, each retaining independent terms, days,
posts, unlocks, proposals, settlement, tickets and rematch ancestry. Preserve the
pinned native wire shape; add only TOO_MANY_GAMES and clarify error comments.
Keep exact accepted-sender and room authority, pair-owned lore and one room's
funding budget. Work only in this checkout; no push, PR, production or secrets.

## Decisions and evidence

- Derive the pair from indexed GamePlayer rows (option b). Delete
  liveRosterKey and its helper: service, funding SQL and ingress bootstrap are
  the only functional consumers, and each already has both player identities.
  The existing member index and game/member primary key serve these reads.
  No pair table, new column or persisted counter is needed.
- Count unexpired addressed invites, unexpired negotiations and live games.
  Unaddressed links have no pair until join. Exclude the game being admitted
  so acceptance of an already counted invite/negotiation consumes no new slot.
  One named constant owns ten. Existing lockGamePair serializes all admissions;
  normal maintenance settles due games before admission. Approval changes an
  already counted negotiation to live, under the same pair lock.
- Rematches follow previousGameId ancestry, not the pair's newest game. A
  settled descendant makes its ancestor outdated; an open direct rematch is a
  chain conflict, except the opposite player's request accepts that invite.
  Add an index on the existing previousGameId because recursive descendant
  lookup otherwise repeatedly scans all games. No chain/root column is needed.
- Predeploy removes only the obsolete roster CHECK and unique index, with exact
  statement exceptions in run-prisma-migrate-deploy.ts. Keep the nullable unused
  column through the old-function window; postdeploy contract cleanup drops it.
  New code never reads/writes it. After cleanup, this code is the rollback floor.
  Converge Web before enabling the native multi-game experience; old Web can
  temporarily reject an additional game but must remain schema-compatible.
- Chat tools already require gameId for every mutation and expose task words.
  Preserve that contract, return a recoverable missing-id error, and explain
  selection only when several games are returned. Read all ten active games
  ahead of bounded recent history, avoiding the present five-game truncation.
- Bootstrap must serialize room selection/creation with the pair lock and reuse
  a pair's bound room, including its in-flight route-less bootstrap. Existing
  receipt/mailbox ownership continues to serialize provider creation.
- Daily multiplication occurs in service.ts reserveDueGameMissedDayCheckIns
  and chat-lifecycle.ts deliverGameMissedDayLifecycle. Batch due missed-game
  context per pair/day through existing lifecycle receipts, with one
  message for simultaneous missed games. Reuse the receipt payload-owner room
  index for bounded room discovery, including receipts of recently settled games.
  Preserve single-game wording apart from the missing notification decision
  format instruction exposed by the real assistant proof.
  Kickoff, proposal, cancellation, rematch and recap remain per game. Post pushes
  retain the explicit existing per-game/day policy and exact game deep link.
- Blocks already enumerate pair games; history, reports, tickets, recaps and
  push receipts use game IDs. Audit these owners and remove obsolete key writes.

## Files / sequence

1. Schema + staged migrations + deploy guard; rules/contract; service admission
   and chain queries; pair selection helpers.
2. game/chat-access, chat-membership, chat-bootstrap, chat-lifecycle,
   chat-lifecycle-receipt, missed-check-in; prepared-thread-container;
   account-deletion; app-review-game; shared runtime game tool/context owners.
3. Existing game PostgreSQL/service/chat/allowance/ingress/schema/deploy tests,
   deterministic assistant tools and focused real-Codex journey.
4. weekly-game.md, ARCHITECTURE.md Weekly Game, index, migration owner and
   changelog as applicable; update this plan with exact evidence.

## Product journeys and proof

- Start two and ten independent same-pair games; refuse an eleventh plainly.
- Race invitations/rematches at nine slots: exactly one new admission wins.
- Accept a counted invitation at ten; retry accepted writes without new slots.
- Rematch one chain while another plays; reject only same-chain conflicts or
  settled descendants; simultaneous opposite asks join the same game.
- Read all active tasks in chat; named changes/photos/incomplete days affect
  only the chosen game; ambiguous requests ask which task, with no mutation.
- Several games reuse one room and budget, even during first-room bootstrap.
- Multiple due misses produce one bounded message; single-game copy unchanged.
- Block/delete ends all affected games; independent history and tickets survive.

Use an isolated loopback murph_test_many_per_pair database with actual Prisma
migrations (not db push, which omits handwritten checks). Run focused Vitest
PostgreSQL suites, touched deterministic tests, apps/web typecheck, touched-file
lint, complexity diff, and one focused real-Codex journey after cheap proof.
Record counts, commands, remaining limits and UX Ready/Hold. Review the complete
diff for privacy and scope; finish using scripts/finish-task, without pushing.

## Progress / evidence

- Clean requested branch verified. Read task routing and relevant owner sections.
- Installed frozen dependencies in the empty checkout; Frog list inspected.

- Implemented derived-pair admission and per-chain rematches, including the
  settled-only source rule. Cancelled negotiations start a fresh ordinary link.
- Removed obsolete key writes from deletion and app-review fixtures. Block and
  account-deletion proofs now terminate two concurrent games. Existing history,
  ticket, report, recap and push owners remain keyed to each game.
- Shared-room funding SQL selects one bounded eligible game, and PostgreSQL
  EXPLAIN proof exercises the existing player indexes even with historical games.
- Tested pair-locked simultaneous room binding and route-less room reuse. The
  bootstrap recovery suite covers current proposals and superseded work.
- Daily reservation uses the existing payload-owner room index; canonical batch
  facts exclude self-reported incomplete artifacts and any-days schedules.
- Real batch-message proof exposed a missing notification decision format:
  the lore-enabled host uses the conversation profile, but the adapter requires
  JSON. Added that format instruction to the existing missed-day builder.
  Single-game ordinary tool output remains byte-identical; missed-day wording
  gains only this required delivery instruction.
- No new table, column, counter, feature flag, pair record or chain record.
  Only the previous-game ancestry index is added. No native wire changes beyond
  the pinned TOO_MANY_GAMES enum addition and error documentation.

## Verification commands and results

All database checks use the isolated loopback test lane below. No primary dev
or production data, credentials or delivery providers were used.

```sh
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/murph_test_many_per_pair \
MURPH_TEST_POSTGRES_CONCURRENCY=1 \
pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage \
  apps/web/test/game- \
  apps/web/test/phone-calls-game-allowance-postgres.test.ts \
  apps/web/test/hosted-ops-app-review-game-postgres.test.ts \
  apps/web/test/hosted-prepared-thread-container.test.ts \
  apps/web/test/hosted-runtime-owner-postgres.test.ts \
  apps/web/test/production-migration-guard.test.ts \
  apps/web/test/changelog-page.test.tsx --maxWorkers=1 --no-file-parallelism
```

Result: 46 files, 901 passed, zero failed or skipped. Covers two/ten games,
eleventh join and negotiation refusal, race at nine for joins and independent
rematches, counted-invite acceptance, expiry, per-chain conflicts, named chat
posts/incomplete days/proposals, missing-selector refusal, concurrent binding,
funding SQL, one pair/day reservation under concurrent sweeps, and deletion.
Earlier obsolete fixture expectations and a missing partial-mock export were
corrected. A later parallel-file rerun exposed cross-suite NOWAIT contention on
the runtime cutover singleton; the final command serializes files while
retaining intentional concurrency inside the cap and room-binding tests.

```sh
pnpm exec vitest run --config packages/assistant-engine/vitest.config.ts --no-coverage \
  packages/assistant-engine/test/assistant-game-tools.test.ts
pnpm exec vitest run --config packages/hosted-execution/vitest.config.ts --no-coverage \
  packages/hosted-execution/test/game-chat-notifications.test.ts \
  packages/hosted-execution/test/game-tools-compatibility.test.ts
```

Results: assistant tools 29 passed; runtime contracts/notifications 32 passed,
one existing skipped case, zero failures. Missing selectors never reach the
mutation port; single-game output is exact, multi-game output carries selection
guidance. Notification tests prove both send and skip decision shapes.

```sh
pnpm test:assistant:live -- --test 'game chat concurrent tasks selects safely: named'
pnpm test:assistant:live -- --test 'game chat concurrent tasks selects safely: ambiguous'
pnpm test:assistant:live -- --test 'game concurrent missed tasks deliver one combined daily message'
```

Named and ambiguous journeys: one passed each, using gpt-6.1-sol through the
local subscription. Named asks read then update only the reading game and
confirm the incomplete date. Ambiguous asks read then ask which task, with no
write. Reply review: Ready. Batch journey: one passed, 622 unrelated live cases skipped. It queued exactly
one short message naming both people and their tasks. The notification-format
repair was necessary; the test also accepts ordinary task metaphors and seeds
existing pair lore for the send case. Final reply review: Ready. Synthetic content only; transcripts are not persisted in this plan.

```sh
pnpm --dir apps/web typecheck
pnpm --dir packages/assistant-engine typecheck
pnpm --dir packages/hosted-execution typecheck
pnpm complexity:diff
# From apps/web, passing the explicit changed TS/TSX file list:
pnpm exec oxlint --format unix <changed-files>
git diff --check
```

Typechecks passed. Complexity passed: 19 changed source files; one unchanged
hotspot (ensureHostedPreparedLinqThreadContainerRouteTx, complexity 22). Touched
lint passed with 14 pre-existing unused-symbol warnings in the large live-test
and migration-test files, zero errors; no new warnings. Whitespace check passed.

Prisma migration proof: the isolated lane was built using actual migrations.
Additionally executed the final exact predeploy SQL against an isolated schema
with the old check and unique index, inserted concurrent live rows using both
new and old writer shapes, then ran the exact cleanup twice. Three rows stayed
valid, the ancestry index existed, the retired column was absent, and the
scratch schema was removed. Both stages passed. Production deployment remains
with the parent; predeploy then Web convergence/drain then contract cleanup.

## Completion and parent handoff

- Product UX: Ready for the implemented backend journeys. No UI was changed or claimed verified here.
- Hot path: pair state reads return all ten active games within the existing
  transport bound. Only multi-game tool responses append selection guidance.
  Cap counts and room binding use the existing pair lock; no external work is
  added inside those transactions. Daily batch context is bounded to ten games.
- Changelog: multiple-games-with-a-friend. The parent must populate its PR
  provenance when opening the combined feature PR; no PR was authorized here.
- Frog list inspected before setup and invocation corrections; no new
  repository-actionable tooling friction was identified until the final
  cross-suite database collision. Logged it in
  `.agents/friction-log/20261101224941-shared-postgresql-proof/friction.md` and
  used serial file execution. Product prompt repairs remain covered by their
  owning implementation and tests.
- Parent owns push, PR, exact-head CI, ReviewGPT concurrently with CI, merge and
  deployment. None were attempted in this checkout.
- Local completion uses scripts/finish-task with the explicit file inventory.

## Complete file inventory

- `.agents/friction-log/20261101224941-shared-postgresql-proof/friction.md`
- `ARCHITECTURE.md`
- `agent-docs/exec-plans/completed/2026-11-01-game-many-per-pair.md`
- `agent-docs/index.md`
- `agent-docs/product-specs/weekly-game.md`
- `apps/web/changelog/entries/2026-11-01/multiple-games-with-a-friend.json`
- `apps/web/prisma/contract-migrations/20261101230000_drop_game_live_roster_key/migration.sql`
- `apps/web/prisma/contract-migrations/README.md`
- `apps/web/prisma/migrations/20261101230000_game_many_per_pair/migration.sql`
- `apps/web/prisma/schema.prisma`
- `apps/web/scripts/run-prisma-migrate-deploy.ts`
- `apps/web/src/lib/game/account-deletion.ts`
- `apps/web/src/lib/game/chat-access.ts`
- `apps/web/src/lib/game/chat-bootstrap.ts`
- `apps/web/src/lib/game/chat-delivery-authority.ts`
- `apps/web/src/lib/game/chat-delivery.ts`
- `apps/web/src/lib/game/chat-lifecycle-receipt.ts`
- `apps/web/src/lib/game/chat-lifecycle.ts`
- `apps/web/src/lib/game/chat-membership.ts`
- `apps/web/src/lib/game/chat-photo.ts`
- `apps/web/src/lib/game/chat-tool.ts`
- `apps/web/src/lib/game/contract.ts`
- `apps/web/src/lib/game/missed-check-in.ts`
- `apps/web/src/lib/game/rules.ts`
- `apps/web/src/lib/game/service.ts`
- `apps/web/src/lib/hosted-groups/prepared-thread-container.ts`
- `apps/web/src/lib/hosted-ops/app-review-game.ts`
- `apps/web/test/game-account-deletion-postgres.test.ts`
- `apps/web/test/game-cancellation-bootstrap-postgres.test.ts`
- `apps/web/test/game-chat-access-postgres.test.ts`
- `apps/web/test/game-chat-allowance-postgres.test.ts`
- `apps/web/test/game-chat-bootstrap.test.ts`
- `apps/web/test/game-chat-delivery-authority.test.ts`
- `apps/web/test/game-chat-delivery.test.ts`
- `apps/web/test/game-chat-lifecycle.test.ts`
- `apps/web/test/game-chat-membership.test.ts`
- `apps/web/test/game-chat-photo.test.ts`
- `apps/web/test/game-chat-progress-postgres.test.ts`
- `apps/web/test/game-late-recap-postgres.test.ts`
- `apps/web/test/game-missed-check-in.test.ts`
- `apps/web/test/game-negotiation-postgres.test.ts`
- `apps/web/test/game-report-block-postgres.test.ts`
- `apps/web/test/game-schema.test.ts`
- `apps/web/test/game-service-postgres.test.ts`
- `apps/web/test/hosted-prepared-thread-container.test.ts`
- `apps/web/test/hosted-runtime-owner-postgres.test.ts`
- `apps/web/test/phone-calls-game-allowance-postgres.test.ts`
- `apps/web/test/production-migration-guard.test.ts`
- `packages/assistant-engine/src/assistant-codex/dynamic-tools/games.ts`
- `packages/assistant-engine/test/assistant-codex-real-e2e.test.ts`
- `packages/assistant-engine/test/assistant-game-tools.test.ts`
- `packages/hosted-execution/src/game-chat-notifications.ts`
- `packages/hosted-execution/test/game-chat-notifications.test.ts`
Completed: 2026-11-01
