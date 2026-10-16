# Weekly Game

## Status

MVP backend implemented and dark: off in production unless
`MURPH_GAME_ENABLED=true`, and limited to the member ids in
`MURPH_GAME_MEMBER_ALLOWLIST` when that list is non-empty. Unset means on outside
production only. Members outside the gate see every game route as missing. The
iOS client is the MurphV2 prototype app.

## Product

A weekly game is a run of days between close people. Each player picks a habit
task in their own words ("100 pushups"), everyone shares a schedule (set weekdays
or any N days) and a stake ("winner gets breakfast in bed", or "for every day you
miss, you owe the other one"). Games run 7 days by default and at most 28.

The MVP is private 1v1. The challenger creates a game and texts a single-use
link (`/g/<token>`, valid 7 days) from their own phone. The invitee opens it,
signs in, and shakes on the terms they saw; a changed version is refused with
`TERMS_CHANGED`. Joining makes the game live. A person plays at most one live
game at a time; an unclaimed invite never blocks anyone.

Each player can attach a private name, photo, and relationship for the other
person. Only its owner ever sees it, in every game.

## Rules

- **Days.** Day 1 is each player's next local day after the game goes live, or
  today after Start now. A day runs 3am to 3am in the player's time zone, frozen
  when they join, so New York and Sydney play different local dates paired by
  day number.
- **Posting.** One post per day: a photo now, with video, voice, text, workout,
  and number kinds accepted by the contract. Deleting and retaking is allowed
  once per day (two posts in total, withdrawn ones included). A voice excuse for
  a missed day neither scores nor unlocks.
- **Post to unlock.** You see nothing of another player's day (media, text,
  data) until you have posted that day. Unlocking is permanent, so a withdrawn
  post can't hide what was already seen. After settle, every non-excuse entry is
  visible to the game's players. Excuse media stays private to its owner.
- **Offline grace.** In the hour after a player's 3am boundary, a post the phone
  says it captured before the boundary (monotonic capture age, with two minutes
  of slack) counts for the day that just ended, if that day has no live post and
  a post left. This is an honor rule for friends, not league evidence.
- **Settle.** When the last player's last day ends plus one hour, the game
  settles: score is scheduled days with a live post (capped at N in any-N
  games), misses are scheduled days without one (the shortfall from N in any-N
  games). The result is frozen on the game. A ten-minute cron settles due games,
  and any read of a past-due game settles it first.
- **Tickets.** "Winner gets" makes each loser owe the winner one ticket; a tie or
  an all-perfect week owes nothing. "Per miss" makes each player owe every
  better player the difference in misses. Tickets stay open until the holder
  redeems one after sending it through Messages.
- **Rematch.** A new game can name the previous one. It stays in the same
  circle, keeps stake identity, and its round number counts the circle's earlier
  settled games.
- **Term changes.** Changes apply from the first day nobody has started. MVP
  changes weekdays only; counts and stakes stay fixed for the game. No command
  exposes this yet.

## Deferred

- Groups where everyone plays everyone, and a public league of matched strangers.
- Murph as host in the group chat, with `read_game` and `update_game` tools.
- Hosted media storage. Uploads work only on local stacks today; Vercel
  deployments return `GAME_MEDIA_UNAVAILABLE` until a Worker game-media path
  exists.
- Server-side stripping of embedded location metadata from uploaded images.
- Recaps, bankruptcy, and nudges.

## Ownership

`ARCHITECTURE.md` § Weekly Game owns the storage, write path, and route
boundaries. The wire contract is `apps/web/src/lib/game/contract.ts`.
