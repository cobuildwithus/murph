# Prepare game collections without changing pair behavior

Status: completed
Created: 2026-11-02
Updated: 2026-11-02

## Outcome and invariants

PR 1 prepares bounded collection handling while retaining released pair admission,
wire output, schedules, settlement, notification policy and database schema.
The existing command, rule, service and projection owners remain authoritative.

## Evidence and design

The service removes a blocked opponent from RuleState before rendering. Replace
that derived state with hidden-member/entry sets at the projection boundary.
The rules and views repeatedly scan all entries per player/day. One local index
preserves source order, live-post selection, withdrawn unlocks and retake counts.
Shared roster helpers own bounded set comparison and free-seat selection; named
pair checks retain public admission, negotiation and legacy output policies.
Task, result and ticket aliases remain in the existing views owner.

## Tasks

1. Centralize collection helpers and preserve pair hash bytes.
2. Keep canonical state intact through service hydration and viewer projection.
3. Add collection, visibility and bounded-work proof without changing existing expectations.
4. Run focused game suites, Web typecheck/lint, complexity review and diff checks.
5. Review and commit locally with the requested co-author trailer; no push or PR.

## Failure and compatibility

No persistence, protocol, provider, scheduling or notification change. No new
transaction, query, dependency or durable state. Ordinary rollback remains safe.
Pair blocks still end games; group admission, deletion, group settlement, capable
API output, group notifications and chat rollout belong to later PRs.

## Verification

All existing test files and expectations are unchanged. Focused proof passed:

```sh
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/murph_test_group_games_pr1 pnpm --dir apps/web prisma:migrate:deploy
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/murph_test_group_games_pr1 MURPH_TEST_POSTGRES_CONCURRENCY=1 pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage --no-file-parallelism apps/web/test/game*.test.ts apps/web/test/game*.test.tsx apps/web/test/ops-game-recap.test.ts apps/web/test/hosted-ops-app-review-game.test.ts apps/web/test/hosted-ops-app-review-game-postgres.test.ts apps/web/test/hosted-ops-game-reports-route.test.ts apps/web/test/phone-calls-game-allowance-postgres.test.ts
pnpm --dir apps/web typecheck
pnpm --dir apps/web lint
pnpm complexity:diff
pnpm docs:drift
pnpm docs:gardening
git diff --check
```

- Isolated local database: all 267 existing migrations and schema contract passed.
- Game proof: 48 files, 820 tests passed, no skips (70.01 seconds).
- Web typecheck passed. Lint passed with 81 existing warnings.
- Complexity passed: 16 source files, zero functions over 20; source maximum 20.
- Documentation drift and gardening checks passed (zero gardening issues).
- The isolated test database was removed after verification.
- Initial seven-suite smoke passed 157 tests. An intermediate full run found two
  authored syntax errors before seven files could load; those were corrected,
  and the complete commands above were rerun successfully.
- New tests cover 2/3/10-member sets, duplicate/overflow rejection, exact pair
  fingerprint bytes, seat gaps, entry credit/unlock/retake equivalence, complete
  void/settled pair projection equivalence, multiple hidden members and reports,
  unseated viewers, and work bounds at 10,950 entry rows.
- Existing PostgreSQL history query/decryption bounds pass unchanged. No added
  queries, transactions, provider calls or decryption work. Rules remain canonical
  across hidden-member projections; tickets apply masking in one view owner.
- Parent review confirmed no schema, migration, HTTP or assistant protocol change.
  No model journey was needed: prompts, tool schema and pair tool output are unchanged.
- Authored-content privacy scan passed; existing test files have no diff.
- This task is local-only; no push, PR, external ReviewGPT or CI was requested.

No changelog: this is an internal refactor with unchanged member behavior.

## Retained pair guards and policies

All paths below are under `apps/web/src/lib/game/`. The shared
`roster.isPairRoster` checks cardinality; `chat-membership.sameGamePlayers`
adds exact identity-set equality. Neither admits a group.

