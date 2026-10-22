# Weekly Game

## Status

MVP backend implemented and dark: off in production unless
`MURPH_GAME_ENABLED=true`, and limited to the member ids in
`MURPH_GAME_MEMBER_ALLOWLIST` when that list is non-empty. Unset means on outside
production only. Members outside the gate see every game route as missing. The
iOS client is the Murph app.

## Product

A weekly game is a run of days between close people. Each player picks a habit
task in their own words ("100 pushups"), everyone shares a schedule (set weekdays
or any N days) and one to three stakes ("winner gets breakfast in bed", or "for
every day you miss, you owe the other one"). Games run 7 days by default and at
most 28.

The MVP is private 1v1. The challenger creates a game and texts a single-use
link (`/g/<token>`, valid 7 days) from their own phone. The page's Open in Murph
button opens `ai.withmurph.app://invite/<token>`; `MURPH_GAME_APP_URL_SCHEME`
overrides the scheme (local stacks use the Debug app's `ai.withmurph.app.dev`).
Its link preview (`/g/<token>/opengraph-image`) shows an open invite as a ticket
with the challenger's first name against "You", both tasks, the days, and the
stake, titled "<Name> challenged you"; the name the challenger typed for the
invitee is their private label and never appears, there or in the public
invite preview (`GET /api/game/v1/invites/<token>`). A used, expired, or missing
invite previews as "This invite isn't available" and names nobody. A game's
players keep its invite token after it goes live (a spent token can't be
accepted again), so reopening your own link is recognized as yours.
An invite nobody accepts expires, and stays on the challenger's Home for a week
marked expired. The invitee opens it, signs in, and shakes on the terms they saw; a
changed version is refused with `TERMS_CHANGED`. Accepting makes the game live.
A person can play several live games at once, one per opponent, but the same
two people can't have two going together. Home lists the games waiting on you
today first, then your other live games, invites, and results.

When inviting, the challenger can attach a private photo and relationship for
the invitee alongside the first name they typed. Only the challenger ever sees
them, in every game with that person; the photo is that player's picture in
the challenger's views. The latest invite wins: a name, photo or relationship
typed for that person replaces what the challenger typed before.

Each member may also upload, replace or remove their own profile photo. It syncs
across devices and becomes their default when creating or joining a game. Inside
the app, the viewer's private contact photo wins over the person's profile photo,
then initials. Shared recap exports use only each person's own profile photo,
never private contact overrides. Daily challenge photos remain separate.
Profile media is authenticated: the owner, existing game participants and an
addressed rematch's participants can read the current profile photo. Public
invite previews never include profile photos. Removing a profile photo clears
this default without deleting other people's private contact choices.

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
  3am. Start now is proposed in the app and takes effect when the other player agrees in the shared chat.
- **Weekdays.** A set-weekdays game is on and off on the same dates for
  everyone, because every player's day number falls on the same date.
- **Posting.** One check-in a day: a live-camera photo or an explicitly shared
  heart-rate graph recorded over Bluetooth from Start to Stop. Taking it back
  and recording or photographing again is allowed once per day (two attempts
  total, across both kinds, including withdrawn entries). A graph records
  heart rate, not verified repetitions or automatic task completion.
- **Post notifications.** With iPhone notification permission, another player's
  first photo or heart-rate check-in can send one push per recipient per game
  per recipient-local game day (3am to 3am in the zone frozen at go-live).
  Retakes, withdrawals and excuses do not send alerts. Offline-grace posts use
  the recipient's day at receipt for the cap. Notifications reveal only that a
  check-in was posted; names, tasks, words and images remain out of the payload.
  Players who already posted still receive the alert. Its body invites them to
  look when they have unlocked the new entry's day, or to share their own post
  when that day remains locked. Copy uses the same permanent unlock rule as
  the game reader, including after a withdrawal; an excuse does not unlock.
  Tapping opens the game with its normal post-to-unlock rules. Delivery is best
  effort: retries and uncertain provider failures never trigger another attempt
  for the same game day. Players may decline or revoke iOS alert permission.
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
- Declining or cancelling an invite; for now it simply expires.
- Server-side stripping of embedded location metadata from uploaded images.
- Recaps, bankruptcy, and nudges.

## Ownership

`ARCHITECTURE.md` § Weekly Game owns the storage, write path, and route
boundaries. The wire contract is `apps/web/src/lib/game/contract.ts`.

## Heart-rate graph artifacts

`heart_rate` entries carry exactly one rendered JPEG in the existing sealed
media store. The native app retains raw samples only in memory and sends no
sample arrays, device identity, or new health-data records. The server applies
identical owner checks, post-to-unlock, day boundaries, idempotency, attempt caps,
withdrawal and scoring to both check-in kinds. The challenge creator chooses Photo or Heart rate in setup for both players.
The versioned `terms.checkInKind` defaults to `photo` when absent; unknown
values are rejected. The posting day’s terms enforce the required kind before
an attempt is consumed. Excuses retain their existing rules.

On native Home, Start opens the wearable drawer. Stop & share ends recording
and uploads the graph; interrupted capture needs an explicit partial-share
action. Media authorization remains participant-scoped.

Apply the additive entry-constraint migration and deploy the reader/writer
before enabling native sends. Older native builds decode the unknown kind but
omit graph downloads; players need the updated app to see this artifact. The
new native reader displays both kinds in the home card, week and recap using
the full graph image. No live release is implied by this implementation.

## Changes agreed in chat

Before Day 1, either player can propose Start now or a different start date.
Players can also propose a new duration (up to 28 calendar days) or weekdays.
Their tap records their agreement. Murph reuses an exact existing chat with the
two players and Murph, or automatically creates one from their verified phone
numbers. It identifies the proposer and asks the other player naturally; an
ordinary contextual agreement is enough. The other player can decline, and the
proposer can cancel in chat. Only one proposal waits at a time.

Until agreement, the current terms stay in force. Changes apply from the first
day neither player has started. Existing check-ins and missed days keep their
rules; shortening cannot remove a started day. Any-days count schedules can
change before Day 1, but their targets cannot change or convert to weekdays once
play starts. A duration extension is still available on the last active day.
A proposal expires when its proposed effective day begins, so a late agreement
never changes a day already underway. Both players can retry a failed delivery
without adding consent or creating another proposal. A terminal delivery failure
is shown separately: its proposer can cancel the request in the app and propose
again, rather than repeatedly retrying a finished delivery.

The shared chat reads only agreed terms, each player's own profile name, the
schedule and pending proposal. It never receives private contact labels, profile
photos, check-in photos, excuses or invite tokens. A live two-player game grants
its bound group the normal included group usage allowance without granting the
players personal AI access. Suspension, withdrawn health-data consent, the game
feature flag and member allowlist still apply. Tasks and stakes remain fixed in
this first editing version.
