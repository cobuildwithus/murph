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
or any N days) and one prize for the winner or dare for the loser. New games
run 3–365 days, defaulting to seven. Legacy one- and two-day games and their
winner/per-miss stakes remain readable and retain their settlement.

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

- **Days.** On acceptance or negotiation approval, the accepting player's
  earliest Day 1 is their game-local today between 03:00 inclusive and 20:00
  exclusive, otherwise their next game date. The other player's earliest is
  their own game-local today. Everyone shares the later date, or an explicitly
  selected later date. A day runs 3am to 3am in each player's own time zone,
  frozen at go-live from their profile, so day number N is the same date and
  weekday for everyone. Explicit dates remain tomorrow to 60 days out.
- **Start now.** Day 1 becomes the latest "today" among the players, so
  nobody's Day 1 is already over: across the date line the player behind
  starts tomorrow. Before 3am that first day is short, since it still ends at
  3am. Start now is proposed in the app and takes effect when the other player agrees in the shared chat.
- **Weekdays.** A set-weekdays game is on and off on the same dates for
  everyone, because every player's day number falls on the same date.
- **Posting.** New games allow a photo, a short line of words, a heart-rate
  graph, a route map or a rep tape each day. Legacy photo/heart-rate games
  retain their required kind. Two attempts total are allowed per day across
  kinds, including withdrawn entries. Artifacts do not verify task completion.
- **Post notifications.** With iPhone notification permission, another player's
  first non-excuse check-in can send one push per recipient per game
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
- **Post to unlock.** A posted partner day exposes only its posting time and
  optional device-rendered blur preview until you post that day. No media,
  words or summary data is exposed while locked. Unlocking is permanent after
  a non-excuse attempt, including withdrawal. Recap reveals every live artifact
  to the game's players. Excuses remain private to their owner.
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
- **Tickets.** A prize or dare makes the loser owe the winner one ticket; a tie
  or all-perfect game owes nothing. Each ticket carries its stake kind. The
  winner marks a dare done with the same redeem action, without proof. Legacy
  "winner gets" retains winner/loser settlement. "Per miss" makes each player owe every
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
- **Photos.** Kept with no expiry in private Cloudflare Images. The provider
  can read/resize them; Web applies the unlock/profile rules before granting a
  five-minute signed URL. At most 4 MiB per upload. Existing game images need
  no migration. Downloaded app-private caches remain available offline.
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

## Daily artifacts

New games store `terms.checkInKind: "any"`; retained missing values mean photo.
Only legacy photo/heart-rate terms enforce a single kind. Photo uploads remain
1–4 JPEG/HEIC images with optional text. Words are a trimmed single line of
1–140 characters, without media or summary data.

Heart-rate, route and rep entries each carry exactly one device-rendered JPEG.
Heart-rate data contains only integer duration, average, low and peak bpm.
Routes contain walk/run, distance in meters and duration in seconds, without
coordinates. Rep tapes contain pushup count, optional count bounds and timings,
at most 300 timestamp/depth pairs, and an optional heart-rate summary. Unknown
summary fields are rejected, including nested samples and coordinates.

Summary data is sealed per poster in `game_entry.payload_encrypted` before the
write transaction and decrypted only for entries visible to the viewer. Views
return it as `GameEntryView.data`; words remain in `text`. Optional device blur
strings (at most 64 characters) are stored separately, so locked previews never
require payload decryption. Chat and push receive no artifact data or blur.

The additive v1 migration and compatible runtime readers must precede these
writers. Existing entries with no payload remain readable with null data. Retained
heart-rate-only games also accept image-only posts and retries from older clients;
new any-kind games require the heart-rate summary.
Native clients render and capture artifacts; there is no server map or dare bank.

## Changes agreed in chat