| Owner | Retained guards | Reason |
| --- | --- | --- |
| `command.ts` | `parseChangedTasks` two-item bound and seats 0/1 | Released terms-change input. |
| `rules.ts`, `service.ts` | `GAME_SEATS_1V1`, `decideNewTerms`, `toRuleStateGame`; `decideJoin` full-seat admission | Production creation and join stay two-player. |
| `rules.ts`, `changes.ts` | `decideNegotiationStart`, `gameChangeControls` | Pair agreement and one approver. |
| `chat-membership.ts` | `sameGamePlayers`, `readGameChatPlayerIds`, `gamePairWhere`, `addressedGameRematchWhere`, `readGameChatCandidateIds`, `readPairGameChatTx`, `requireExactGameChat` (roster and phones), `isExactGameChat`, `findExistingGameChat` (input and candidate) | Exact pair discovery, binding, verified phones and provider audience; three-row overflow sentinels remain. |
| `service.ts` | `runGameChatUpdate`, `gameChatTermsCommand`, `runLocked`, `chatCreationOther`, `isGameCreationReplay` | Chat creation, actor, task and mutation authority. |
| `service.ts` | `readGameRematchNotice` (requested, rematch and prior rosters), `readGameChatState` (input, candidates and current rows), `readGameRecapMaterial`, `sealGameRecap` (input and locked rows) | Shared content and recap must belong to the current exact pair. |
| `chat-tool.ts` | `handleGameChatTool` (fresh roster and photo authority), `authorizeGameChatActorTx` (expected roster and count), `handleGameRecapTool` (initial and fresh roster), `areGamePlayersAllowed` | Accepted-sender and runtime-bound pair authority. |
| `chat-bootstrap.ts` | `frozenBootstrapSchema.to.length(2)`, `handleGameChatBootstrapControl`, `samePlayers`, `samePhones`, `bootstrapEventCurrent`, `readPlayerPhones` (eligible count and unique phones), `finishBootstrap`, `reconcileFrozenGameChatBootstrap` | Released pair bootstrap receipts and exact audience recovery. |
| `chat-delivery.ts` | `deliverGameChangeProposal`, `prepareGameChatPlayers` (eligible count and unique phones) | Two-person proposal audience. |
| `chat-delivery-authority.ts` | `assertGameRecapDeliveryCurrentTx`, `assertGameMissedDeliveryCurrentTx`, `assertGameChangeProposalDeliveryCurrentTx` (count and set), `assertGameRematchDeliveryCurrentTx`, `assertGameCancelledDeliveryCurrentTx`, `assertGameChangeResolvedDeliveryCurrentTx`, `assertGameStartedDeliveryCurrentTx` | Final dispatch must retain exact pair authority. |
| `chat-lifecycle.ts` | `isCurrentGameChatLifecycle`, `deliverGameMissedDayLifecycle`, `deliverCurrentGameChatLifecycle` phones | Pair lifecycle validity and delivery policy. |
| `chat-lifecycle-receipt.ts` | `reserveGameMissedDayTx` | Existing pair missed-day receipt and lock. |
| `chat-access.ts` | `readGameChatFundingRooms` SQL count-two and pair-member lookup | Released pair-only room funding. |
| `recap-regeneration.ts` | `requestGameRecapRegeneration` before and under locks | Pair recap regeneration authority. |
| `recap.ts` | `validateChatLine`, `validateScoreLine`, `withValidGameSuperlatives` | Released two-score wording and two-superlative contract. |
| `post-notification.ts` | `claimGamePostNotification` | Existing one-opponent notification cadence. |
| `service.ts`, `views.ts` | `readHistory` SQL count-two, `buildGameHistoryView` | Released history groups by one opponent. |

Related pair policies intentionally remain: `legacyPairStakeTickets` keeps unique
winners, perfect-game exemption and legacy per-miss tickets; blocks end the pair's
games; deletion retains one survivor; addressed rematches reconstruct creator plus
invitee; pair locks take two identities. The two-attempt retake rule, photo-pair
layout size and JSON version numbers are unrelated to player capacity.

## Later PRs

Persistence/capacity, invitations, stable seats and deletion belong to PR 2;
N-player admission, late joins, leave, group blocks and shared settlement to PR 3;
capable HTTP/media/history projections and two-slot notifications to PR 4;
group chat/composer, funding and recap protocol to PR 5; storage cleanup and
release proof to PR 6. No speculative adapters or group engine were introduced.
Completed: 2026-11-02
