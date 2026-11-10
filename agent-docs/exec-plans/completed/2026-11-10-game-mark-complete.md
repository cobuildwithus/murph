# Count a missed game day on the player's word

Status: completed
Created: 2026-11-10
Updated: 2026-11-10

## Goal

A player who did their task but never posted can tell Murph in the game's chat,
and Murph counts that closed day. Before this, `restore_day` could only clear a
player's own not-done flag and answered `no_artifact` for a day with no post.

## Success criteria

- One chat operation counts a day as done: it clears the speaker's flag when the
  day has a post, and credits a closed day that never had one.
- The credit is visible to the other players and reversible by its owner.
- Score, streak, settlement, unlock, recap and current apps need no change.
- Nobody can credit another player's day, an open day, or a day outside the
  game's bound chat.

## Scope

- In scope: `update_game mark_complete`, the `credited` receipt status, the rule
  and service path, Murph's tool text, tests, and the owning docs.
- Out of scope: any app screen, a vote or approval step, a cap on credited
  days, and crediting an open day from chat.

## Constraints

- Identity comes from the accepted message; the model never names a player.
- Runtime and Web deploy separately, so the request and response contracts must
  stay readable in both directions during skew.
- No schema migration and no new view field.

## Risks and mitigations

1. Risk: a player credits days they did not do.
   Mitigation: games already run on the players' word (a same-day words post is
   accepted in any-kind games). The credit is a visible words post that says it
   was counted late, and the request happens in the shared chat. Games that
   require a photo or heart rate refuse it.
2. Risk: an older runtime receives a receipt status it cannot parse.
   Mitigation: only the new operation returns `credited`, and only the new
   runtime sends that operation. `restore_day` keeps its exact old behavior.
3. Risk: a wrong date silently credits the wrong missed day.
   Mitigation: the receipt is distinct from `restored`, so Murph names the day
   it counted, and `mark_incomplete` takes it back.

## Tasks

1. Accept `mark_complete` and `credited` in the shared tool contract.
2. Extend `decideDayCompletion` with the credit rule; write the words entry and
   one `day_credited` event under the game lock.
3. Offer Murph `mark_complete` in place of `restore_day`; update selection
   guidance.
4. Rules, PostgreSQL, contract and tool tests; focused real-Codex journeys.
5. Update `ARCHITECTURE.md` and `agent-docs/product-specs/ios-game.md`.

## Decisions

- The credit is an ordinary attempt-1 `words` entry with fixed server text, not
  a new column, kind or view field. Everything that already reads posts treats
  it correctly, and rollback is safe because it is ordinary data.
- One operation for the model. `mark_complete` does both jobs so Murph never has
  to choose between restoring and crediting; the server decides from the day.
- Self-serve, no approval step. This matches `mark_incomplete` and the existing
  honor rule; an approval flow can be added later if players abuse it.
- Closed days only. An open day is still the player's to post, which keeps
  post-to-unlock for the current day.
- A day whose post was withdrawn or removed is not creditable, so a moderation
  removal cannot be undone by word.
- No post push: the request and Murph's answer are already in the game's chat.
- ReviewGPT plan review skipped: this is one operation on an existing command,
  not a new architecture. The PR still gets the final review it is eligible for.

## Verification

- `pnpm --dir apps/web test test/game-rules.test.ts test/game-chat-tool.test.ts test/hosted-group-tool.test.ts test/game-command.test.ts`
- PostgreSQL: `game-day-incomplete-postgres`, `game-selfplay-postgres`,
  `game-service-postgres`, `game-groups-postgres` against an isolated
  `murph_test_*` database.
- `packages/hosted-execution` `game-tools-compatibility`; `packages/assistant-engine`
  game tool, planning, input-contract tests; `apps/cloudflare` game tool skew
  and transport tests.
- Typecheck for Web, assistant-engine and hosted-execution; `pnpm complexity:diff`.
- Real-Codex journeys: count on explicit ask, count from a plain claim, refuse
  another player's day, restore a self-marked day.
- Full provider-input measurement at base and head.

## Progress

- Implemented as planned in PR 4777; no schema, view or app change was needed.
- Rules, command, contract, tool, skew and transport tests pass. PostgreSQL
  proof passes on an isolated database: 262 cases across the four game suites.
- Five real-Codex journeys reviewed Ready on gpt-6.1-sol with local subscription
  auth: count on an explicit ask, count from a plain claim, refuse another
  player's day, restore a self-marked day, and the four-games selection case.
- Provider input: group +400 bytes (164620 to 165020, +0.243%). The individual
  +52 bytes is the measurement harness's known head-only line.
- Changelog entry added for 2026-11-10. Final ReviewGPT and exact-head CI run on
  the PR; their outcome is recorded there.
Completed: 2026-11-10
