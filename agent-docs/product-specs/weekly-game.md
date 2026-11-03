# Weekly Game

## Status

MVP backend implemented and dark: off in production unless
`MURPH_GAME_ENABLED=true`. Unset means on outside production only. A non-empty
`MURPH_GAME_MEMBER_ALLOWLIST` makes it invite only (`isGameOn` in
`apps/web/src/lib/game/access.ts`): a game is on when at least one of its people
is listed, its players or a rematch's addressee, so an open invite is on when its
creator is listed. Listed members can do everything. Anyone else can accept an
invite to a game that is on, play it fully (posts, changes, settle, tickets,
Murph's chat and pushes), see it on Home, and rematch its other player in either
direction, but can't start a fresh game (`GAME_DISABLED`); Home's
`canStartGames` says which. A game that is off is invisible to everyone. The
HTTP door admits an unlisted member only when they're in a game that is on
(settled included) or hold an open invite to one: the accept and negotiate routes
vouch with their path token, and other routes may carry the held token in the
`X-Murph-Game-Invite` header so a new invitee can load Home and set a name before
accepting. Everyone else sees every game route as missing. Removing a listed
member turns their unlisted opponents' games off, mid-game included. The iOS
client is the Murph app.

With `MURPH_GAME_REQUIRE_CURRENT_TERMS=true` (unset or anything else is off, and
off changes nothing), the HTTP door also refuses creating, accepting,
negotiating, posting, proposing a change and marking a prize done until the
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
relatives join Murph. Binding never claims seats. Unjoined people appear only as
a count in chat; they do not block text kickoff or recap.

Runner compatibility is consumer-first: deploy Web, then the Cloudflare runner.
The new runner opts in with signed `gameMultiplayer=1`; old runners remain
pair-only against new Web, and new runners retain pair behavior against old Web.
Do not enable production group admission as part of this deployment.

A group addresses one to nine recipients and admits its starter immediately.
A second acceptance activates it; until then it waits without expiry. Addressed
invitees keep their seats. Bearer joiners use separate seats, and ten total
admissions includes departures. There is no rejoin. Late joiners share the
existing calendar and can score only from their local joining day, capped by
the common schedule. The starter can edit or cancel before Day 1 begins for
any activated participant; stale joins must read the new terms before accepting.

A pre-settlement leave is silent, preserves evidence and excludes the player
from prizes, debts and new content. Leaving a waiting invitation voids it, as
does an active game falling below two remaining players. Group blocks mask content symmetrically without changing scores or
ending the game. Explicit player reports identify their subject; posts remain
counted when their reporter hides them.

Exactly one winner's prize is shared by a proper subset tied for the highest
numeric score. An all-way tie has no ticket. Eligibility and scores freeze at
settlement, after the last remaining competitor's local final day and applicable
grace. Any surviving participant eligible at settlement can mark the shared
prize done while a recipient and debtor survive. Same again copies the original
addressed audience and terms, including task-seat remapping, and is available
only to someone who both played and belongs to that audience.

### Multiplayer app contract

`contract.ts` supplies participation and eligibility, at most two latest poster
seats, size, immutable group identity, original invited count, permissions,
frozen winners and standings, ticket parties and redemption permission. Capable
rosters contain admitted players and retained departures; legacy pair rosters
keep the pending invitee placeholder. Group ticket scalar member fields are
empty strings; clients render `parties`. Player reports name `reportedMemberId`;
post reports derive their author and terms reports target the starter.

`POST /api/game/v1/games/:id/leave` and
`PUT /api/game/v1/games/:id/terms` with `{expectedTermsVersion, terms}` use the
existing locked commands. Group creation accepts transient addressed recipients,
`groupWord`, `defaultTask` and sparse invitation-seat overrides. Groups never
negotiate or use Start now. Creating with a chat container still rejects.

Open capable previews include `maxPlayers`, `group`, nullable `expiresAt` and
`dayOne`. Authenticated addressed invitees also receive `yourTask`.
`alreadyIn` is authenticated-only: joined nonstarter count, at most two own
profile names and the first named player's signed own photo. Block and report
masks apply before signing; private contact labels never enter this preview.
Home computes `canStartGroups` per request from the admission switch and member
allowlist. Both server create and join retain the admission gate.

The public Web invite page and its metadata/image renderer opt into multiplayer
without a member identity. An open group headline is "<Starter> started a
<groupWord> challenge". Its description gives the shared task, schedule and
duration, then the winner's prize. The page shows Everyone with the default
task, Days and the prize; the image uses the same headline. Neither surface
renders sparse seat overrides, authenticated preview extras, private labels or
other players' names. Pair rendering, app links and closed/cancelled copy stay
unchanged.

Group history keeps each round's roster, frozen standings and previews, plus
viewer-specific `task` and `prize` at group level. It returns at most twenty
groups with the twenty-five most recent rounds each. Pair history independently
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
link (`/g/<token>`, valid 7 days) from their own phone. The Apple association
route claims only `/recap/*` and `/g/*` for `G9DJH2XUMK.ai.withmurph.app`.
The `/g/[token]` page remains the group and pair invite fallback without the app.
Merge the invite claim only after a TestFlight build containing the murph-ios
"Open game invite links in the app" fix is available; earlier builds drop these
universal links. The page's Open in Murph
button opens `ai.withmurph.app://invite/<token>`; `MURPH_GAME_APP_URL_SCHEME`
overrides the scheme (local stacks use the Debug app's `ai.withmurph.app.dev`).
Its link preview (`/g/<token>/opengraph-image`) shows an open invite as a ticket
with the challenger's first name against "You", both tasks, the days, and the
stake, titled "<Name> challenged you"; the name the challenger typed for the
invitee is their private label and never appears, there or in the public
invite preview (`GET /api/game/v1/invites/<token>`). A used, expired, or missing
invite share-card previews as "This invite isn't available" and names nobody.
The API keeps cancellation compatible with older clients: a void game with a
`cancelled` event returns `{ status: "expired", reason: "cancelled", inviterFirstName }`.
The optional reason and inviter name are absent for real expiry. The inviter name
is included only when the cancellation actor is the inviter; other cancellations
use neutral wording. The opened web
page names the inviter for cancellation, with a neutral empty-name fallback;
terms and private invitee labels stay absent. A game's
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
`GameView.terms`; tasks lock at kickoff. Equal tasks remain two equal strings
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
  selected later date, moved forward to the first date the schedule counts, so
  Day 1 is always a scheduled day and every game has at least one. Length
  still counts calendar days from that Day 1. Empty schedules are refused at
  create. A day runs 3am to 3am in each player's own time zone,
  frozen at go-live from their profile, so day number N is the same date and
  weekday for everyone. Explicit dates remain tomorrow to 60 days out.
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
- **Post notifications.** One notifier owns two recipient-local daily slots:
  the first eligible peer artifact, then completion ("Everyone's in but you."
  or "Everyone's in."). Incomplete artifacts count as submitted; excuses do
  not. The posting actor is excluded. Simultaneous milestones consume both
  claims and send one message. Pairs always coincide and retain their existing
  generic copy and permanent-unlock wording. Claims use `GameEvent.commandKey`
  over game, recipient and the real 03:00-to-03:00 day in their frozen zone;
  legacy daily receipts consume both slots. Candidate posts participate in the
  calculation. Retakes, retries, corrections and excuses create no new slots.
  Sending happens after commit, with route/session, active participation, block,
  report, real-day and milestone rechecks. Stale or uncertain sends keep claims
  consumed. A blocked peer suppresses completion wording. No content or names
  enter pushes. Pair missed-day chat stays; groups have no missed-day producer.
- **Excuses.** An excuse explains a missed day in a few words: the phone
  transcribes the voice note on-device and sends only the transcript (1-500
  characters); no audio is uploaded or stored, and it's never replayed. It
  applies to the player's most recent past scheduled day with no photo and no
  excuse yet, never today. It neither scores nor unlocks.
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
- **Settle.** When the last player's last day ends, the game is over; it waits
  one more hour only while a player's last day can still take an offline-grace
  post. Once a player's own last day is over, their view carries `settlesAt`
  (results soon, at that expected time) and editing is off for both players: score is scheduled days with a live photo (capped at N in any-N games),
  misses are scheduled days without one (the shortfall from N in any-N games;
  N counts across the whole game, not per week). The result is frozen on the
  game. There is no timer: the first read of a finished game settles it, and so
  does either player accepting their next invite.
- **Missed-day host check-ins.** Around 9am in a player's frozen game time zone,
  after a scheduled day has closed without a post, Murph may address that player
  with one short line in the pair's already-bound group. Consecutive missed days
  share the first missed day's durable receipt, so they produce at most one turn
  per miss run. With several live games, due misses for the same date share one
  pair message naming the affected tasks and players. Repeated sweeps do not
  produce one message per game. Days off, still-open days, any-N open capacity and posts the
  player marked incomplete do not trigger it. Murph reads bounded current-room
  history and the exact pair's lore first and stays quiet when the player already
  explained the miss. This path requires the exact two-player roster, never
  discovers or creates a chat, and permits a no-reply result.
- **Hosted recap.** Settlement reserves one durable recap turn for the bound
  group. The turn reads the finished shared game, a bounded current-room
  transcript and the exact pair's lore, then calls `write_recap` with
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
  first saved recap; only the operator regeneration path below may replace it. Versioned schedules mark rest days as off, not missed. The server checks
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
  A failed or rejected turn leaves the old story visible. The normal outbox sends
  the accepted chat line plus `https://www.withmurph.ai/recap/<gameId>` to the
  game's existing group. Game API readers see the replacement on their next read;
  the public URL remains a generic app handoff.
  Pair and game locks, the roster re-read, no departed player, no block, settled
  status, rollout and room binding all apply. Runtime authority, fresh provider
  roster checks, recap validation and normal egress guards still apply downstream.
  A newer rematch is never changed. An unfinished or uncertain prior delivery
  refuses another regeneration; diagnose it through its existing lifecycle owner
  rather than changing the request id to force another send. Request events keep
  retries idempotent even after delivery receipt retention.
  Web may deploy on merge before the compatible Cloudflare runtime event reader:
  only an explicit operator execute emits the new identity. Keep operator execution
  paused until Web and the Cloudflare runtime have converged on the release.
  Ordinary recap identities remain compatible. No migration or client change is needed.
  Before rollback, stop operator requests and drain all admitted regeneration work;
  keep compatible Web and runtime readers while any remains. Accepted replacements
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
  `NOT_A_PLAYER`. When both players ask for a rematch of the same game, the
  second ask accepts the first on its terms. Otherwise it must follow the
  same rematch chain: an open rematch of that game is refused with
  `ALREADY_IN_A_GAME`, and a settled descendant makes it `REMATCH_OUTDATED`.
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
  account. The reporter can block in the same step.
- **Block.** Blocking someone ends every open or live game with them (no
  winner, nothing owed), stops Murph texting their shared chat about the game,
  and refuses invites and rematches between them either way. Each sees the
  other the way they'd see a player who left; the blocker no longer sees them
  or their past posts at all, and unblocks from Settings. Games that ended stay
  ended.
- **What can't be posted.** Money stakes, clearly dangerous tasks or dares,
  slurs and explicit sexual words are refused with "This can't be posted."

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
notification. Concurrent games reuse the pair's established room, including a
room whose first message is still being prepared. An already-bound game keeps
that room for app announcements.
Either exact same-pair room can read and discuss the same canonical game; Murph
replies where the players are talking without asking them to relink it. Extra
participants make that room ineligible. Proposal copy
names only the requested changes and asks the other player naturally. It mentions
a date only for an explicit start-date change, omitting cutoff times and routine
check-in preservation text. An
ordinary contextual agreement is enough. App proposals, including Suggest
changes on an invite, post their one model-written request right after the app
write commits; the minute sweep is recovery only. A proposal made in chat is explained by Murph in its normal reply,
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
keeps a game-funded room deliverable once the game is void. A live game cannot
be called off, so Murph
says its stakes are locked and offers shortening, rescheduling or marking days
incomplete. A request to change a live game's tasks or prize gets the same
answer once: they stay for this game, and Murph names what can still change. Chat refusals carry the server's plain rule (for example the 60-day
start limit) so Murph can give the reason and the nearest valid option.

When several games share a chat, Murph reads their IDs and task words and names
one game ID for every photo, incomplete-day correction, proposal or response.
It first keeps only the games the move can apply to: for a day correction, the
games where the speaker has a post that date; for a change, the games it would
actually change. If exactly one fits, Murph acts on it. If several fit, Murph
asks one short question naming only those games and changes nothing. Only the
speaker's own words choose a game, never whichever game came up last. Progress
is described by task; lore stays pair-owned. Kickoffs, changes, cancellations
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
they do not create more included credit. Suspension, withdrawn health-data consent, the game
feature flag and member allowlist still apply. Tasks and stakes can be negotiated only while the game is negotiating. Both
lock at kickoff (`live`), even before Day 1. Schedule and duration remain
editable from the first unstarted day, with at least one future unstarted day.
Start dates lock as soon as either player starts Day 1. These edits never
rewrite check-ins or existing tickets.

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

## Setup in a two-person chat

Either person can ask Murph to set up a game in a chat containing exactly those
two members and Murph. In a larger room it makes no game write and explains
that games are one-on-one: use a chat with just the two players and Murph, or
start in the app. The accepted message's signed sender is always the actor.

Murph gathers each person's task (or the same task for both), one prize for the
winner or dare for the loser, schedule, length and optional Day 1. It asks only
for missing choices and states the defaults: seven days, every day. App limits
apply: 3–365 days, task/stake text up to 200 characters, named weekdays or any N
days over the entire game, and a picked date tomorrow through 60 days out.
Omitting the date uses acceptance time, including the existing 03:00–20:00
start-today window and schedule alignment. Start now uses the existing mutually
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
chain rules are the app's rules, including the unlisted-player rematch exception.
New game IDs are game_ followed by at least 20 random lowercase letters and
digits, never names, dates or terms. Creation retries reuse that ID; a waiting
duplicate is not another game. Creating
a new game leaves other games alone. Ambiguous new-versus-change asks need one
clarification.

Setup and poll guidance is returned by the engine on each successful ordinary
`read_game`, alongside the existing multiple-game selection guidance. The initial
tool descriptions contain only brief triggers; recap reads do not receive setup
guidance. New-game creation never targets an existing game, and an ambiguous
new-versus-change ask is clarified even when several existing games fit.

Poll guidance owned by that read result:

> When debating a shared choice, create one native murph.poll (2–4 concrete
> options, keeping the chosen labels verbatim), then read its results before
> proposing terms from the winner; a tie
> needs a choice. Do not stack polls, poll one person’s own task or a simple
> yes/no, or repeat options after creating the poll.

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

While a live game is bound to the room, ordinary group turns maintain one
pair-owned workspace file selected by an opaque sorted-pair fingerprint. It
persists across rematches for that pair and is treated as absent for other pairs,
records dated word-for-word excuses, running bits, firsts, streaks, comebacks
and which bits Murph already used. The dedicated game-lore tool owns access and
never accepts a path or player identity; game storage does not duplicate the file. Keep it near 200 lines and trim
the oldest lines first. Turns without a live game in that room do not receive
permission to create or update game lore. Missed-day and recap turns read it
before composing, and update it only from game or conversation evidence. After
a recap save, Murph records the exact group copy as
`Chat line used: <chatLine>` alongside the bits used and facts worth retaining.

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
