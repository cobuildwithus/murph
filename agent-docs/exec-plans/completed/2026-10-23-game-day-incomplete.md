# Self-reported incomplete game days

Status: completed
Created: 2026-10-23
Updated: 2026-10-23

## Outcome and invariant

A player can correct their own reached day in the bound live game through chat. The artifact remains, but score, streak and settlement exclude it. Only a previously self-marked post can be restored. Identity comes from the accepted message, never a model-selected player.

## Ownership and evidence

Game rules currently equate live posts with credit. Existing game-entry storage, game-row locking, metadata events, shared chat tools and viewer projections own the change. A nullable entry flag avoids replaying an unbounded event history. Entry existence still owns permanent post-to-unlock.

## Decisions

- Add nullable `game_entry.incomplete`; expose only `GameEntryView.incomplete?: true`. Mirror the contract in the shared integration directory.
- Extend `update_game` with mark_incomplete/restore_day and an explicit date, no actor selector. Enforce the bound chat and live/reached-day rules under the game lock. Return a bounded date/outcome receipt only for new operations.
- Retakes preserve the day flag; restore clears it across that day’s attempts. No artifact means no mutation.
- New requests are runtime-produced, so deploy Web consumer before runtime producer. Old runtime responses remain unchanged in shape. Additive nullable migration precedes Web.
- Expiry notices are investigation only unless the existing path makes implementation trivial.

## Product UX

Entry: an explicit correction in the game group. Confirm one date or weekday in one plain line; ask once for an ambiguous date. Cover mark, repeated mark, restore, no artifact, other-player request, future day, settled game and wrong room. No score announcement, partner claim, new button or completion without posting.

## Proof and release

1. Rules and view proof for score, streak, settlement and visibility.
2. Local Postgres proof for authorization, reached days, no artifact, undo and idempotency; migration guard proof.
3. Deterministic tool contracts and focused real-Codex journeys, including truthful prose; full provider-input comparison.
4. Relevant typechecks/lint plus complexity, logs and docs guards.
5. Parent candidate review, requested Codex deep review, ReviewGPT eragon concurrent with exact-head CI.
6. Scoped wrapper commits and plan closure, merge after gates, Web admission/health/exact SHA followed by protected murph-cloud runtime rollout and convergence.

## Progress

- Isolated branch created; iOS contract and shared status published.

- Focused rules, views, command, bridge, Postgres and migration tests pass. Legacy runtime skew proof passes; existing response shapes remain parseable.
- Five real-Codex journeys pass on gpt-6.1-sol with local subscription auth: mark, restore, no artifact and ambiguous date. Replies reviewed Ready; other-player refusal also passes with zero tool calls.
- Full provider-input measurement: individual unchanged at 155921 bytes; group 143888 to 145362 (+1474, +1.0244%). Exact tokenizer unavailable.
- Web, assistant-engine and hosted-execution typechecks pass. Complexity has zero hotspots; logs/docs guards and Web lint pass.
- Expiry has no announcement. A reliable notice spans lifecycle reservation, dispatch/recovery and authority paths, so it is deferred.
- Candidate deep review is running. External review, exact-head CI, merge and production rollout remain release gates tracked in the PR and shared status.
Completed: 2026-10-23