Before Day 1, either player can propose Start now or a different start date.
Players can also propose a new duration (3–365 days) or weekdays.
Their tap records their agreement. When the invitation is accepted, Murph
introduces the agreed challenge in one natural message and offers optional
reminders for the first few days. Acceptance never schedules reminders.
Murph reuses an exact existing chat with the
two players and Murph, or automatically creates one from their verified phone
numbers. When several eligible rooms exist, it prefers the most recently active
conversation, then a nonblank group name, then the newest room. Activity means
the latest accepted conversation-message receipt, not a roster refresh or system
notification. An already-bound game keeps that room for app announcements.
Either exact same-pair room can read and discuss the same canonical game; Murph
replies where the players are talking without asking them to relink it. Extra
participants make that room ineligible. Proposal copy
names only the requested changes and asks the other player naturally. It mentions
a date only for an explicit start-date change, omitting cutoff times and routine
check-in preservation text. An
ordinary contextual agreement is enough. App proposals get one model-written
request. A proposal made in chat is explained by Murph in its normal reply,
without a duplicate announcement. The app shows it waiting for agreement, not
as a separately delivered notification. New group creation uses that same first
message, rather than a generic opener followed by another message. Initial
invite negotiation likewise introduces the actual proposal once; the challenge
kickoff follows only after agreement. The other player can decline, and the
proposer can cancel in chat. Only one proposal waits at a time. Cancelling an
app-origin change after it was queued or sent also tells the group that the
request is off, without cancelling the challenge or changing its agreed rules.
Unsent requests and chat-origin requests do not generate a second announcement.

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

The shared chat reads agreed terms, each player's own profile name, the
schedule, pending proposal, daily check-in status and settled results. It never receives private contact labels, profile
photos, check-in photos, excuses or invite tokens. A live two-player game grants
its eligible groups the normal included group usage allowance without granting
the players personal AI access. Duplicate rooms share the primary game allowance;
they do not create more included credit. Suspension, withdrawn health-data consent, the game
feature flag and member allowlist still apply. Tasks and stakes can be negotiated only while the game is negotiating. Both
lock at kickoff (`live`), even before Day 1. Schedule and duration remain
editable from the first unstarted day, with at least one future unstarted day.
Start dates lock as soon as either player starts Day 1. These edits never
rewrite check-ins or existing tickets.

An invitee can choose Suggest changes and submit concrete alternative rules
without accepting the original challenge. Both players see a negotiating game
with no countdown, posting duties or scores until the other player approves the
proposal. Decline or cancellation leaves it unstarted. Approval determines the
default Day 1 from that moment, or keeps an explicitly selected later date.
Resetting a proposed date to the default is explicit (`startsOn: null`), distinct
from omitting a date change. The original seven-day invite expiry also bounds
unfinished negotiation. A pair cannot reserve another game while negotiating.

## Progress and photos in chat

The verified two-player group may read daily check-in status, totals and recent
settled results. These are shared metadata, not a bypass of post-to-unlock:
photos, captions, excuses and private contact labels never enter this read.
A due current day is not a miss; the offline grace window remains open. Any-days
blank dates are simply not posted, with the total target reported separately.
Shared reads settle due games through the same locked path as app reads and
return the frozen scores and owed tickets.

In iMessage, a player can explicitly ask Murph to use one received JPEG or HEIC
photo as their current-day check-in. This deliberately extends the app's
live-camera honor rule to user-submitted chat photos. It does not verify the
activity, read camera capture time, backdate a post or satisfy a heart-rate
challenge. The server resolves both the current requester and original photo
sender. Only their own photo in the same room and current game day qualifies.
An offer remembers the accepted attachment identity without fetching it. Only
a consented save refreshes its temporary provider download URL and imports bytes.
The usual two attempts, replacement, scoring and post notifications still apply.
An existing post needs explicit replacement consent before consuming the retake.

When a clear contextual photo relates to the sender's task and they have no
current post, Murph may introduce this option once per person across games.
Ordinary unrelated photos and conversation between people remain quiet. The
member-owned game profile records the introduction attempt and exact pending
photo selection; the question is model-authored, and recording the attempt does
not claim it was delivered. Optional failed introductions are not replayed.
A yes saves only that selected photo, not future photos. The offer expires in
30 minutes or at the game-day boundary, whichever comes first. A no dismisses
it. Explicit later save requests remain available. Unsupported, expired or
unavailable media requires resending a supported photo or checking in in the app.


## Derived app fields

Each player view includes their current streak of consecutive scheduled days
with a live non-excuse entry. Off days are skipped; an unposted current day does
not break the streak. Home exposes the member's most recent live non-excuse
entry kind across games as `me.usualKind`, or null before their first post.
Chat progress includes at most fourteen recent day statuses per player and
retains whole-game score and target totals.
