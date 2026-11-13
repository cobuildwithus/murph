# Weekly Game

## Status

MVP backend implemented and dark: off in production unless
`MURPH_GAME_ENABLED=true`. Unset means on outside production only.
`isGameEnabled()` in `apps/web/src/lib/game/access.ts` is the access switch:
when on, every signed-in member can start, accept and play games. Each command
and read still checks the player's roster and content access. When off, game
routes and game content are invisible to everyone. Home retains the boolean
`canStartGames`, which follows this switch, and multiplayer Home retains
`canStartGroups`, which follows `areGameGroupsEnabled()` alone. Installed apps'
`X-Murph-Game-Invite` header is ignored. The iOS client is the Murph app.

With `MURPH_GAME_REQUIRE_CURRENT_TERMS=true` (unset or anything else is off, and
off changes nothing), the HTTP door also refuses creating, accepting,
negotiating, posting, challenging a post, proposing a change and marking a prize done until the
member's `launch.legal` grant recorded the published document versions, not
just the minimum the rest of Murph accepts (`requireCurrentTermsFor` in
`http/auth.ts`, `hasHostedConsentAtPublishedVersions` in `legal/consent.ts`). The refusal is `403 TERMS_REQUIRED`
with `details: { scope: "launch.legal", documents }`, each document carrying its
id, title, link and current version, which is what the companion consent route
(`POST /api/device-sync/companion/legal-consent`) takes. Reads, reports, blocks,
the profile, and withdrawing your own post, invite or change stay open. The app
shows Murph's Terms step, records the grant, and sends the write again. Clients
that predate the code see an ordinary refusal, so turn it on only once a build
that handles it is out. Pair moves made in Murph's chat retain that behavior. Group chat mutations
apply the same current-terms check before calling the canonical command.

Game-only members can play with the Terms grant and no health grant, without
companion admission, starter usage or a personal runtime. Only `heart_rate`
posts and `reps` posts carrying `data.heartRate` require
`launch.health-data = granted`. The canonical post mutation locks the member
before the game and reads the grant inside that transaction, so a withdrawal
committed during preparation wins. Missing and revoked grants return HTTP 403
with `HEALTH_DATA_REQUIRED`, `Allow health data to post a heart rate.`, and
`retryable: false` in the ordinary error envelope. Older clients receive an
ordinary refusal. Photos, words, routes and plain rep counts require no health
grant. Shared-room funding and the existing explicit-withdrawal restrictions
on chat and recaps stay unchanged.

### App Review demo games

The configured review member gets a fixture opponent, a settled game with an
open IOU, and a live 30-day game on Day 3 with the opponent's photo today locked.
Home checks review membership in parallel with its normal read. Only that
member refreshes the seed when there is no live game shared with the fixture
opponent whose Day 1 matches the seed's current Pacific game day minus two.
Freshness uses PostgreSQL's clock, as normal Home reads do, without development
time travel. The seed uses that same instant, with the 3 AM Pacific boundary.

The existing seed apply path rechecks freshness under the pair lock, so
concurrent Home requests create one replacement pair. Home reads again after a
refresh, including when another request refreshed after its initial read.
A block, unavailable storage or another seed failure leaves the initial Home
available and logs only an error code or name. Ordinary members never reseed.
No daily operator rerun is needed; an explicit Ops apply still always replaces
the fixture games. Rows are written directly with no push, chat, Linq or email,
and the opponent stays unreachable. Without refresh, a seed one game day old
still shows the live game on Day 4, yesterday's locked photo and the settled
IOU; there is no opponent post for today.

## Group lifecycle staging

The internal command and rules path supports `maxPlayers: 10`, behind
`MURPH_GAME_GROUPS_ENABLED`. It is off in production unless explicitly `true`;
unset means on outside production. This admission switch does not disable
existing group reads, settlement or account deletion. The released pair protocol
is unchanged. Upgraded HTTP clients send `X-Murph-Game-Multiplayer: 1`.
Without it, groups are excluded before Home, wallet and history limits, and
individual group reads, mutations and invite previews return not found.
The capability changes rendering, never legal, profile or member authorization.
Exact-group chat, composer handoff, group recaps and hosted tools are implemented
behind the same dark admission switch. See `ARCHITECTURE.md` § Exact audience
group chat for the preparation/binding/egress boundary. The create response
returns `composer: { murphPhoneNumber }` only when preparation selects that path;
the app supplies the selected people and invite link to Messages. The verified
starter’s invite message binds by exact keyed provider handles even before
relatives join Murph. Binding never claims seats. Unjoined people appear as a count in shared game state; a consenting Talk
author may be named with their submitted note. They do not block text kickoff or recap.

Runner compatibility is consumer-first: deploy Web, then the Cloudflare runner.
The new runner opts in with signed `gameMultiplayer=1`; old runners remain
pair-only against new Web, and new runners retain pair read and mutation
compatibility against old Web. Rematch egress has the additional acknowledgement
floor described below.
Do not enable production group admission as part of this deployment.

A group addresses one to nine recipients and admits its starter immediately.
A second acceptance activates it; until then it waits without expiry. Addressed
invitees keep their seats. Bearer joiners use separate seats, and ten total
admissions includes departures. There is no rejoin. Late joiners share the
existing calendar and can score only from their local joining day, capped by
the common schedule. While invited, the starter alone can edit full terms
directly. Waiting invitations retain only their latest terms and encrypted words;
version numbers still increase, so stale acceptance remains invalid. Once live,
played-day history remains available and any remaining seated player can ask for a change from the
app or bound group chat with full terms, the current terms version and a new
proposal ID. New app asks require a proven bound room for their announcement.
More than half of the remaining players must say yes, including
the proposer. Each person can answer only for themselves; their yes or no is
final for that ask. Repeating the same answer is a no-op, even after resolution.
One ask waits at a time, and only its proposer can cancel it. Unjoined invitees
and departed players do not count. A late join adds an undecided voter; a
departure clears the ask because it changes who votes. App votes and chat votes
use the same locked tally. Historical same-vote retries remain replayable.

Group changes use the pair edit delta, pending JSON and approved terms writer.
Tasks lock once Day 1 begins, the start date at the first check-in, and the prize
when the game is due. Length and weekday schedule edits start at the next
unstarted day; an any-days target locks once play starts. Start now is a majority
request available only in live groups with at least two remaining players,
before every remaining player's original Day 1 and before any check-in attempt.
Withdrawn attempts and posted history retained after account deletion still
lock it; excuses do not. The candidate is the latest remaining player's local
today, advanced to the next scheduled date, and must precede the current Day 1.
Approval revalidates that exact requested date without silently moving it.
It advances the terms and calendar without another started event or kickoff.
An agreed start date runs from the latest player's today to 60 days out and moves
Day 1 for everyone; stale joins must read the new terms before accepting.
App and chat reads expose remaining seated votes and yeses still needed.
Unjoined invitees retain invitations and cannot vote; stale acceptance must
refresh the terms version. Controls are closed for invitees and leavers.
Cancelling the game stays starter-only until the first check-in, while not due;
after that, only a unanimous call-off (below) ends a live group early.
Posted history retained after account deletion still locks cancellation. Excuses
alone keep their existing behavior: they block cancellation while present, and
removing the last excuser's account permits cancellation when no posted history remains.
Terms reports target the latest applied change's proposer, falling back to the
starter for initial terms, for both pairs and groups.

Every first vote rechecks freshness under the game lock. One transaction-level
resolution writer clears terminal asks, records `game-change-resolved:<g>:<p>`
with structural reason and tally, and reserves any notice. Reads, settlement,
acceptance, departure and retained-game account deletion use that owner too.
App proposals receive one pending announcement. A deciding app vote receives
one `change_resolved` outcome; a bound-chat reply suppresses the extra notice.
Cancelling a conversational ask outside that chat receives a cancellation
notice. Departure expires it with neutral roster-change copy, even if the game
voids, without naming the leaver or claiming the game continues. Historical
notices describe only that ask, using its canonical resolution and authorized
shared task for disambiguation, even after settlement or a later ask.

Deploy complete Web readers and writers, then the runner, then iOS. Existing
signed `gameMultiplayer=1` and `X-Murph-Game-Multiplayer: 1` remain the capability
boundaries; immutable `maxPlayers === 10` selects group rules even with two
remaining players. Old runners parse the existing pending shape but may refuse
Start now; old Web rejects unsupported requests. Missing availability means
unavailable. New resolution receipts establish the updated Web rollback floor:
forward-fix acceptance while preserving recovery. No new request operation,
status or notification response policy is needed; group admission stays dark.

A pre-settlement leave is silent, preserves evidence and excludes the player
from prizes, debts and new app content. A leaver still in the group text sees
Murph’s later shared messages and can call read_game, but cannot mutate the game.
People can also exit the text while at least two humans remain: each current
contact must resolve to an originally addressed player or bound invitee, or
match that contact's own unbound invitation key, even after registration.
Bound invitations grant only their member; their old contact keys grant nothing.
Adding anyone outside the original audience or losing a still-playing person
from the text detaches the game. Creation and Same again still require the exact
audience. Leaving a waiting invitation voids it, as does an active game falling
below two remaining players. Group blocks mask content symmetrically without
changing scores or ending the game. The game keeps its chat, and nothing is sent
there while the block stands. Waiting notices and the recap send once it lifts
if they are still current. Explicit player reports identify their subject;
posts remain counted when their reporter hides them.

Exactly one winner's prize is shared by a proper subset tied for the highest
numeric score. An all-way tie has no ticket. Eligibility and scores freeze at
settlement, after the last remaining competitor's local final day and applicable
grace. Any surviving participant eligible at settlement can mark the shared
prize done while a recipient and debtor survive. Same again copies the original
addressed audience and terms, including task-seat remapping, and is available
only to someone who both played and belongs to that audience. Scalar-only edits
inherit the latest preceding encrypted word version, so a duration or schedule
change does not prevent Same again. Changing the starter remaps assignments by
person, including private sparse overrides.

The group invitation says same game only when default task, effective individual
tasks, prize, schedule, duration and check-in kind match the previous final rules.
It states a requested new start date separately. Web sends compact comparison
facts, never the full private state. Hidden assignment changes are described as
changed individual tasks with private app review, without names or values. Fresh
invitations invent no previous game. Every person accepts only for themselves;
previous play, presence, another yes or a poll vote supplies no consent.

The comparison carries the canonical terms revision. Edits between preparation,
publication and final send make that work stale under the existing single
`game-rematch:<gameId>` owner. A date-only edit also invalidates it. An already
sent offer is different: a subsequent fresh read showing changed terms requires
Murph to explain visible differences and obtain agreement before joining. Private
assignment differences require reviewing one's own addressed app invitation.

