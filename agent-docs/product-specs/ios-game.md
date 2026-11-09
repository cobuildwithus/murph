# iOS game contract

The canonical wire types live in `apps/web/src/lib/game/contract.ts`.
The [weekly-game spec](weekly-game.md) owns rules, authority and delivery.

## First-name persistence

Home's response shape stays unchanged. The app shows name entry only when
`me.firstName` is null. If `game_profile` is absent, the server may silently
adopt the saved vault name; it never prefills the name screen. Existing profiles
cause no replica or hosted-control calls. The optional lookup runs alongside
Home reads and has one 1.5-second deadline, including browser-session creation.
It loads only the replica core shard and requires browser-vault member authority
before reading, then current native-session and member authority inside the
transaction that creates the row. Free invitees can still play without vault
access or consent.

Adoption requires `displayName` with no whitespace, a saved vault time zone in
`meals.timeZone`, and the ordinary `setProfile` parser and moderation checks.
A longer name is never split into a guessed first name. Missing, invalid,
unavailable, refused or timed-out reads leave the ordinary null-name Home
response and create no row. The server inserts with duplicate skipping and
re-reads, so a concurrent app save wins. Adoption sends no vault action. The
existing app behavior corrects the initial vault zone to the phone's zone.

Native login tries the same adoption first, so the read happens under the login
screen's loading state instead of a blank Home. It runs only after `otp/verify`
has committed the session, never before the code is proven, because a profile
row is visible to other players' game setup. It uses the phone's time zone, so a
member without a saved vault zone can still be adopted. The read has 2 seconds
and the whole step one 2.5-second deadline, including loading the game code. A
replica parse already running can finish past it; it is synchronous, so the
timer waits for it. A member with a profile stops at one lookup. Nothing in this step can fail the
login or change its response. Home's lookup stays as the fallback for members
already signed in and for logins that missed.

An explicit profile save also submits `display-name.set` after saving the game
row, only for a first save or a changed name. A same-name time-zone update and
updates that omit the name submit nothing. Each name change gets a fresh action
UUID, including a change back to an earlier name. Names beyond memory's
120-character limit still obey the game's 200-character limit and save only to
the game profile. A refused or failed vault submission never fails the app save.

Deploy the package/runtime consumer before this Web behavior. Older shipped app
builds benefit without an iOS change; Numbers and Meals never return the name.

## Group change requests

Opt in with `X-Murph-Game-Multiplayer: 1`; immutable `maxPlayers === 10` selects
group behavior, including two remaining players. Missing controls mean unavailable.
Invited starter edits remain immediate. Live `changeControls.canEdit` enables
`PUT /api/game/v1/games/:id/terms` with
`{proposalId, expectedTermsVersion, terms}`. `permissions.canEditTerms` continues
to mean direct invited editing. Live editable terms now expose only the default
and remaining-player tasks: return those fields; Web preserves hidden overrides
and rejects explicit hidden-seat changes. Invited editing retains broader seats.

When `changeControls.canStartNow` is true, send
`POST /api/game/v1/games/:id/changes` with
`{proposalId, expectedTermsVersion, change:{kind:"start_now"}}`. It requests an
earlier scheduled Day 1 and does not activate an invited game or accept invitees.
Render `pendingChange.startsOn` as requested until the game confirms application.
The pending card retains `id`, `proposedByMemberId`, `change`, `effectiveFromDay`,
`votes:[{memberId,vote:"yes"|"no"}]` and `yesNeeded`.

Remaining nonproposers without a recorded answer can use
`POST /api/game/v1/games/:id/changes/:proposalId` with
`{decision:"approve"|"decline"}`. The proposer's yes already counts; every
person's first answer is final. Only the proposer can `DELETE` the same path.
Pairs keep chat-only approval. Authentication and paths supply actor and IDs.
Use the returned game or refresh it; `CHANGE_PENDING`, `TERMS_CHANGED` and
`CHANGE_EXPIRED` are refreshable conflicts. After approval refresh terms version,
start date and player calendars; late acceptance uses that fresh terms version.

App asks require a proven existing room and reserve one announcement. Display
existing `deliveryStatus` and `deliveryRetryable`; `conversation` means the chat
reply owns the announcement. A deciding app vote receives one outcome notice.
Deploy Web, then runner, then this UI while group admission stays dark. Updated
Web resolution-receipt readers form the rollback floor once receipts exist.

## Group Prove it and Talk

