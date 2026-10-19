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
or any N days) and one to three stakes ("winner gets breakfast in bed", or "for
every day you miss, you owe the other one"). Games run 7 days by default and at
most 28.

The MVP is private 1v1. The challenger creates a game and texts a single-use
link (`/g/<token>`, valid 7 days) from their own phone; an invite nobody accepts
expires, and stays on the challenger's Home for a week marked expired. The invitee opens it, signs in, and shakes on the terms they saw; a
changed version is refused with `TERMS_CHANGED`. Accepting makes the game live.
A person can play several live games at once, one per opponent, but the same
two people can't have two going together. Home lists the games waiting on you
today first, then your other live games, invites, and results.

When inviting, the challenger can attach a private photo and relationship for
the invitee alongside the first name they typed. Only the challenger ever sees
them, in every game with that person; the photo is that player's picture in
the challenger's views. The latest invite wins: a name, photo or relationship
typed for that person replaces what the challenger typed before. There are no
public profile photos.

## Rules

- **Days.** Everyone shares one Day 1 calendar date: the next local day after
  the game goes live for whichever player is furthest ahead (Sydney before New
  York), or the challenger's picked start date (tomorrow to 60 days out in
  their zone) if that's later. A day runs 3am to 3am in each player's own time
  zone, frozen at go-live from their profile, so day number N is the same date
  and weekday for everyone, each in their own zone.
- **Start now.** Day 1 becomes the latest "today" among the players, so
  nobody's Day 1 is already over: across the date line the player behind
  starts tomorrow. Before 3am that first day is short, since it still ends at
  3am. Start now is a dev tool today.
- **Weekdays.** A set-weekdays game is on and off on the same dates for
  everyone, because every player's day number falls on the same date.
- **Posting.** One photo a day. Taking it back and retaking is allowed once per
  day (two photos in total, withdrawn ones included).
- **Excuses.** An excuse explains a missed day in a few words: the phone
  transcribes the voice note on-device and sends only the transcript (1-500
  characters); no audio is uploaded or stored, and it's never replayed. It
  applies to the player's most recent past scheduled day with no photo and no
  excuse yet, never today. It neither scores nor unlocks.
- **Post to unlock.** You see nothing of another player's day (photo or words)
  until you have posted that day. Unlocking is permanent, so a withdrawn photo
  can't hide what was already seen. After settle, every live photo is visible to
  the game's players. Excuses stay private to their owner.
- **Offline grace.** In the hour after a player's 3am boundary, a photo the
  phone says it captured before the boundary (monotonic capture age, with 30
  seconds of slack) counts for the day that just ended, if that was a scheduled
  day with no live photo and a post left. Any other photo captured before the
  current day began (one the phone kept and sent later) counts for no day and
  is refused with `DAY_CLOSED`; a post without a capture age counts for today.
  This is an honor rule for friends, not league evidence.
- **Settle.** When the last player's last day ends plus one hour, the game is
  over: score is scheduled days with a live photo (capped at N in any-N games),
  misses are scheduled days without one (the shortfall from N in any-N games;
  N counts across the whole game, not per week). The result is frozen on the
  game. There is no timer: the first read of a finished game settles it, and so
  does either player accepting their next invite.
- **Tickets.** "Winner gets" makes each loser owe the winner one ticket; a tie or
  an all-perfect week owes nothing. "Per miss" makes each player owe every
  better player the difference in misses. A ticket is good for 14 days: the
  holder redeems it after sending it through Messages, and after its use-by
  date it shows as expired and can't be redeemed.
- **Rematch.** A new game can name the previous one. After a settled game with
  the same two people, its round is the previous round plus one; otherwise 1.
  A rematch of a settled 1v1 is addressed to the other player: it appears on
  their Home ready to accept, so nobody texts a second link. It must follow
  the pair's newest game: it's refused while they have a game going or an open
  rematch between them (`ALREADY_IN_A_GAME`), and when a later game between
  them has already settled (`REMATCH_OUTDATED`).
- **Retries.** Every action is safe to repeat: creating a game with the same id,
  posting the same entry, accepting an invite already accepted, or redeeming a
  ticket already redeemed returns the current game and changes nothing.
- **Photos.** Kept with no expiry, sealed under the uploader's key; only the
  game's players can see them, by the unlock rule. At most 4 MiB each.
- **Account deletion.** Deleting an account deletes the games that person
  created, the tickets they owe, and every photo they uploaded. Acceptable
  while the data is disposable; revisit before real users.

## Deferred

- Groups where everyone plays everyone, and a public league of matched strangers.
- Murph as host in the group chat, with `read_game` and `update_game` tools,
  including mid-game term changes (from the first day nobody has started).
- Declining or cancelling an invite; for now it simply expires.
- Server-side stripping of embedded location metadata from uploaded images.
- Recaps, bankruptcy, and nudges.

## Ownership

`ARCHITECTURE.md` § Weekly Game owns the storage, write path, and route
boundaries. The wire contract is `apps/web/src/lib/game/contract.ts`.
