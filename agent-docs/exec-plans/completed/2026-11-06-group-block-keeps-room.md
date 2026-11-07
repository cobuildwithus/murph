# Keep a group game in its room through a block

Status: completed
Created: 2026-11-06
Updated: 2026-11-06

## Outcome

A block between two group players no longer detaches the game from its room. Pair games are called off, unbound and skipped exactly as before. A group game keeps its binding and receipts, stays silent while the block stands, and sends anything still current once it lifts.

## Reaches

`blockMember` limits the unbind to pair games. Group authority reads the block once. `readGroupGameNoticeAuthority` throws a retryable `blocked` refusal at the four notice sites, so talk and challenge wait instead of reading the block as stale. Commands, views and tools keep the null answer. `game_blocked` is now written only for pair games, so the terminal recap rule no longer reads the game.

## Proof and tasks

1. Capture a fixed pair scenario on the base, twice, and require identical dumps.
2. Write the group proofs first and confirm they fail for the expected reason.
3. Change the unbind, the notice authority and the terminal rule, then rerun the group, pair, talk, recap, missed-day and delivery suites.
4. Compare the pair dump on the head, and confirm pair mutants change it.

## Constraints and risks

Web only. No schema, runner, wire or funding change. Group missed-day check-ins stay as they are: an unsafe audience suppresses them and they drop after two hours. A notice already at the provider claim keeps the outbox attempt limit. A recap in a room funded only by its game needs the unblock inside the seven-day settled window. A group game detached before this change stays detached, because admission is dark.

## Verification

Real PostgreSQL proofs pass for the attached game, intact receipts, talk and challenge through a block, a block landing during publication and between authority reads, real staleness under a block, the recap in all three timing windows, and a pair beside a group. Pair dumps on the base and head are byte-identical.
Completed: 2026-11-06