Send `X-Murph-Game-Multiplayer: 1`; pair responses retain their existing bytes.
For immutable `maxPlayers: 10`, Prove it uses the existing
`POST /games/:id/challenges` `{entryId}` and `{ok:true, game:GameView|null}`.
Offer it only with `canChallenge`, another remaining player's unlocked photo,
no incomplete flag and no challenge badge. Server eligibility remains final.
Visible entries, including the accused's own, carry `challenge: {status:
"open"|"stood", deadlineAt, byYou}`. Preserve `409 CHALLENGE_USED`; refresh
stale cases. Only the accused's accepted chat message can mark their day
incomplete with `update_game mark_incomplete`; `restore_day` restores score
without undoing the concession. No app concession route is added.

Authenticated group invite previews include optional `canTalk`; absence means
unavailable. Submit the existing `/invites/:token/negotiate` request with
`{proposalId, termsVersion, timeZone, note}` and reuse its ID on retry. Success
may contain `game:null`; refresh the invitation, without entering joined-player
state. “Send to the group” must explain note/name sharing before submission.
Joining stays separate. Only the author receives optional `talkDelivery` as
pending, sent or failed, including minimal used/expired previews. A leaver still
receives null/404. Once accepted, `canTalk` stays false even after terminal failure;
a fresh ID never grants another note. Anonymous and other-invitee previews carry
no status or note. These additions are group-only; pair fields are unchanged.

## Off-day entry refusal

`POST /api/game/v1/games/:id/entries` returns HTTP 409:

```json
{"error":{"code":"DAY_CLOSED","message":"Saturday's a day off. Back Monday.","retryable":false}}
```

Display the server message; do not retry or create a local successful post.
The server uses the player's time zone and 3 AM game-day boundary. Eligible
captures from scheduled yesterday retain their existing one-hour grace.
Count-mode schedules have no off days. The next day follows effective schedule
versions. When no scheduled day remains in this game, the message is
"Saturday's a day off. No game days left." Existing historical off-day entries
retain their scoring and visibility rules.

## Pair game ending and recap wait

A pair settles on the read after both players complete the last scheduled day
or reach N in an any-N game. Incomplete posts leave it open. Results and tickets
can therefore arrive before the natural end or the hosted recap. Retake,
withdrawal, Prove it and score edits close as soon as the pair is decided;
duplicate post retries still succeed. The last post's push still arrives.
Group timing is unchanged.

Replies remain available until `settleDueAt`, the original natural end including
applicable offline grace, even while the pair is settled. `settlesAt` keeps its
existing natural-time meaning. Foreground reads settle due games; background
chat reads do not. Without a foreground read, the room sweep settles due pairs
at or after 9am following the last day in the latest remaining player's frozen
zone, including count schedules and mixed rooms. Due pairs get no check-ins.

`GameView` adds `recapPending?: true`. It is present only for a settled,
chat-bound game with a null recap during the first 10 minutes after `settledAt`.
Use it to hold Watch while showing the result. Its absence is not a generation
failure or deadline: a late recap can still replace the fallback, and the card
and chat link must still open it. No recap-ready push is sent. Older clients
ignore the field; the native UI implementation ships separately.

Settled any-N pair board streaks stop creating obligations on the local day play
ended, so later blank days do not break a run or conflict with a rematch. Recap
material stops there too and never calls a blank any-N day missed. Natural
endings and live count-mode streak behavior remain unchanged.

## Recap superlatives

`GameView.recap` remains nullable. Its existing `pages`, optional `scoreLine`
and `chatLine` are unchanged. It may additionally contain:

```json
{
  "superlatives": [
    {
      "memberId": "player_first",
      "title": "Give the mat tenure",
      "line": "The purple mat made every appearance."
    },
    {
      "memberId": "player_second",
      "title": "Recruit the laundry basket",
      "line": "The laundry basket supervised every set."
    }
  ]
}
```

Map each entry by `memberId`, never array position or viewer orientation.
Render the title after "Most likely to…" and its sentence beneath it. The title
omits those heading words.
The server accepts exactly one entry per player, two distinct titles,
2–6 words and at most 80 characters per title with no trailing period, and
1–160 characters per line. Titles are compared after trimming and case-folding.
An invalid pair is omitted as a whole; it never prevents the story being saved.
Older recaps and fallback stories have no field. Use the existing app rule when
it is absent, and ignore unknown fields for forward compatibility.

Murph grounds these lines only in game entries and text both players can see:
their posts, words, timing, streaks, shared excuses and tasks. Copy is warm and
teasing, never mean, about bodies or weight, or based on private context.
No client migration or recap backfill is required.

## Pair health board

`GET /api/game/v1/people/:memberId/board` uses the game bearer door. Both
people must hold seats in a visible live or settled pair game, without a block.
The latest game's actual chat binding selects one HostedGroup. Missing binding
or group returns `{ "board": null }`. `MURPH_GAME_BOARD_ENABLED` is on unless
exactly `false`; off returns that empty GET and 404 for sharing PUT.

`PairBoard` and numeric wire types live in
`apps/web/src/lib/game/board-numbers.ts`. The response is `{ board }`, with
`groupId`, the viewer's nullable `membershipId`, canonical `firstGameOn`,
viewer-local inclusive 90-day `window: { from, through }`, `myShares`, two
`people` (viewer first), and `crowns`. No names or avatars are returned.
Each person has `memberId`, `me`, sharing-group `member`, nullable `inARow`,
and four `numbers`, always in this order:

| Name | Scope | Unit | Improvement |
| --- | --- | --- | --- |
| `restingHeartRate` | `resting-heart-rate-days.v0` | bpm | decrease |
| `sleep` | `sleep-duration-days.v0` | minutes | increase |
| `steps` | `steps-days.v0` | steps | increase |
| `vo2Max` | `vo2-max-days.v0` | ml/kg/min | increase |

A number is `{ state: "not_shared" | "hidden" }`,
`{ state: "pending", reason?: "no_readings" }`, or
`{ state: "available", unit, source?, latest: { date, value }, stale, daily, comparison }`.
`source` is the selected series' public key and is omitted for an empty key.
The other person (never `me`) may also carry `demographics: { biologicalSex,
ageFrom }`, from a currently readable resting-heart-rate or VO2-max grant, so
their drawer can rank them for their age; conflicting snapshot groups omit it.
Daily points are ascending, one per date, with gaps omitted. Daily values round
to integers except VO2 (one decimal); window means retain their precision.
`stale` means the latest date precedes `window.through` by more than seven days,
except VO2 uses its catalog freshness limit (45 days). A readable grant with
zero usable readings returns pending with `reason: "no_readings"`; unreadable
or legacy publications remain plain pending. The state vocabulary stays fixed
for shipped clients, which ignore the additive reason key. A viewer outside the sharing
group sees the other person's numbers as hidden and may intentionally enroll.
Both people's numbers come only from the same authorized shared snapshots.

Each metric selects one public source for both windows, preferring sufficient
coverage, then more distinct dates across the windows, later latest date, and
source id. Never fill gaps from another source. Unknown-source legacy values
can display but cannot support comparison. Explicit naps do not count as sleep.
A 0-step row is not a reading: a worn device can hold 0 for days it reported no
steps, so zeros leave the baseline, the current week and `daily`. Steps first
prefer a worn device with four real days in the seven ending on the steps
cutoff, even when only a merged total has a comparison, so a merged total never
stands in for the device. Shared records name the public source, not the
`sourceType` that daily steps selection reads, so the board treats
`apple-health`, `apple-health-kit`, `google-fit`, `google-health`,
`health-connect`, `samsung-health`, `manual` and `murph` as not worn. Daily
steps selection's rule that a device under half of the merged total came off
does not apply here; the board stays one source at a time.

Comparisons read up to 180 retained dates. Only the baseline reaches past
`window`: `daily`, `latest` and `window` stay at 90 days, and a source with no
reading inside `window` has no row. Daily comparisons need four dates in each
window. The baseline is the 60 days before `firstGameOn`, clipped to retention,
when they hold four dates; otherwise it is the seven days from the first reading
on or after `firstGameOn`. The current week is the seven days ending on the
source's latest date, never starting before `firstGameOn`, so a pre-game baseline
can compare from the fourth reading. Overlap gives null, so a first-week baseline
has no comparison until its thirteenth day after the first reading. VO2 uses its
existing median/two-date policy with the same pre-game window and a 14-day
current window; its first-week baseline is up to 90 days, clipped before that
window. `comparison` contains `baseline` and `current`, each
`{ from, through, value, days }`, plus raw `delta`, direction-adjusted
`improvement`, and `sinceFirstGame`. The latter is true for a pre-game baseline
or one starting on `firstGameOn`, and false otherwise, when the app names
`baseline.from` instead. `firstGameOn` itself is never clipped or inferred from
capped history. Crowns name the unique largest positive improvement (or positive
streak); ties and all-nonpositive values give null. They are recomputed, not
stored holders.

Steps alone use the last settled day (the viewer-local date eight hours ago,
minus one day) as their cutoff and stale reference, so daily values, latest,
comparisons and crowns exclude unsettled days while the window start and
top-level response window stay unchanged.

`PUT /api/game/v1/people/:memberId/board/sharing` takes
`{ expectedMembershipId: string | null, numbers: MetricName[] }` and returns a
fresh `{ board }`. Null means an intentional first join, authorized by a current
pair seat and prepared exact chat evidence revalidated at mutation. Existing
members retain self-service sharing authority. Only these four scopes are
replaced; other permissions survive. Stale membership gives
`409 MEMBERSHIP_CHANGED`; missing current consent uses the existing
`403 HOSTED_CONSENT_REQUIRED`; unavailable boards give 404. Saves may return
pending values until the existing publisher runs. All responses are no-store.


## Reminder settings and push capability

`GET /api/game/v1/me/reminders` uses game bearer auth and returns
`{ok:true, minutes:1140, push:true, text:false, canText:false, offGameIds:[]}`.
`PUT` at the same path replaces `{minutes, push, text, offGameIds}` and returns
the same shape. Minutes must be an integer from 0 through 1439; text must be
false until text reminders ship. Off IDs affect only the caller's live seats;
unknown or foreign IDs are ignored and omitted live seats turn back on.
Home's shape is unchanged.

`POST /api/game/v1/push-route` additionally accepts optional boolean
`gameReminders`. Send true only from a build with reminder settings and
`game_reminder` navigation support. Omission stores false. Wearable registration
keeps capability only for the same complete address. A reminder carries
`{gameId, notification:"game_reminder"}`, default sound, and the member's own
tasks as its title (at most 120 characters). Request sound permission alongside
alerts and open the selected game through the existing authenticated refresh.