Deploy the rematch policy readers and Web's authority acknowledgement before new
notices. Old runners reject `require_game_rematch` before generation; updated
runners refuse a rematch send when old Web omits the acknowledgement, including
rooms with only two humans. This also pauses pair rematch egress during that
incompatible window, without changing pair API bytes. Keep those compatible
readers/egress as the rollback floor. No migration or historical backfill.

### Multiplayer app contract

`contract.ts` supplies participation and eligibility, at most two latest poster
seats, size, immutable group identity, original invited count, permissions,
frozen winners and standings, ticket parties and redemption permission. Capable
rosters contain admitted players and retained departures; legacy pair rosters
keep the pending invitee placeholder. Group ticket scalar member fields are
empty strings; clients render `parties`. Player reports name `reportedMemberId`;
post reports derive their author and terms reports target the starter.

`POST /api/game/v1/games/:id/leave` and
`PUT /api/game/v1/games/:id/terms` use the existing locked commands. Invited
starter edits use `{expectedTermsVersion, terms}` and remain immediate. Live
edits also require `proposalId` and create a majority ask. Group creation accepts
transient addressed recipients, `groupWord`, `defaultTask` and sparse
invitation-seat overrides. Groups accept pre-join Talk notes without negotiating
or claiming a seat. Creating with a chat container still rejects.

The live editable terms contract now contains only the shared default and
remaining-player tasks. Clients round-trip those fields; canonical preparation
preserves hidden unjoined/departed overrides and rejects explicit writes to
hidden seats. It compares the prepared remaining member/seat set under the game
lock; a departure during preparation returns a refreshable conflict. Invited
starter editing retains broader invitation-seat authority, including removing
and restoring overrides. Link previews retain the default and authenticated
`yourTask`, never sparse overrides or private pending labels.

Start now uses `POST /api/game/v1/games/:id/changes` with
`{proposalId, expectedTermsVersion, change:{kind:"start_now"}}` when
`changeControls.canStartNow` is true. Live full-term editing uses
`changeControls.canEdit`; `permissions.canEditTerms` still means direct invited
editing. `POST /api/game/v1/games/:id/changes/:proposalId` accepts only
`{decision:"approve"|"decline"}`; path and authentication supply identity.
`DELETE` on that path cancels for the proposer. Pair votes remain chat-only.
`pendingChange` retains `id`, `proposedByMemberId`, `change`, `startsOn`,
`effectiveFromDay`, `votes` and `yesNeeded`. A remaining nonproposer with no
recorded answer may vote. Render the request as waiting until the returned game
confirms application. Delivery uses the existing pending/queued/sent/failed/
conversation statuses and retryability; conversation reserves no separate
announcement. Refresh on `CHANGE_PENDING`, `TERMS_CHANGED` or `CHANGE_EXPIRED`.

Open capable previews include `maxPlayers`, `group`, nullable `expiresAt` and
`dayOne`. Authenticated addressed invitees also receive `yourTask`.
`alreadyIn` is authenticated-only: joined nonstarter count, at most two own
profile names and the first named player's signed own photo. Block and report
masks apply before signing; private contact labels never enter this preview.
Home computes `canStartGroups` per request from the group admission switch.
Both server create and join retain the admission gate.

The public Web invite page and its metadata/image renderer opt into multiplayer
without a member identity. An open group headline is "<Starter> started a
<groupWord> challenge". Its description gives the shared task, schedule and
duration, then the winner's prize. The page shows Everyone with the default
task, Days and the prize; the image uses the same headline. Neither surface
renders sparse seat overrides, authenticated preview extras, private labels or
other players' names. Pair rendering, app links and closed/cancelled copy stay
unchanged.

Group history keeps each round's roster, frozen standings and previews, plus
the shared default `task` and `prize` from the latest round's final terms at group
level. The task is the same for every viewer, including players with a seat override.
It returns at most twenty groups with the twenty-five most recent rounds each. Pair history independently
retains its fifty-people/fifty-round limits. Each record counts the returned
rounds, following existing pair semantics. Selection limits precede hydration.

Home keeps fifty games and two hundred wallet tickets. Group cards retain every
calendar day and the viewer's own entries/status for the live film strip and
settled result card. Other players' entries/status appear only on the viewer's
current live day. Detail keeps all days and peers. Ordinary JSON responses
remain; there is no streaming, day pagination or window protocol. Home follows
the accepted full-calendar pair scaling bound. Group history is measured against
a 3 MB target at its maximum cardinality.

## Product

A weekly game is a run of days between close people. Each player picks a habit
task in their own words ("100 pushups"), everyone shares a schedule (set weekdays
or any N days) and one prize for the winner or dare for the loser. New games
run 3–365 days, defaulting to seven. Legacy one- and two-day games and their
winner/per-miss stakes remain readable and retain their settlement.

