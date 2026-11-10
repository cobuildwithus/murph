# Counted game day: the post is the player's own words

Status: completed
Created: 2026-11-10
Updated: 2026-11-10

## Goal

A day counted late through `update_game mark_complete` shows what its player
chose to say. Murph asks for the words; neither Murph nor the server writes
them. This replaces the fixed server line from the first version in PR 4777,
at the owner's request before merge.

## Success criteria

- No write happens until the player has given words for the post.
- The saved text is the player's line, under the same one-line, 140-character
  and moderation rules as any written check-in.
- A day that cannot be counted is refused before anyone is asked for words.
- Request and response contracts stay readable in both directions during skew.

## Scope

- In scope: optional `text` on `mark_complete`, the `words_needed` receipt
  status, rule and service path, Murph's tool text, tests and owning docs.
- Out of scope: any app screen, an approval step, a cap on counted days.

## Decisions

- Two calls, one operation. `mark_complete` without `text` checks eligibility
  and answers `words_needed` with no write; with `text` it writes the post.
  Murph never needs a separate eligibility tool, and a refusal still comes
  first.
- The words are parsed by the existing `oneLineWords` and moderated as `words`
  through `gameCommandTexts`, so there is no second text rule.
- A player may give the words in the same message as the request; Murph then
  counts the day in one turn.
- `GAME_CREDITED_DAY_TEXT` is deleted. Nothing was deployed with it.
- ReviewGPT plan review skipped: one optional field and one status on an
  operation that has not shipped.

## Verification

- Web rules, command, moderation, chat tool and hosted group tool tests.
- PostgreSQL day-correction, self-play, service and groups suites on an
  isolated `murph_test_*` database.
- Shared contract and assistant-engine tool tests; typechecks;
  `pnpm complexity:diff`; docs drift.
- Real-Codex journeys: ask for words on an explicit request and on a plain
  claim, post words given in the same message, post the answer to Murph's
  question, refuse another player's day, restore a self-marked day.
- Provider-input measurement at base and head.

## Progress

- Implemented in PR 4777 on top of the first version.
- Web game tests pass (441 cases across rules, command, moderation, chat tool,
  hosted group tool and changelog). PostgreSQL proof passes on an isolated
  database: 260 cases across the four game suites.
- Shared contract (32), assistant-engine tool tests (238) and the Cloudflare
  game tests (50) pass; typechecks, complexity and docs drift are clean.
- Six real-Codex journeys reviewed Ready on gpt-6.1-sol with local subscription
  auth: Murph asks one question for the words on an explicit request and on a
  plain claim, posts words given in the same message unchanged, posts the
  answer to its own question for the right day, refuses another player's day
  without a write, and restores a self-marked day.
- Provider input: group +1167 bytes (164620 to 165787, +0.709%) for the whole
  PR. The individual +52 bytes is the measurement harness's known head-only
  line.
Completed: 2026-11-10