The MVP is private 1v1. The challenger creates a game and texts a single-use
link (`/g/<token>`, valid 7 days) from their own phone. The www Apple association
claims `/recap/*` and `/g/*`, so a phone with a Murph build that has the game opens
the invite in the app as a universal link; without the app the same `/g/[token]`
page opens on the Web. Builds before the game send the link to the app without
the game until they update. The page's Open in Murph
button opens `ai.withmurph.app://invite/<token>`; `MURPH_GAME_APP_URL_SCHEME`
overrides the scheme (local stacks use the Debug app's `ai.withmurph.app.dev`).
For a picked contact whose invite is not bound to a member, a one-on-one invite
stores the contact's hashed lookup key on its unbound seat, never the address.
Typed-name invites have no key. Accepting or claiming the seat through Talk it
over clears the key, as does calling off, blocking or expiring the game.
An unread expired invite keeps its key until the existing settlement path runs.
Account deletion clears keys matching the member's currently verified contacts,
including rotation read candidates, without changing contact-only invitations,
labels, seats or events. A contact match alone does not make them a participant.
Group invitation keys keep their existing lifetime.

`GET /api/game/v1/me/invite` requires a bearer session and the game switch,
like every game route, and returns `{ ok: true, token: string | null }` with private/no-store
headers. It finds the newest open one-on-one invite matching a verified contact,
ordered by creation time then id descending. Before limiting candidates to five,
it excludes games that are off, expired on the normal clock, called off, created
by the caller or a deleted challenger, already played by the caller, or blocked
either way. Development clock offsets are checked after the query. Stored live
or negotiating games with the challenger also exclude a candidate; reports do
not. The lookup never settles or writes anything, and returns null when games
are disabled or no candidate qualifies. Preview and acceptance repeat their own
checks. The app can pass the token through its existing held-invite path after
sign-in; typed-name invitations still need the original link.

Its link preview (`/g/<token>/opengraph-image`) shows an open invite as a ticket
with the challenger's first name against "You", both tasks, the days, and the
stake, titled "<Name> challenged you"; the name the challenger typed for the
invitee is their private label and never appears, there or in the public
invite preview (`GET /api/game/v1/invites/<token>`). A used, expired, or missing
invite share-card previews as "This invite isn't available" and names nobody.
Anonymous closed previews return the same null result as missing tokens, so
the public API returns the same 404 shape and the page and Open Graph image show
generic unavailable content. Closed previews never decrypt names or terms.
Authenticated readers retain used/expired status and their own Talk delivery
receipt; cancellation adds only `reason: "cancelled"`, never an inviter name.
Public open invite previews are unchanged. A game's
players keep its invite token after it goes live (a spent token can't be
accepted again), so reopening your own link is recognized as yours.
Either seated player can cancel an invited or negotiating game with
`DELETE /api/game/v1/games/:id` (no body). It returns `200 { ok: true, game }`
with the existing `GameView` in `void` status. Live or settled games refuse with
`INVITE_USED`; outsiders receive `NOT_A_PLAYER` (or `GAME_NOT_FOUND` for a
missing game). An already void game returns unchanged. The game lock covers
clearing its pending change and recording one `cancelled` event
with its actor. The pair can immediately start another invite. Home excludes
cancelled events, retaining ordinary expired invites; GameView adds no field.
If a game chat is already attached, the existing durable lifecycle sends one
brief cancellation notice there. Cancellation never creates a chat. Its pending
notice retains the bound room's existing game allowance until provider dispatch,
for at most the existing seven-day post-game access window; it grants no personal
access or extra budget. Dispatch checks the cancelled event and original pair.

Message on a live pair game texts the other player. The app asks
`GET /api/game/v1/games/:id/message-recipient` only when the player taps it,
never with Home, and gets `200 { ok: true, phone }`: the other player's
current verified number, the one Murph uses for their game chat. It's an
exchange: `phone` is null unless both players have verified numbers, and also
for a group, an invite or a finished game, a player who left or is suspended,
or a block either way.
Anyone who isn't a current player gets `GAME_NOT_FOUND`. With null, or on any
error, Messages opens with no recipient.

An invite nobody accepts expires, and stays on the challenger's Home for a week
marked expired. The invitee opens it, signs in, and shakes on the terms they saw; a
changed version is refused with `TERMS_CHANGED`. Accepting makes the game live.
Two people can have up to ten open games together. Unexpired addressed rematch
invites, unexpired negotiations and live games count; unclaimed link invites do
not count until joined. An eleventh is refused with `TOO_MANY_GAMES` (409). Each
game keeps its own schedule, days, posts, unlocks, prize, changes, recap and
rematch chain. Starting another uses the same link invite or exact-pair chat setup flow. Home returns
all games in its existing list; the client groups them by person and orders its
pager. Home lists the games waiting on you
today first, then your other live games, invites, and results.

`GET /api/game/v1/history` supplies the You tab's Games section: it groups only
settled 1v1 games by unblocked opponent, orders people and their games by newest
settlement, returns the viewer's record and score plus up to six authorized
post previews per game, and bounds both people and games per person.
Previews include words and media posts under the same visibility rules, excluding
withdrawn, hidden and viewer-reported posts. They keep day, player seat, receipt
time and entry ID order, capped at six after filtering. Words use the existing
entry shape: `kind: "words"`, empty `mediaUrls`, and the existing `text` and `data`
fields. Compatible iOS clients show words in their day-order slot; older builds
omit previews without pictures.
Each game also includes `tasks: { mine: string; theirs: string }`, oriented by
player seat, and `stake: { kind: "prize" | "dare"; item: string } | null`.
These use the final agreed terms and exactly the task and stake wording in
`GameView.terms`; tasks lock when Day 1 begins. Equal tasks remain two equal strings
so native clients can title the card as one shared task. No stake is `null`.
For legacy terms, the first stake is used: `winner_gets` maps to `prize` and
`per_miss` maps to `dare`, without changing its wording or settlement.
The additive fields reuse loaded terms and batch decryption, with no per-game
query. Older clients may ignore them. Example game fields:

```json
{
  "tasks": { "mine": "30 lunges", "theirs": "15 min walking" },
  "stake": { "kind": "prize", "item": "Lunch" }
}
```

The latest game's media previews for each person may also include `delivery` with a
five-minute signed URL for the small rendition and its ISO `expiresAt`. Keep
`mediaUrls` as cache identity; if delivery is absent or expired, request the
stable media route as usual. Signing uses the same media authorization and
never exposes hidden entries. Older games keep the stable media URLs only.
Legacy encrypted images are repaired on authorized reads through Web's existing
decryption and validated image-upload path when their source and key remain.

When inviting, the challenger can attach a private photo and relationship for
the invitee alongside the first name they typed. Only the challenger ever sees
them, in every game with that person; the photo is that player's fallback picture
in the challenger's views. The latest invite wins: a name, photo or relationship
typed for that person replaces what the challenger typed before.

A member without a game profile can silently adopt a usable single-word vault
name at native login or on Home. Explicit app name changes also submit a best-effort canonical
memory update; time-zone-only changes do not. Existing game profiles remain
authoritative. See [first-name persistence](ios-game.md#first-name-persistence)
for validation, authority, timeout and concurrent-save behavior.

Each member may also upload, replace or remove their own profile photo. It syncs
across devices and becomes their default when creating or joining a game. Inside
the app, the person's own profile photo wins, then the viewer's private contact
photo, then initials. An addressed pending invite uses the person's own profile
photo first, then the pending invite photo, then the viewer's saved contact photo.
Private photos stay stored while hidden and appear again if the person removes
their own photo. Shared recap exports use only each person's own profile photo,
never private contact overrides. Daily challenge photos remain separate.
Profile media is authenticated: the owner, existing game participants and an
addressed rematch's participants can read the current profile photo.
Public invite previews never include profile photos. A signed-in member reading
an open one-on-one invite gets the challenger's current profile photo through
optional `inviterAvatarUrl`, a short-lived signed link. Invitation, profile,
expiry, blocks and reports are rechecked before signing; no photo or unavailable
signed media returns null. Public pages and share cards keep the initial.
Removing a profile photo clears
this default without deleting other people's private contact choices.

Either player can set or change their private photo of someone they play or
played with through `PUT /api/game/v1/players/:memberId/photo` with
`{ "photoKey": "<own-finished-upload-key>" }`. The subject must have no profile
photo; otherwise the command returns `INVALID_REQUEST`. Sending
`{ "photoKey": null }` clears only the caller's private photo, even when the
subject has a profile photo, and leaves the private name and relationship alone.
Clearing an absent label is a no-op. Self-targets return `INVALID_REQUEST`;
unrelated players and blocks in either direction return `NOT_A_PLAYER`.
Uploads use the existing `MEDIA_MISSING` ownership/completion guard. Success is
HTTP 200 with `{ "ok": true, "game": null }`; normal game reads return the
resulting avatar. No private photo is shared with the subject or other players.

## Rules

- **Days.** On acceptance or negotiation approval, each player's earliest
  Day 1 is their game-local today between 03:00 inclusive and 15:00
  exclusive, otherwise their next game date. Between midnight and 03:00 that is
  the calendar date that has just begun, so a late-night start opens at 03:00.
  The cutoff applies to every player, not only the one accepting, so a game
  goes live today only while it is before 3pm for everyone. Everyone shares
  the later date, or an explicitly
  selected later date, moved forward to the first date the schedule counts, so
  Day 1 is always a scheduled day and every game has at least one. Length
  still counts calendar days from that Day 1. Empty schedules are refused at
  create. A day runs 3am to 3am in each player's own time zone,
  frozen at go-live from their profile, so day number N is the same date and
  weekday for everyone. Explicit dates at creation remain tomorrow to 60 days
  out; an agreed change can pick any date from the latest player's today.
- **Start now.** Day 1 becomes the latest "today" among the players (or the
  first scheduled date after it), so nobody's Day 1 is already over: across
  the date line the player behind starts tomorrow. It is offered only when it
  moves Day 1 earlier. Before 3am that first day is short, since it still ends at
  3am. Start now is proposed in the app and takes effect when the other player agrees in the shared chat.
- **Weekdays.** A set-weekdays game is on and off on the same dates for
  everyone, because every player's day number falls on the same date.
- **Posting.** New games allow a photo, a short line of words, a heart-rate
  graph, a route map or a rep tape each day. Legacy photo/heart-rate games
  retain their required kind. Two attempts total are allowed per day across
  kinds, including withdrawn entries. Artifacts do not verify task completion.
- **Self-reported incomplete days.** In the bound live game chat, a player can
  mark their own reached day incomplete by date. The artifact stays under the
  ordinary post-to-unlock rules, with optional `GameEntryView.incomplete: true`.
  It earns no score or streak credit and counts as unposted for settlement.
  Retakes preserve the correction. Murph can restore only an existing post
  self-marked by that speaker; no artifact means no change. Both operations
  are idempotent. Murph asks once for an ambiguous day and confirms a date or
  weekday in one plain line, without score announcements or partner claims.
  Relative dates use the acting message’s occurrence time in that player’s
  game timezone, including its 3am boundary; delayed processing cannot shift
  the chosen day. Missing or ambiguous occurrence timestamps need clarification.
- **Accept notifications.** An invite acceptance that activates a pair game sends
  the other player one push per game: "They shook on it." / "Your game starts
  today.", "tomorrow.", a weekday (2–6 days away), or a short date (7+ days away).
  Words use the written Day 1 and real calendar date in the recipient's frozen
  zone; expiry is the following date's 3am. `game_accepted` requires alerts,
  not reminders; live game, participation, blocks and route are rechecked.
  The activating accept runs once under the game lock, so no separate receipt
  is kept; a send never retries. Kickoff chat and private kickoff are unchanged.
- **Post notifications.** One notifier owns two recipient-local daily slots:
  the first eligible peer artifact, then completion ("Everyone's in but you."
  or "Everyone's in."). Incomplete artifacts count as submitted; excuses do
  not. The posting actor is excluded. Simultaneous milestones consume both
  claims and send one message. Pairs always coincide: a pair recipient who
  hasn't posted that day gets the generic "Someone posted. Share yours to see
  it."; one who already has (permanent unlock) gets "They're in too." /
  "Theirs develops when you open it.", because the app develops a post the
  first time its viewer sees it on Home. Claims use `GameEvent.commandKey`
  over game, recipient and the real 03:00-to-03:00 day in their frozen zone;
  legacy daily receipts consume both slots. Candidate posts participate in the
  calculation. Retakes, retries, corrections and excuses create no new slots.
  Sending happens after commit, with route/session, active participation, block,
  report, real-day and milestone rechecks. Stale or uncertain sends keep claims
  consumed. A blocked peer suppresses completion wording. No content or names
  enter pushes except the recipient's own task words in a daily reminder.
  Missed-day chat is separate from these push milestones.
- **Excuses.** An excuse explains a missed day in a few words (1-500
  characters). It applies to the player's most recent past scheduled day with
  no photo and no excuse yet, never today. It neither scores nor unlocks.
- **Post to unlock.** A posted partner day exposes only its posting time and
  optional device-rendered blur preview until you post that day. No words,
  summary data or entry id is exposed while locked. On the viewer's today
  only, a locked day with a picture also names it (`preview`: its kind and
  stable media link, which still answers `MEDIA_MISSING` until you post), and
  `GET /home?delivery=signed` signs that picture in, so the app can keep it
  ready, hidden, and develop it the instant your own post is in. That makes
  the lock app-enforced for today's picture only: the owner chose an instant
  reveal over a server-only lock (Nov 2026). The signing check keeps every
  other media rule (players only, no block either way, not reported, not
  withdrawn, live game). The blur stays with the
  unlocked post, for the app to show while its picture loads. Unlocking is
  permanent after a non-excuse attempt, including withdrawal. Recap reveals
  every live artifact to the game's players. Excuses remain private to their
  owner.
- **Days off.** A new post on an unscheduled game day is refused with HTTP
  409 `DAY_CLOSED`, after applying eligible scheduled-yesterday offline grace.
  Dates use the posting player's time zone and 3 AM boundary. Count schedules
  have no off days. The message names the day and next scheduled day under its
  effective terms: "Saturday's a day off. Back Monday." If the game has no
  scheduled days remaining, it says "Saturday's a day off. No game days left."
  No entry is saved and no locked artifact is created. Chat photo saves return
  the same code and message; Murph credits the effort briefly, explains the day
  off and next game day, and neither retries nor claims credit.
  The exact HTTP body is:
  ```json
  {"error":{"code":"DAY_CLOSED","message":"Saturday's a day off. Back Monday.","retryable":false}}
  ```
- **Offline grace.** In the hour after a player's 3am boundary, a photo the
  phone says it captured before the boundary (monotonic capture age, with 30
  seconds of slack) counts for the day that just ended, if that was a scheduled
  day with no live photo and a post left. Any other photo captured before the
  current day began (one the phone kept and sent later) counts for no day and
  is refused with `DAY_CLOSED`; a post without a capture age counts for today.
  This is an honor rule for friends, not league evidence.
- **Empty-slot post.** A native post may carry `expectEmptySlot: true`, meaning
  the phone saw no live post in the slot it is filling. Under the game lock,
  after same-ID replay and the ordinary day decision, a live post in that slot
  refuses the new entry with HTTP 409 `SLOT_TAKEN`. The existing post, its reply
  and the retake stay as they are. The field names no day, so capture-age
  placement is unchanged. A client that omits it keeps the older rule: a new
  entry ID replaces the live post.
- **Write outcomes.** Every native game command and board sharing save rechecks
  its exact session inside the transaction that commits it. A session revoked
  after admission returns 401 `UNAUTHENTICATED` and writes nothing. Once a
  command or upload has read its request, a server failure is not a refusal: it returns
  `retryable: true`, as `INTERNAL_ERROR` (500) or `GAME_MEDIA_UNAVAILABLE` (503),
  and the app keeps its unsent shot or reply. Same-ID replay makes that retry
  safe after a commit whose response failed. Replay requires the same entry ID,
  member and game; an entry from another game is not a successful retry.
  Malformed input, a foreign or
  genuinely missing media key, an image the store refuses and every rule refusal
  stay final.
- **Settle.** A pair ends when both remaining players have completed their last
  scheduled day, or both have reached N in any-N games. Incomplete posts do not
  decide it. The read following the last post settles under the game lock,
  freezes the result and writes tickets, the settled event and the bound room's
  recap reservation exactly once. Retakes, withdrawals, Prove it and score edits
  already refuse in the interval between that post and the settling read;
  duplicate post replays still succeed. The last post's push survives settlement.
  Trailing days off do not delay a decided pair. Groups keep their natural timing.
  Otherwise the game ends after the last player's final local day, with one more
  hour only while an offline-grace post remains possible. `settleDueAt` and
  `settlesAt` retain this natural end. Replies to posts remain open on an
  early-settled pair until that time, then close. These settled-aware push and
  reply readers are the rollback floor once early-settled rows exist.
  Score is completed scheduled days, capped at N across the whole any-N game;
  misses are scheduled days without credit, or the shortfall from N. Prizes and
  tie rules are unchanged.
  Foreground reads settle due games, including overnight reads. Background chat
  reads expire pending changes but do not settle. For chat-bound pairs nobody
  opens, the existing sharded room sweep settles at or after the latest next-day
  9am across remaining players' frozen zones. It does this before choosing the
  pair or group check-in collector, including mixed rooms and count schedules.
  Due pairs get no check-ins while awaiting morning. Unbound games still settle
  on a foreground read.
- **Missed-day host check-ins.** Around 9am in a player's frozen game time zone,
  after a scheduled day has closed without a post, Murph may address that player
  with one short line in the pair's already-bound group. Consecutive missed days
  share the first missed day's durable receipt, so they produce at most one turn
  per miss run. With several live games, due misses for the same date share one
  pair message naming the affected tasks and players. Repeated sweeps do not
  produce one message per game. Days off, still-open days, any-N open capacity and posts the
  player marked incomplete do not trigger it. Murph reads bounded current-room
  history and the exact pair's lore first and stays quiet when the player already
  explained the miss. An earlier reminder never covers a miss, so pair and group
  missed-day turns get no accepted-reminder history. This path requires the exact two-player roster, never
  discovers or creates a chat, and permits a no-reply result. A check-in that
  cannot go out within two hours of its claim is dropped, never sent late.
- **Group missed-day host check-ins.** A group game, including two-person
  turnout, uses one combined room message per first missed date. Murph names
  everyone still qualified and their missing tasks/date, warmly and with a light
  roast. Never shame, joke about bodies or weight, demand an explanation or ask
  someone else to nudge a player. No "vs.", em dashes or spaced hyphen separators.
  Murph reads remaining-player room conversation and the original audience's
  lore, omits each explained miss and stays quiet if none remain. Unjoined
  invitees and leavers can still receive the room message but are never targets;
  private task overrides for invitees, private labels, captions and media stay
  out. Lore may record room-safe facts and used bits with stable member IDs beside
  names, roughly 200 lines within the existing 64 KiB limit. IDs stay out of copy.
  The room cutoff is the latest next-day 9am among every eligible scheduled
  game/player slot in its frozen time zone, even if that person posts. The
  inclusive two-hour window starts there. Mixed rooms combine authorized pair
  and group facts from up to twenty games; pair-only timing and copy stay the
  same. Pre-join, off/open, any-N and incomplete days do not qualify. Corrected
  misses, terms or room changes, unsafe audiences and any new departure suppress
  an already-prepared message. Any conversation received since transcript capture
  also suppresses it, even unrelated chatter. Quiet and suppressed turns consume
  the daily claim; replay never creates a replacement message. Earlier historical
  departures do not stop future eligible dates. A check-in that cannot go out
  within two hours of its claim is dropped, never sent late.
- **Evening room check-ins.** At the latest local 8pm among the room's eligible
  scheduled game/player slots, Murph may ask one short question in the existing
  room naming each still-open player's own task. The half-hour window and one
  room/date claim never move earlier when someone posts; a late item is dropped.
  Pair, group and mixed rooms share this path. Each eligible game needs all its
  current players in the bound room, with known current game-profile time zones
  and a widest clock gap strictly under three hours. Bystanders may receive the
  message but are not addressed and their time zones do not gate the check-in. A player switched off for a game is not addressed.
  Murph omits only tasks their player clearly said they did, will do or will not
  do for that date, or an equivalent question already sent for that person,
  task and local date by another reminder. Statements about another day or
  task leave other open tasks eligible for the same question. A reminder or
  stated intention never counts as completion. Shared notification context uses
  bounded accepted outgoing messages from this exact room, timed in the room's
  local zone so last night's 8pm question never reads as today's; pending
  output is not evidence of a prior send.
  Three consecutive accepted scheduled evening sends without a player message
  pause future evenings until someone writes. Skips and failures do not count.
  The 90-day iMessage inactivity pause still applies. The feature is off unless
  `MURPH_GAME_EVENING_CHECK_IN_ENABLED` is exactly `true`.
- **Pair recap show.** When `MURPH_GAME_RECAP_SHOW_ENABLED=true`, the parent
  GPT-6.1 Sol turn reads retained shared material and the centralized craft guide,
  composes five to seven authored pages, generates selected scenes and an optional
  twenty-second theme song, previews and revises, then submits the finished show.
  Whole real photos use contain sizing. Zero to two “Most likely to” cards get one
  page each; the result remains canonical. The accepted delivery is exactly one
  line plus the recap link, with no chat image or audio. Groups keep the existing
  behavior below. The [presentation contract](../references/recap-show-contract.md)
  owns the stable synthetic native fixtures and media authentication.
  Failed scenes preserve readable text or whole-photo pages; missing songs are omitted.
  One normal group turn receives the authorized game, retained chat and narrative
  lore in read_game, generates files, and calls write_recap once. No separate
  sandbox, working directory, preview, frozen draft or lore acknowledgment is
  required. Pair-show acceptance checks structure, selected bytes and current
  source authority; writing preferences stay in the craft guide. An accepted
  event replays its canonical result through the existing outbox.

  Only the show-writing notification runs on OpenAI Flex. Its first attempt
  starts a twenty-minute capacity budget, retained with the generation's native
  Codex binding in an unbound assistant execution session. Flex capacity refusals
  keep that notification pending on the existing five-minute mailbox retry; the first
  attempt starting at or after twenty minutes uses standard service. If that
  standard attempt also fails for capacity, it takes the existing failed-recap
  settlement path rather than extending capacity retries. Retries resume the
  same native thread and recover an accepted story before provider work. Media
  provenance and song timing remain in per-turn host memory. After a failure,
  the next attempt cannot submit files generated by the earlier attempt and
  must regenerate the media it uses; retaining the thread does not retain media
  authority. No durable media provenance receipts are stored in the vault.
  The budget never interrupts a slow generation. Images and songs retain their
  separate provider settings, and writing keeps default prompt-cache retention.

  Non-capacity initial generation failure, or capacity failure on the standard
  fallback attempt, publishes a plain result from canonical facts.
  An interrupted initial generation also has a read-only result projection after
  the existing UI wait. Failed regeneration preserves the prior recap and assets,
  silently retires the queued generation and permits a later regeneration ID.

  Recap media funding comes from authenticated Web game authority, installed in
  the current native invocation. Model arguments and request headers cannot grant
  it. One in-memory egress counter allows six total forwarded media requests;
  forwarded failures consume the count, and a container restart may reset it.
  Bounded recap image/song requests bypass ordinary subscription/allowance vetoes.
  There are no reservations, per-kind limits, pricing estimates or recap deadlines.
  Scenes default to high quality at 1024×1536; reference exports fit 1024×1024.

  Deploy Web, then runner, with no recap turns in flight. The post-deploy contract
  migration drops hosted_runtime_owner.recap_media_scope after old Web functions
  drain; older Web cannot be restored after that drop without re-expansion.
  The presentation payload and decoder fixtures remain compatible with iOS build
  96. MURPH_GAME_RECAP_SHOW_ENABLED remains the producer flag;
  MURPH_GAME_RECAP_MEDIA_VISIBLE=false hides generated media and cover previews.
  MURPH_GAME_RECAP_MEDIA_DIR is local-test storage only. No production regeneration
  is part of implementation or local proof.

- **Hosted recap (groups and legacy pairs).** Settlement reserves one durable recap turn for the bound
  group. The turn reads the finished shared game, a bounded current-room
  transcript and the authorized game audience's lore, then calls `write_recap` with
  three to seven story pages from the fixed page kit and `chatLine`. The prompt
  requests three to six pages, opening on the tasks and prize in plain words,
  with stats only when the number itself is funny. App feedback and game
  bookkeeping are not moments; every claimed event must have game/chat evidence.
  The group `chatLine` first states that the game ended and the winner or tie
  with its score, then one specific game moment. It has no invitation to open
  the recap; the delivery line already supplies the link. Stated score pairs
  must match the canonical result. Only the opening result through its score
  is exempt from earlier-line trigram checks; the moment must still be original.
  Legacy `scoreLine` is optional and keeps its validation when present.
  The model never selects a game id: trusted notification authority
  binds the tool to the exact settled game and room, even after a rematch starts.
  A finished game can receive its first recap late. Ordinary turns preserve the
  first saved recap; only the operator regeneration path below may replace it.
  Versioned schedules mark rest days as off, not missed. Settled any-N pair
  recap material stops at the local day play ended, derived from `settledAt`
  and the game clock; blank any-N days are off, never missed. Natural endings
  retain the full game span. The server checks
  entry ownership and shared visibility, visual kinds and counts, text, quote,
  score and chat-line limits, banned language, third-person shared copy, quote
  density and verbatim player chat/post evidence. It also rejects stock chat
  lines and three-word phrase reuse from earlier `Chat line used:` lore entries,
  returning the fixed correction messages for a retry. The accepted recap is
  sealed on the game row and both players receive
  `recap: { pages, scoreLine?, chatLine, superlatives? } | null` in `GameView`. After one
  accepted `write_recap`, the runtime replaces any model-authored final copy
  with the server-returned delivery text: the sealed `chatLine`, a newline,
  then `Watch the recap: <public origin>/recap/<gameId>`. Web derives it on save
  and replay using the canonical public-origin config; the transcript and queued
  group delivery use those exact bytes. The sealed recap, `Chat line used:` lore
  and originality checks keep the bare line. `/recap/[gameId]` validates only the
  ID shape and presents a generic, noindex app handoff (`<app scheme>://recap/<gameId>`)
  for Apple mobile User-Agents, including recognizable iPadOS desktop UAs.
  Other User-Agents receive a server-rendered QR of the canonical HTTPS recap
  URL and an instruction to scan with the iPhone camera. Both views retain the
  App Store fallback and read no game data. Its app scheme shares the invite-page
  setting; no client detection or external QR service is used.
  For optional score lines, deploy compatible Web before the runtime writer.
  Web composes queued recap instructions; old runtimes still require the legacy
  line in their tool schema until their deployment.
  Existing recaps retain their score lines unchanged; new recaps may omit them.
  Keep compatible Web and runtime readers after the first omitted-line recap
  is stored, including on replay. This needs no database migration or split PR.
  Deploy the runtime response reader with the larger delivery-text bound before
  Web starts composing links; the old 160-character reader rejects long messages.
- **Recap superlatives.** Murph supplies one optional pair in the existing
  sealed recap. Each `memberId` is an exact player ID from `read_game`; the app
  maps IDs regardless of viewer orientation. The title finishes "Most likely
  to…" without repeating those heading words, uses 2–6 words, at most 80 characters, and has no trailing period. Titles
  differ case-insensitively. Each line is one short warm teasing sentence of
  1–160 characters. Grounding is limited to this game's entries and text both
  players can see: posts, words, timing, streaks, shared excuses and tasks.
  Never invent a detail, expose private context, insult, or joke about bodies
  or weight. Invalid shape, lengths, duplicate titles, duplicate/unknown IDs or
  an incomplete roster drop the whole optional field without failing the recap.
  Old recaps and fallback stories omit it; the app retains its existing rule.
  Exact additive JSON (synthetic example):
  ```json
  {"superlatives":[{"memberId":"player_first","title":"Give the mat tenure","line":"The purple mat made every appearance."},{"memberId":"player_second","title":"Recruit the laundry basket","line":"The laundry basket supervised every set."}]}
  ```
  The [iOS contract](ios-game.md) owns client mapping and wire examples.
  Deploy Web first: it accepts both shapes and returns a legacy-shaped recap
  to writers that omit superlatives, including replay of a newer saved story.
  The composed instructions request the field only when the tool supports it.
  Then deploy the runtime producer. New runtimes also require read_game's player
  IDs before producing the field. Once saved, compatible Web is the rollback
  floor; old strict Web readers cannot read these sealed records.

- **Recap UI wait.** `GameView.recapPending?: true` appears only when the game is
  settled, its recap is null, it has a bound chat, and fewer than
  `GAME_RECAP_UI_WAIT_MS` (10 minutes) have elapsed since `settledAt` on the real
  clock. The field is otherwise omitted. This limits the app's wait, not recap
  generation: late recaps remain allowed, and no recap-ready push is added.
  Older clients ignore the additive field. The companion UI ships separately.
- **Operator recap regeneration.** An authenticated, allowlisted operator may
  reserve one settled game's recap again through `POST /api/ops/game-recap`, with
  same-origin mutation protection. `scripts/ops-game-recap --game-id <GAME_ID>
  --regeneration-id <REQUEST_ID>` is a dry run; add `--execute` to reserve work.
  Sign in through `scripts/ops-feedback login`. Use the same 8–32 character
  regeneration id on every retry; a new id deliberately requests another story.
  The preview and command return only opaque ids and outcomes. They never read
  or print recap content or call a messaging provider.
  Admission records a metadata-only `game_event` and an ordinary `game_lifecycle`
  / `game_recap` receipt with `game-recap:<gameId>:<requestId>` identity. The
  existing minute sweep builds today's recap instructions and queues the normal
  hosted `read_game` / `write_recap` turn. No second queue or direct send exists.
  The old recap is retained until validation accepts a replacement; acceptance
  atomically replaces its ciphertext and records a once-only acceptance event.
  A failed or rejected turn retains the old story under the same visibility rules.
  The normal outbox sends the accepted chat line plus `https://www.withmurph.ai/recap/<gameId>` to the
  game's existing group. Game API readers see the replacement on their next read;
  the public URL remains a generic app handoff.
  Removing a post for everyone clears any stored story that may hold it in the
  removal transaction. Reads hide a stored story that may hold a post removed
  for everyone from every viewer; its ciphertext stays until a separately
  approved cleanup. No pass over existing stories runs at deploy time. The
  settled result stays and `recap: null` uses the app's existing template.
  The newest accepted generation's witness, or the original generation's witness
  when none was accepted, determines what the story may hold. Missing or malformed
  witnesses cannot rule out a removed post. Report-only suppression remains per
  viewer; legacy stories without removals and withdrawn or retaken posts alone
  do not trigger this rule. Already-sent chat lines and game lore are not cleared.
  Regeneration can restore a clean story when the existing recap rules permit it.
  Pair and game locks, the roster re-read, no departed player, no block, settled
  status, rollout and room binding all apply. Runtime authority, fresh provider
  roster checks, recap validation and normal egress guards still apply downstream.
  Stale published, unclaimed generations retire as `skipped` / `game_recap_retired`
  during takedown or the next material read or seal. After runtime authorization,
  Web answers `GAME_RECAP_GENERATION_RETIRED` before roster work, allowing the
  runner to consume the pending item without sending. Temporary roster, access,
  audience or storage failures and claimed provider work keep their uncertainty.
  A pair receipt skipped as `game_blocked` also permanently ends the generation,
  even after unblock: its room cannot be restored. A block row alone leaves an
  unskipped generation temporary. A group block keeps the room and skips no
  generation. Waiting work completes after the block lifts if still current.
  Older group receipts already skipped for a block are terminal.
  A dry run can answer `would_regenerate` for stale work without changing rows;
  execution retires it before reserving a clean generation, even without a stored
  story. Unpublished work gets its first clean witness at publication.
  A newer rematch is never changed. Any other unfinished or uncertain prior delivery
  refuses another regeneration; diagnose it through its existing lifecycle owner
  rather than changing the request id to force another send. Request events keep
  retries idempotent even after delivery receipt retention.
  The runner image with the #4653 terminal consumer must be live before this Web
  activation merges. Older runners retry the terminal item forever. Keep that
  consumer as the runner rollback floor once Web can emit retirement; no migration,
  new wire field or client change is needed.
  Before rollback, stop operator requests and drain all admitted regeneration work
  and every retired recap item, original generations included: older Web no longer
  answers the terminal value for them. Keep compatible Web and runtime readers while
  any remains. Accepted replacements
  are canonical: old ciphertext is not retained, and sent messages cannot be undone.
- **Tickets.** A prize or dare makes the loser owe the winner one ticket; a tie
  or all-perfect game owes nothing. Each ticket carries its stake kind. The
  winner marks a dare done with the same redeem action, without proof. Legacy
  "winner gets" retains winner/loser settlement. "Per miss" makes each player owe every
  better player the difference in misses. A ticket is good for 14 days: the
  holder redeems it after sending it through Messages, and after its use-by
  date it shows as expired and can't be redeemed. In dev time travel, issuance
  and expiry both use the game's shifted clock, including long games.
  Players read a ticket as a prize: the app and Murph's game texts say who
  owes whom ("Ava owes you breakfast in bed") and never ticket, bet, wager,
  winnings or cash in, and Murph's texts also avoid stake. `ticket` stays the
  model and wire name.
- **Rematch.** A new game can name a settled previous game with the same two
  available people. Its round is the previous round plus one.
  A rematch of a settled 1v1 is addressed to the other player: it appears on
  their Home ready to accept, so nobody texts a second link. When the finished
  game has a linked group chat, the rematch keeps that room and Murph posts one
  short notice there right after creation, naming the requester, whether the
  rules are the same or what changed, and the app controls to Shake or suggest
  changes. It never creates or discovers a chat for a rematch, and it drops the
  notice if the rematch is no longer invited before delivery. Only that player
  can accept or negotiate it; anyone else holding the link is refused with
  `NOT_A_PLAYER`. A rematch must follow the same chain: an open rematch of that
  game is refused with `ALREADY_IN_A_GAME`, and a settled descendant makes it
  `REMATCH_OUTDATED`. This includes the other player's open offer, whichever
  ask arrived first and even on identical terms, because asking for a rematch
  never agrees to one. The refused player reads the offer on Home and answers
  with Shake on it or Suggest changes. Repeating your own create with the same
  game id returns that game.
  Independent games and their rematches do not conflict. The pair's ten-open-game
  cap still applies, including to addressed rematches.
- **Retries.** Every action is safe to repeat: creating a game with the same id,
  posting the same entry, accepting an invite already accepted, or redeeming a
  ticket already redeemed returns the current game and changes nothing.
- **Photos.** Kept with no expiry in private Cloudflare Images. The provider
  can read/resize them; Web applies the unlock/profile rules before granting a
  five-minute signed URL (today's locked picture: the locked-preview rule above). At most 4 MiB per upload. Existing game images need
  no migration. Downloaded app-private caches remain available offline.
- **Account deletion.** A member who deletes their account leaves every game
  they're in. An open invite, negotiation or live game is called off: it
  becomes `void` with no winner, result or tickets. A finished game keeps its
  result. The other player keeps the game, their own posts and any tickets,
  and sees the leaver as a player with `left: true`, named the way they knew
  them (their own label, else the leaver's first name), with no photo or days.
  A ticket with the leaver stays visible with `left: true` and can't be marked
  done. The leaver's check-ins, labels, profile and photos are deleted; their
  seat stays as an anonymous tombstone, with each survivor's own private name
  sealed for that viewer. Any game nobody else is in is deleted (including an
  unjoined plain invite). An
  addressed rematch whose challenger left stays on its invitee's Home, called
  off.

- **Report.** A player can report any of the other player's posts they can
  see, their name and photo, or the task and prize or dare they wrote, during
  or after a game, and an invite before accepting it. Reasons: sexual content,
  harassment or bullying, hate, threats or violence, self-harm or a dangerous
  dare, money or a scam, something else, with an optional note. The reported
  post (or player's photo) is hidden from the reporter at once; it still
  counts. The reported player is never told. A person reviews every report
  within 24 hours and can take the post down, end the games, or suspend the
  account. The reporter can block in the same step. For every report kind, a
  retry recovers the stored report and its alert repeats what was accepted.
- **Block.** Blocking someone ends every open or live two-player game with them
  (no winner, nothing owed), stops Murph texting their shared chat about the game,
  and refuses invites and rematches between them either way. Each sees the
  other the way they'd see a player who left; the blocker no longer sees them
  or their past posts at all, and unblocks from Settings. Games that ended stay
  ended. A group game keeps its room and scores, stays silent during the block,
  and sends still-current waiting notices and its recap after the block lifts.
- **What can't be posted.** Money stakes, clearly dangerous tasks or dares,
  slurs and explicit sexual words are refused with "This can't be posted."

## Daily reminders

The profile owns one local reminder time (default 19:00), push on, text off;
each live seat can opt out. `setReminders` is the single write owner for Settings,
game-chat `set_reminder`, and direct `my_game_reminders`. Text can be enabled only
with the private-reminders flag, remaining AI access and usage, and an existing
deliverable direct thread. Reading settings never creates a profile or changes
Home. Tool results distinguish a saved setting from one that can reach the member
by push or text; when neither can, Murph asks them to enable notifications in the
app. Only a current game push registration with `gameReminders: true`
can receive reminders; older game registrations clear that capability, while
same-address wearable refreshes preserve it.

The minute sweep makes at most one best-effort attempt per member and local
calendar date, within 30 minutes of the profile's reminder time. Game eligibility
uses each seat's frozen zone: live, remaining, scheduled, admitted, no post or
excuse, with an attempt left. Count games remind only when outstanding credit
is positive and remaining opportunities are no greater than that shortfall,
unless that player's `reminder_every_day` choice asks for every open evening.
An earlier miss does not stop reminders; an incomplete artifact earns no credit
but still suppresses a reminder for its own day.

After claiming a member-wide `reminder_notification` event, a fresh projection
supplies only the member's open games and current own task words, including
seat overrides. The title joins those tasks with ", " and stops at 120 characters.
The body is "They posted. Share yours to see it." only for one open game with
a visible peer post today; otherwise "Still time today." Symmetric blocks and
reported posts cannot supply that peer signal. The push opens the first open
game, uses default sound and expires at the window's end. Claims never retry,
even after failure or a newly closed day.

One private evening check-in may follow an hour after the member's reminder time
on an open day, within a 30-minute window, when text is on and no room check-in
covers that game. It uses only the member's own unfinished tasks, a frozen batch
and direct-conversation watermark, and the room check-in's unanswered-evening
pause. It remains subject to the 90-day engagement pause. On activation, the
member's reminder opt-out and count-game cadence carry from a validated previous
game, then the latest same-people game if there is no lineage. An explicit choice
for the new game wins over carry-over, including a delayed activation retry.
On/off and every-day choices are independent; omitting every-day selection keeps
that field eligible for ordinary carry-over. A new person gets
one private help offer; familiar people with a changed schedule or length get
one check-in preference question; an unchanged rhythm stays quiet. The offer
waits until 09:00 local if activation is between 21:00 and 09:00 and expires
24 hours after game start. Recovery considers started live games regardless of
age, in batches of at most twenty, so delayed activation can still carry reminder
preferences after that offer expires. Recovery does not revive the expired offer.
Replies use normal direct behavior-followthrough.

## Replies

In a live, not-yet-due two-player game (`maxPlayers === 2`), a player can
leave one note on the other player's current visible post from any game day.
Photo, words, reps, heart rate and route posts qualify; excuses do not.
Groups have no Reply action. Replies give no points or completion credit.

A typed note uses the words-post validator and local content filter: trim,
one line, 1–140 UTF-16 units. A voice note is AAC in M4A, at most 400,000 raw
bytes, with one sound track and 32 integer waveform levels from 0 to 100.
Both the movie and media duration must be 1–30,500 ms; the stored duration
comes from the media header. The extra half second accommodates AAC padding.
Voice is never transcribed. Neither kind enters model input, Murph's chat,
`read_game`, assistant tools, recaps, share data, logs or telemetry.

The app's entry view carries an optional `reply` with its id, kind, creation
time and `mine`. Text replies include text; voice replies include duration
and waveform levels. Audio bytes come only from the authenticated playback
route. Opponent entries carry `canReply`; groups omit it. Reads require the
parent post to be live and visible and both players to remain present.
A block or any report between the pair, in either direction and in any game,
hides replies from both. This report rule applies only to replies; existing
post, player-photo and recap report behavior stays unchanged. Reading,
playing, deleting and reporting remain available after the game ends.

The author can delete a reply even after a block or report. Deletion is silent
and frees the post for a new reply with a new UUID. A retry using a deleted
reply's UUID never recreates it. Withdrawing, retaking or removing the parent
post deletes the reply. Deleting the game or either account also removes it.

The post gets at most one push ever: “New voice note on your post.” or
“New note on your post.” No name, duration or content enters the push. The
server rechecks visibility before its single best-effort send, with a 24-hour
expiry and no retry or reminder. A delete followed by another reply sends no
second push. Old apps ignore the new view fields; a reply push opens the app
without selecting a game until the native client supports `game_reply`.

The receiver can report an incoming reply through the existing report route.
The report targets the reply's author, leaves `entryId` null, and keeps a
reporter-owned encrypted evidence copy. Evidence survives deletion of the
reply or its author for human review. Ops removes only the reply; the post,
score and recap remain intact. The existing report alert and review commitment
apply. The reporter's account deletion removes their evidence.

App routes:

- `POST /api/game/v1/games/:id/entries/:entryId/replies`: `{replyId, kind:
  "text", text}` or `{replyId, kind: "voice", audio, levels}`. `audio` is
  base64. Mixed and unknown fields are refused; duration comes from the file.
  This route alone permits a 600 KiB JSON body and requires current Terms.
- `DELETE /api/game/v1/games/:id/replies/:replyId`: no body, author only,
  idempotent, no current-Terms gate.
- `GET /api/game/v1/games/:id/replies/:replyId/audio`: object-authorized game
  bearer access, `audio/mp4`, private/no-store, nosniff; no signed URL.
- `POST /api/game/v1/games/:id/reports`: `about: "reply"` and `replyId` with
  the existing report fields.
- `GET /api/ops/game-reports/:reportId/audio`: Ops-authenticated evidence.

Deploy the additive migration, then the complete Web backend, then the native
client. Once a reply or reply report exists, this Web release is the rollback
floor. Disable new replies with a forward fix that preserves reads, playback,
delete and report review. Privacy Policy/version changes ship separately.

## Prove it

In a live pair or group game, a remaining player can challenge another
remaining player's visible photo post. The challenger and accused must be distinct, the game must have its bound shared
chat, and canonical settlement must not yet be due. The target must be a current,
non-withdrawn photo attempt on a game day that counts, not a self-reported
incomplete day. The ordinary `visibleEntryIds` projection owns eligibility:
locked, reported and blocked content cannot be challenged. Non-photo artifacts
are outside this feature. Group app admission revalidates its bound room through
`readGroupGameChatAuthority` before spending the case; immutable `maxPlayers: 10`
selects group policy even with only two remaining players.

Each player has one Prove it per game, across all opponents. Group departure
voids cases involving that person and refunds a surviving challenger; unrelated
cases continue. An open case or a case that stood spends
it. Withdrawal or replacement voids the case and returns it. A later
`day_marked_incomplete` event by the accused for the target day concedes the case
and returns it permanently. The concession event's id must be greater than the
challenge event's id; restoring the day changes score only, never the case or
the returned budget. A restored day can have a new case on a new entry, while a
retry against the original entry remains a no-op.

A case is one Murph message in the chat, with no deadline and no effect on
score, streak or missed days. There is no photo-age cutoff. A settled, void or
canonically due game closes an unconceded case as `stood`. Explaining a post in
chat does not mutate the case or day. Only the accused's own existing
mark-incomplete path changes the day. Murph never judges a photo.

### App API

`POST /api/game/v1/games/:id/challenges` accepts JSON `{ "entryId": string }`.
The game id comes from the path and the challenger from authentication; client
actor, deadline and command-key fields have no authority. It uses the same game
access and optional current-terms gates as other writes. Success is HTTP 200
with `{ "ok": true, "game": GameView | null }`, the ordinary command envelope.
The game is the challenger's refreshed view; the nullable envelope also covers
a game removed before the response read. No separate challenge object is returned.

Errors use `{ "error": { "code": string, "message": string,
"retryable": boolean } }` and the existing HTTP statuses. A spent budget returns
HTTP 409 with code `CHALLENGE_USED`, message
`You've used your Prove it for this game.`, and `retryable: false`.
The current-terms refusal retains its existing `details` object.
After access checks, replay of the same game/entry by the same actor succeeds
before mutable eligibility or budget checks. Another actor cannot claim that
identity. A retry never reserves a second notice or re-spends returned budget.

The additive view fields are:

- `GameView.canChallenge?: boolean`: current servers emit whether this viewer
  has an unspent challenge in a live, bound, not-due pair or capable group. Entry eligibility is
  checked separately; clients must also require the opponent's unlocked photo
  and no `incomplete`.
- `GameDayView.others[].postedAt?: string`: the server's `receivedAt` as an
  ISO-8601 timestamp, now present on unlocked visible posts as well as locked
  posts. Reported, hidden, absent and withdrawn posts still omit it.
- `GameDayView.mine.postedAt?: string`: the server's `receivedAt` for your
  own post that day. The app skips the next-morning lead for a day you posted
  second before that phone started keeping looks (theirs developed as your
  capture closed on the old install), so a reinstall or a new phone doesn't
  replay a post you already watched develop.
- `GameView.recapWatched?: true`: you finished this settled game's recap, on
  any phone. `POST /api/game/v1/games/:id/recap-watched` records it (players
  of a settled game only; 409 before it settles, safe to repeat). It is stored
  as one `recap_watched` game event per seat, keyed
  `recap-watched:<gameId>:<seat>`, read back only for its own actor on home
  and game reads (not history). Nobody else sees it. The app counts a recap
  watched when its own list or the server says so, so a reinstall or a new
  phone doesn't bring back a finished game's page.

Older clients ignore the additive fields, and older responses may omit them.
The separate iOS release owns the tap reveal and confirmation. The backend
sends no case status to the app.
Report and Block keep their existing access and presentation rules.

### Chat notice and rollout

Acceptance appends one `challenged` event and reserves one `game_challenge`
lifecycle receipt in the same short database transaction. The event payload is
`{ v: 1, entryId: string }`, with the challenger in `actor`.
`game-challenge:<gameId>:<entryId>` is the command key, lifecycle event identity,
mailbox dedupe key and delivery idempotency key. The receipt stores the existing
hashed lookup key and `sourceRef: <gameId>:<entryId>`. Event ids are used only for
concession ordering, never notice identity. No migration is needed.

The drain uses `require_send` and only the game's already-bound chat. It never
discovers or creates a room for a case. One shared projection governs budget,
drain eligibility and final provider claim. A concession, retake,
withdrawal, group departure or game end supersedes pending work; a changed binding or
audience blocks dispatch. Publication and final claim share the exact-notice
validator under the game lock, after route authority. The app challenge writer
prepares and revalidates the group room before spending a case. Quiet rooms retain the existing game-notice exemption and
repeated dispatch claims the same delivery only once.

Instructions contain shared profile names, the target day's inherited task
(the shared default for groups, never a private per-seat override), day number,
and the server receipt time as weekday and clock time in the
accused's time zone (the zone itself is not named). They contain no media URLs
or keys, private contact labels, or capture-to-post gap. The notice is two or
three short lines, deadpan, uses names rather than pronouns, asks one short
question, and says the post stands unless the accused marks the day as not
counting. The situation can be funny; the
person is never the joke. No shame, insults, laughing emoji, em dashes, invented
evidence, verdicts, feature advertising or reminders.

The lifecycle-template-filter release must land first. It selects supported
templates and non-null source refs before the drain
batch limit, so an older compatible drain ignores new challenge receipts.
Deploy this Web backend before the iOS build that calls it. Hosted-runtime
schemas and tools are unchanged. This backend foundation does not yet expose a
member-facing control; the complete app release owns its public changelog entry.

The previous Web release rejects rows without `deadlineAt`. Once a new case
exists, this Web release is the rollback floor. Recover with this release or
a later compatible forward fix. Existing rows with `deadlineAt` remain readable;
the field is ignored.

## Deferred

- Groups where everyone plays everyone, and a public league of matched strangers.
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

Before Day 1, either player can propose Start now. Until anyone checks in
(any post, words or excuse), either player can propose a different start date,
even after Day 1 has begun, from the latest player's today to 60 days out. That
move rebuilds the calendar from the new Day 1 with one terms version from day
zero.
Players can also propose a new duration (3–365 days) or weekdays.
Their tap records their agreement. When the invitation is accepted, Murph
introduces the agreed challenge in one natural message and offers optional
reminders for the first few days. Acceptance never schedules reminders. Groups
use the same offer after the second acceptance activates play; other addressed
people may still join. A strictly earlier live game suppresses a later kickoff's
offer. Players 3 or more hours apart at kickoff get no offer and no mention of
reminders, because one message in their chat can't suit them all; the gap is the
widest between any two seated players' clocks at that instant. Simultaneous starts each offer, and settled games do not suppress it.
New reminder requests use the member's saved Settings through `set_reminder`;
a bare yes without a time needs that detail. One person or a majority cannot
consent for another. Earlier bounded room automations remain in force until
they expire; they save only the requesting member's exact game/member IDs, time,
timezone and bounded duration. Each occurrence requires an OK scheduled read, that exact game's live
status and the requester in its current players, then derives their name and task.
It stays quiet for ended, departed, unavailable or missing targets and never
substitutes another game. Rematch invitations do not
repeat the kickoff offer.
Murph reuses an exact existing chat with the
two players and Murph, or automatically creates one from their verified phone
numbers. When several eligible rooms exist, it prefers the most recently active
conversation, then a nonblank group name, then the newest room. Activity means
the latest accepted conversation-message receipt, not a roster refresh or system
notification. Concurrent games reuse the pair's established room, including a
room whose first message is still being prepared. An already-bound game keeps
that room for app announcements.
Either exact same-pair room can read and discuss the same canonical game; Murph
replies where the players are talking without asking them to relink it. In the
bound room, additional people do not interrupt play or announcements while all
current players remain present. They gain no player actions, and Murph does not
announce their arrival. A larger room the game is not bound to stays ineligible. Proposal copy
names only the requested changes and asks the other player naturally. It mentions
a date only for an explicit start-date change, omitting cutoff times and routine
check-in preservation text. An
ordinary contextual agreement is enough. App proposals, including Suggest
changes on an invite, schedule their one model-written request after the app
response. Talk notes and rematch announcements use the same post-response window.
The accepted command and its delivery receipt commit first; the minute sweep
recovers interrupted delivery. A proposal made in chat is explained by Murph in its normal reply,
without a duplicate announcement. The app shows it waiting for agreement, not
as a separately delivered notification. New group creation uses that same first
message, rather than a generic opener followed by another message. Initial
invite negotiation likewise introduces the actual proposal once; the challenge
kickoff follows only after agreement. The other player can decline, and the
proposer can cancel in chat. Only one proposal per game waits at a time: a player who
answers a pending proposal with a different one declines it and proposes theirs,
and Murph says in that reply that the new ask replaces the earlier one. A player
who declines and later proposes exactly the declined change in chat agrees to it:
its proposer already asked for it, so it applies at once instead of asking them
again. That holds until the next change event or until approval would refuse it;
proposals that change task or stake words always need a fresh yes. A chat
proposal carries only what the acting message asks for, never an earlier
deferred request. Cancelling an
app-origin change after it was queued or sent also tells the group that the
request is off, without cancelling the challenge or changing its agreed rules.
Unsent requests and chat-origin requests do not generate a second announcement,
and neither does a change cancellation or refused approval made from the bound
chat, where Murph's reply is the one explanation. In chat, either player can
cancel a negotiating game; the lifecycle cancellation notice is then the one
announcement (Murph does not also reply), because that reserved notice is what
keeps a game-funded room deliverable once the game is void.

A live game, pair or group, can be called off until it is due, but only when
every remaining seated player agrees. It is a chat-only change ask,
`change: { kind: "call_off" }`, made on an explicit request to end the whole
game. The asker counts as yes; a pair needs the other player's yes and a group
needs everyone left, so one no closes the ask. App proposals and app votes for
it are refused, and a declined call-off is never kept as a standing offer: the
decliner coming round later makes a new ask. It is judged against the due rule
only, so it stays available after the last day becomes too late to edit. The
deciding yes writes no new terms version; it records the applied resolution,
voids the game (no winner, tickets or recap), records one `cancelled` event with
`calledOff: true`, and reserves the same single cancellation notice, written as
an agreed call-off. Murph stays quiet after that yes. Home hides it like any
cancelled game. A retried deciding pair approval still reaches its recorded
outcome after the void. While it waits, older apps show it as a generic change.
Terms reports skip the applied call-off when naming the latest terms author.

Short of that, Murph offers shortening, rescheduling, a new prize or
dare, or marking days incomplete. A request to change tasks once Day 1 has begun
gets one answer: they stay for this game, and Murph names what can still change. Chat refusals carry the server's plain rule (for example the 60-day
start limit) so Murph can give the reason and the nearest valid option.

When several games share a chat, Murph reads their IDs and task words and names
one game ID for every photo, incomplete-day correction, proposal or response.
It first keeps only the games the move can apply to: for a day correction, the
games where the speaker has a post that date; for a change, the games it would
actually change. If exactly one fits, Murph acts on it. If several fit, Murph
asks one short question naming only those games and changes nothing. Only the
speaker's own words choose a game, never whichever game came up last. Progress
is described by task; lore stays with its game audience. Kickoffs, changes, cancellations
and recaps remain per game.

Until agreement, the current terms stay in force. Changes apply from the first
day neither player has started. Existing check-ins and missed days keep their
rules; shortening cannot remove a started day. Any-days count schedules can
change before Day 1, but their targets cannot change or convert to weekdays once
play starts. A duration extension is still available on the last active day,
but not once either player's last day is over. After play starts, a change
must leave at least one scheduled day in the rest of the game; before play, a
new schedule moves Day 1 onto its first scheduled day.
A proposal stays open across day boundaries until approval, decline, proposer
cancellation, a terms-version move, the game ending, or the moment approval
would refuse it. Approval recomputes the
first day neither player has started; earlier schedules, entries and scoring
remain unchanged. Pending `effectiveFromDay` is a zero-based preview if accepted
now, not a fixed promise. Native waiting/detail copy should say changes apply to
days that have not started when accepted, or qualify a day number with “if
accepted now”. A passed proposed start date, a length that removes a started
day, or any other change approval would now refuse expires at the next read
(or at approval), so it never blocks editing. It clears the proposal with a
`change_expired` event carrying the reason, and reserves one plain explanation through the existing lifecycle notice path
when a primary group chat is bound. Other newly invalid proposals use the same
refusal handling. The notice concerns only that request and creates no new chat.
Both players can retry a failed delivery
without adding consent or creating another proposal. A terminal delivery failure
is shown separately: its proposer can cancel the request in the app and propose
again, rather than repeatedly retrying a finished delivery.

The shared chat reads agreed terms, each player's own profile name, the
schedule, pending proposal, daily check-in status and settled results. It never receives private contact labels, profile
photos, check-in photos, excuses or invite tokens. A live two-player game grants
its eligible groups the normal included group usage allowance without granting
the players personal AI access. Duplicate rooms share the primary game allowance;
they do not create more included credit. An expanded duplicate room proves eligibility
from its own bound pair game, then derives its allowance beneficiary from the
same primary-pair selector as an exact room. Suspension, withdrawn health-data
consent and the global game switch still apply. Tasks can change, with the other player's yes, until either player's Day 1
begins, including on a live game that has not reached Day 1. The prize or dare
can change the same way until the game is due: the new one counts for the whole
game, and a stake-only change needs no future unstarted day, so it works on the
last day too. Schedule and duration remain
editable from the first unstarted day, with at least one future unstarted day.
Start dates lock once either player checks in. These edits never
rewrite check-ins or existing tickets.

Pair invite previews advertise `supportsTalk: true`; older servers omit it.
The following seat-claiming behavior is pair-only.
An invitee can choose Talk it over and send a cleaned note of 1–500 characters
instead of a concrete change. This claims their seat without accepting or
creating a pending change. Shared-word moderation checks abuse, so an objection
may mention money or an unsafe rule without proposing it.

Murph relays the note faithfully in its own words in one group message, asks the
other player what they think, and makes clear nothing has changed or been agreed.
It creates or reuses the pair's exact room. The author's game view derives
`talkDelivery` from the receipt as pending, sent or failed; other players do not
receive that field. The usual proposal, approval, cancellation and Shake on it
paths handle the rest. The original invite deadline still applies.

Group Talk uses the same `/invites/:token/negotiate` note request and nullable
command envelope. The starter's deletion does not close Talk or addressed chat
acceptance for a surviving group. An authenticated, profiled, verified addressed invitee who
holds no current or departed seat may send one cleaned, moderated note while
the game is invited or live/not due, with current terms and presence in the
bound authorized room. Token possession alone grants no speaking authority.
No seat, invitation acceptance, pending change, status or calendar is mutated.
One accepted note per actor and invitation seat, at most nine total, is permanent
quota; a new proposal ID cannot bypass it. Replaying the accepted ID verifies
event type and author and never changes the original note or spends quota again.

Capable group previews expose `supportsTalk` and `canTalk`; missing `canTalk`
means unavailable. After acceptance it is false even after failed delivery.
Only the author receives receipt-derived `talkDelivery` as pending/sent/failed,
including used and expired previews; leavers keep null/404. Anonymous readers
and other invitees get no status or note. Label the action “Send to the group”
and explain sharing before submission; joining is a separate action.

Each request has its own receipt and recovery identity. Another invitee joining
may activate the game without suppressing the note. Author joining/leaving,
changed terms, game end or author deletion suppress unsent work. Murph faithfully
paraphrases the consenting author's note by profile name and asks the group one
question. The note changes no terms and accepts no invitation; it never says
nobody has agreed or invents a counteroffer. Notices stay text-only and disclose
no private task overrides, labels, captions or media.

Deploy complete Web readers and Web-executed notice builders with group admission
off, then runner guidance and iOS. Keep `MURPH_GAME_GROUPS_ENABLED=false` through
mixed Web versions: an old sweeper recognizes `game_talk` but skips its new
compound reference. Enable only after all readers understand both formats. Once
produced, the new Web reader is the rollback floor; stop acceptance by forward
fix while retaining readers. No new hosted operation, policy discriminator or
runner capability is required. Production group admission remains dark.

An invitee can choose Suggest changes and submit concrete alternative rules
without accepting the original challenge. Both players see a negotiating game
with no countdown, posting duties or scores until the other player approves the
proposal. Decline or cancellation leaves it unstarted. Once no proposal is
pending, the claimed invitee can accept the unchanged current terms using the
normal invite accept endpoint. The challenger can keep proposing or wait; the
claimed seat and original invite deadline remain unchanged. Approval determines the
default Day 1 from that moment, or keeps an explicitly selected later date.
Resetting a proposed date to the default is explicit (`startsOn: null`), distinct
from omitting a date change. The original seven-day invite expiry also bounds
unfinished negotiation. Each negotiation counts toward the pair's ten-open-games cap.

## Setup in a game chat

Either person can ask Murph to set up a game in a chat containing exactly those
two members and Murph. A larger authorized room creates a group challenge.
Fresh creation in a two-human room remains a pair, while Same again preserves
the previous game's immutable group mode even with two humans present. The
accepted message's signed sender is always the actor. Group creation and rematch
require the original exact audience; later reads and delivery use the existing
bound-room authority with every current player present and bystanders allowed.

Murph gathers each person's task (or the same task for both), one prize for the
winner or dare for the loser, schedule, length and optional Day 1. It asks only
for missing choices and states the defaults: seven days, every day. App limits
apply: 3–365 days, task/stake text up to 200 characters, named weekdays or any N
days over the entire game, and a picked date tomorrow through 60 days out.
Omitting the date uses acceptance time, including the existing 03:00–15:00
start-today window (03:00 inclusive, 15:00 exclusive) and schedule alignment.
Before 03:00, acceptance selects the new calendar date opening at 03:00,
rather than the short remainder of the previous game day.
Start now uses the existing mutually
agreed change only when offered. New games store `checkInKind: any`.

Both players need their existing GameProfile first name and time zone. Murph
never invents either, splits a display name, or guesses a zone. `PROFILE_REQUIRED`
identifies the missing player; Murph names that person from the conversation
and asks them to add their first name and time zone in the Murph app. Private
contact names, photos and relationship labels are not shared setup options.

`update_game create` creates an ordinary two-seat `negotiating` game with no
pending change or obligations. The creator's request is their agreement.
Murph's one reply states the complete terms and asks the other player to agree;
there is no duplicate lifecycle proposal message. Their explicit agreement
uses the existing invite acceptance command (also available as Shake on it in
the app), then the existing durable kickoff. Counteroffers, response and
cancellation use the existing moves. A poll vote never starts a game. Chat moves
continue to bypass the HTTP `MURPH_GAME_REQUIRE_CURRENT_TERMS` door.

Fresh-game access, moderation, ten-open-games cap and settled same-pair rematch
chain rules are the app's rules.
New game IDs are game_ followed by at least 20 random lowercase letters and
digits, never names, dates or terms. Creation retries reuse that ID; a waiting
duplicate is not another game. Creating
a new game leaves other games alone. Ambiguous new-versus-change asks need one
clarification.

Setup and poll guidance is returned by the engine on each successful ordinary
`read_game`, alongside the existing multiple-game selection guidance. Shared setup
and the poll paragraph appear once, followed by scoped rules for every pair/group
mode present, including settled groups. Rules apply to the selected game's
maxPlayers, never the number currently seated. The initial
tool descriptions contain only brief triggers; recap reads do not receive setup
guidance. New-game creation never targets an existing game, and an ambiguous
new-versus-change ask is clarified even when several existing games fit.

Poll guidance owned by that read result:

> When debating a shared choice, create one native murph.poll (2–4 concrete
> options, keeping the chosen labels verbatim), then read its results before
> proposing terms from the winner; a tie
> needs a choice. Do not stack polls, poll one person’s own task or a simple
> yes/no, or repeat options after creating the poll.

Group setup preserves the exact task/prize wording and the same limits, random
retry-safe IDs and default-date explanation. Its invitation states complete
shared terms and requests individual agreement. Group Same again copies the
previous game first; requested changes then use the starter's invited edit.
If someone joins in between, use the existing live majority path and describe
only the returned state. Never create another game as recovery. A successful
bound-chat cancellation stays quiet in the ordinary turn; the lifecycle notice
says the earlier challenge was called off without claiming it was app-only or
had not started. The starter can cancel before any check-in while not due.

### Play again in iMessage

An addressed app rematch is visible to both players in their exact-pair chat
while its invite is open and neither player is blocked. The invitee can say yes
right here or Shake on it in the app. Chat approval uses the same join command,
terms version, addressee check, pair lock, cap and chain rules. The creator cannot
accept for the other player. A counteroffer uses the app’s negotiate command,
which claims the invitee’s seat without starting the game. Before claiming a
seat, the invitee has no decline action in the app or chat: it stays open and
the creator can call it off. The rematch notice offers yes or changes here or
in the app, without a link.

Unaddressed link invites stay app-only: they are bearer links whose invitee is
unknown until someone opens one. An addressed rematch’s existing shared shape
(status invited, one seated creator) parses under the old strict runtime reader;
no additional compatibility marker or native GameView field is needed.

### Chat setup deployment

Deploy Web before the runner that sends create or initial-terms approval.
Old runners never send those operations and retain their app handoff for initial
agreement until updated. During that window a new Web-authored rematch notice
can mention chat agreement before that room’s runner supports it; the app
remains available. Verify chat agreement after the runner rollout converges.
New ordinary game reads set the
transport-only `includePlayers: true` marker and receive two profile references
with `isSender`; the model does not author the marker. Unmarked responses keep
the old shape. The deployed `hostedGameChatStateSchema.strict()` rejects a new
`players` field, so Web-first ordering alone cannot protect older running
readers without this gate. Remove the marker and make the roster unconditional
in a later cleanup after all old readers and warm runtimes have drained.
Keep compatible Web while new senders remain active; reverting Web requires
rolling back and draining those senders first. No data migration is needed:
chat-created rows are ordinary negotiating games that the app already reads.

Existing group membership transport has member IDs, but its model projection
intentionally removes IDs and handles. Room memory forbids raw handles and is
not an identity roster. Game reads therefore own these minimal player references;
no broader membership disclosure or new native GameView field is needed.

## Progress and photos in chat

While a live game is bound to the room, ordinary turns maintain a room-vault
game-lore notebook. Pairs retain their sorted-pair key; group challenges use the
stored original audience, preserving continuity across joins, departures and
rematches without sharing with a different audience. A turn gets lore only if
at least one game is live and every returned game, of any status, has the same
key. The tool accepts neither paths nor identities. Keep dated excuses, running
bits, firsts, streaks, comebacks and used bits near 200 lines, trimming oldest
first within 64 KiB. Group notes contain only room conversation and shared game
state, never personal memory, private labels or captions and photo details not
said in the room. Person notes carry memberId beside the name because display
suffixes can change; IDs never appear in messages.

Group recaps read this lore and the bounded eligible-author transcript for running
bits and callbacks about eligible memberIds only. They share the pair recap's
dry, warm, specific voice, story arc, headlines and photos, with 3 to 7 pages
and one kind superlative per eligible person. Never feature leavers or unjoined
people, even inside another player's words, or reuse a used bit or chat line.
Group recap lore is read-only: after saving, trusted code appends only
`Chat line used: <chatLine>` from the canonical sealed/replayed recap, once and
without its delivery link. That room message uses only room conversation and
shared state, never app-only captions or photo details. Pair recap and missed-day
turns keep their existing lore writes. Group missed-day turns may also replace
their original-audience lore because they receive only room conversation and
shared state; they never merge pair notebooks or different audiences. Pair
notebooks may include app-only recap details, so ordinary and scheduled game
reads expose their fingerprint only while the room contains exactly the pair.
Pair recap and pair missed-day messages keep that private audience boundary at
final provider dispatch, including text sealed or queued before a bystander
arrives. The existing delivery retry policy owns those held messages; the app
recap stays available to its players and shared game actions remain available.
Group recap messages retain their room-public content rule. Deploy
compatible runner readers before Web emits group recap or missed-day policies.
Once new envelopes exist, keep compatible readers and final egress as the
rollback floor. Production group admission stays dark; no old lore files are
imported and no historical notifications are backfilled.

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

## Pair board current run

The app pair board derives `inARow` across this pair's visible games bound to
its selected chat. Each local date counts once only when every scheduled
obligation is credited. Use `completedEntry`, `eligibleFromDay`, and effective
`termsForDay`/`isScheduledDay`; excuses, withdrawals and incomplete attempts
never count. Dates with nothing scheduled are skipped. An unfinished current
date does not break the run until it ends at 3 AM in each game's frozen player
time zone. Receipt dates do not replace credited day indexes. Frozen game
results and winners are unchanged. A settled any-N pair creates obligations
only through the local day of `settledAt`, adjusted by its game clock offset;
its remaining blank days cannot break a run or compete with a rematch. Natural
endings and live count-mode streak behavior are unchanged. No streak is stored.

Reads admit at most 100 games and 5,000 live attempts for this calculation;
if either bound is exceeded, return null rather than a truncated streak.
The earliest scheduled Day 1 is read independently without those history caps.
The [iOS game contract](ios-game.md#pair-health-board) owns the board API.
