# Health wins

## Posting a win

Murph prepares cards from a member’s own health and game data. The suggestions
are private until the member chooses what to post. In the native composer the
member can pick several cards, choose an available variation, add a caption or
attach a photo. A member with no eligible cards can still share a caption or photo.
Once shared, a card leaves that member’s suggestions. It can return when the
member removes it from their last post containing it or deletes that post.
A new period of the same achievement remains eligible for its own card.

Each card describes the measure, time period and source. Wearable comparisons
use comparable readings, and percentile cards require a sourced reference
for the person's age and measurement method. Lab changes require comparable,
eligible draws. An experiment card’s `two_bars` chart names the measured outcome
once in `label` and uses `unit` for both the Before and During means in `series`.
`adherence.done` and `adherence.target` give the logged and planned counts.
The subtitle still describes the observed outcome, adherence and any overlap
for older apps. A game streak needs at least two scheduled days. Each day counts
when the member posted in every game due that day.
Medication, genetic, condition, weight and flagged lab results are excluded
from suggested cards. An unavailable source can leave the picker partly or
entirely empty.

Lab population percentiles use NHANES data from August 2021 through August
2023. The population, survey weights and sample sizes determine which
comparisons are available. Lab percentile labels stop at “Top 5%” because the
reference groups have few observations beyond that point. See the [source and method notes](../../apps/web/src/lib/game/progress/lab-norms.md).

The member previews the exact version they will share. **Hide my numbers**
removes the measurements from the card, including tooltip values. A recording's
route map stays visible until the member chooses **Hide the map**. If
the suggestion set changes before posting, the composer asks the member to
choose from the refreshed set. Later readings do not change published cards.
The picker shows up to 24 eligible cards, newest achievement first. Category
filters keep this order. The engine balances categories when choosing the cards.
A cumulative distance card includes the existing
Progress route painting when available.
New suggestions use the phone's units for distances and skyline heights.
US members see miles and feet, UK members see miles and metres, and metric
members see kilometres and metres. Published cards keep the units from their preview.
If a client encounters an unfamiliar chart, it shows the title, subtitle and
a prompt to update Murph.

## Diet wins

Murph counts protein and fiber separately. A day counts for a nutrient when
every logged meal has a known amount. A month qualifies when at least 80% of
its days count. During the following month a tally can show the previous
month's logged grams as a food equivalent, with 10 to 50 icons. The food is
a comparison for scale. **Hide my numbers** removes both the grams and the
icons and leaves “Diet milestone.”

From day 14, a current month with 80% coverage can earn a best-month card
when it matches or exceeds every qualifying prior month. Murph compares
against this year's completed months when at least three qualify, otherwise
against the preceding 12 months when at least three qualify. A fiber streak
requires five consecutive days at or above 30 g. The longest streak in the
last 90 days qualifies when it ended within 60 days. A missing day or
incomplete fiber reading breaks the streak. Diet cards omit the measure used
by See yours.

## Posting a payoff

For seven days after a two-player game settles, the winner can post a photo
with the final score and the agreed dare or prize. Both players must still
hold joined seats, the ticket must be owed to the winner, and a block in
either direction prevents posting. Shared rewards, ties and legacy stake
types are ineligible. The result uses each player's own profile first name.
Posting marks the ticket paid. An already redeemed ticket can still be shared.

The post is visible only to its author and the other current player under
the usual Health wins access rules. Either player can hide the other. The
author can edit the caption or delete the post. Deleting it allows another
payoff post while the game still qualifies. Deleting the game restricts the
post and photo to the author.

## Texting a new win

A feed member can receive at most one iMessage about a new win per local day
after opening the composer while win texts are enabled for them. The first
complete set with an eligible achievement establishes a silent baseline. Murph
remembers achievements the member has seen in the composer, including on partial
and cached reads. On later days it picks the highest-ranked fresh, unseen
achievement in the engine's deterministic order. It consumes the other observed
achievements that day as well.

Eligible wins include trends, best months, threshold counts and session counts
for the current calendar month. A personal record must fall within the latest
three local dates. A lab change or lab percentile must fall within the latest
90 local dates. Multiple results from one experiment share an identity.
Murph skips streaks, standing totals, wearable percentiles, game cards,
lab-range cards and activities the member recorded.

The question and link preview are generic. The link opens a compatible
companion through `/wins/<ref>`. An eligible candidate in the member's normal
authenticated wins response can include an opaque `winRef` for local matching.
A previously cached candidate without an achievement descriptor has no reference.
The browser landing page offers **Open in Murph** for any well-formed reference.

The minute sweep claims an enrolled member's day once, between 10:00 and
13:30 in their game profile time zone. Detection requires complete inputs,
current health consent and active access, an awake account and an established
direct iMessage thread with inbound activity in the 90-day window. Opening the composer
during evaluation or before dispatch suppresses the pending text. Three
accepted win texts within 28 days pause further texts until the member writes
to Murph or posts a win, or the oldest text ages out.

## Recording an activity

Members with timed recording enabled can save a session privately or share selected cards
with the usual post audience. Saving retains the summary for the member's Settings export,
including after health-consent withdrawal. The member can publish from the phone's retained
draft. Saving or posting a recording does not count as a game check-in.

A timed card shows how long the activity lasted. When minute averages are available, a
heart-rate card shows them with gaps for missing readings. The markers identify the lowest and highest visible minute averages, using one-based
minute positions. The subtitle identifies the peak individual reading.
Members can give a recording a name. The time, heart-rate, map and splits
cards use it in their titles. The suggested post title can also include the
previous activity's name. **Hide my numbers** removes the duration and
measurements and uses a fixed, kind-specific session label. The post uses
the selected version even if later recordings change.

With route recording enabled, a run or walk can also show a map and a split
table. The map shows only the paths the phone prepared for sharing. Distance
and pace use moving time and moving distance, including parts hidden on the map.
The member can post the splits and heart-rate cards independently of the map.

## Who can see it

Home shows the member’s posts and those of current partners in a live or
settled game, newest first. Removing a partner from the feed hides the two
people’s posts and comments from each other. This choice applies only within
Health wins. A game block also takes effect here, in either direction.
Settings lists the people the member has hidden, newest first, so they can undo a hide.

Opening a profile shows that person’s eligible posts. Profile numbers follow
the existing pair-board sharing choices. Posting a card grants access to that
card only. Withdrawing health consent closes access to the author’s shared
content and photos. The author can still list their own posts by date and
delete their own posts and comments.

## Responding

A member can cheer once per post. Adding or removing a cheer requires the
viewer's current health consent. Comments default to
**Everyone**, meaning people who can open the post. **Just the poster** limits
a comment to its writer and the poster. The poster can reply privately to that
writer. Deleting the original comment preserves the reply and its audience.
Hides and blocks apply to the comment
writer as well as the poster. A partner’s comment disappears for all readers
if the writer and poster stop sharing a game, or either blocks or hides the other.
Only authors on the rollout allowlist can share posts and comments. The feed
shows neither interaction counts nor automatic comments from Murph.

The poster can receive a push for a new comment or cheer. An hour of cheers
on one post generates at most one push. A private comment from a partner can
notify only the poster. The poster's private reply can notify only the partner
who wrote the original. Removing access before delivery suppresses the notification.

## See yours

A member can open a partner’s published card with a `measure` to see a private
card for the same lab analyte or wearable metric. **Hide my numbers** keeps
the generic milestone title and omits the measure. Cards frozen before
measure tagging also omit it. The partner receives no signal that the member
opened the card.

The response identifies the measure by `key`, display `label` and `source`
(`labs` or `wearable`). When a card qualifies, `card` holds the viewer’s
preview and `reason` is null. The server tries the partner’s card kind first.
Both cards must show percentiles in matching units for `friend` to carry the
partner’s published `{value, unit}`. Resting heart rate also requires both
charts to carry the same `referenceKey` (`oura_sleeping_hr` or
`apple_resting_hr`). Otherwise `friend` is null.

When a successful read finds no observation for the measure, `card` and
`friend` are null and `reason` is `no_labs` or `no_wearable`. A reading that
cannot support a card gives `not_enough_data`. This includes a flagged or
out-of-range latest draw. An unavailable replica, a failed read or decode,
or a read that exceeds four seconds returns retryable 503
`HEALTH_SEE_YOURS_UNAVAILABLE`.

To post the preview, send its private `mine:<measure>:<kind>` candidate ID,
chosen option and that option’s SHA-256 `specRevision`. Each preview
includes its available alternate specs and revisions. A post can include
one such pick alongside suggested or recorded cards. The server rebuilds the chosen spec
in the requested units. A mismatch returns 409 `HEALTH_SEE_YOURS_CHANGED`.
Open See yours again and confirm the new preview before posting. The published
card uses the same opaque ID as its matching suggestion, which leaves the
picker once shared.

## Companion API

All paths below are relative to `/api/game/v1/health` and require member
authentication. The client reads the optional `flags.health_feed` from game
Home and shows the feed only when it is true. A disabled route returns 404.
Responses use `private, no-store`. Game Home and the Health wins feed add a top-level
`record: {timed: true, route: boolean, named: true}` for members on both the feed and recording allowlists.
Only members also on the route allowlist receive `route: true`.
A missing `record` keeps the recorder hidden. The client offers activity-name
search only when `record.named` is true. The recording endpoints return 404
when recording is disabled.

| Route | Request and result |
| --- | --- |
| `GET wins` | Returns `{day, setRevision, candidates}`. Ordinary reads reuse today's set for an hour. `?refresh=1` recomputes immediately, once per minute per member. Additional refreshes during that minute return the stored set. A timeout can return a previous day's set. Use the returned day and revision together. |
| `GET payoffs` | Returns `{cards}` with up to 24 eligible original-only game previews, newest settlement first. A feed member outside the payoff allowlist receives an empty list. Each preview includes its `candidateId` and `specRevision`. |
| `POST wins/{candidateId}/change` | Send `{setRevision, option}` using an ID from the candidate's `change_options`. Returns `{card}` for preview. |
| `PUT photos/{id}` | Upload a JPEG up to 2 MiB and 2048 pixels per side under a client-generated UUID. Each member can have 20 unpublished uploads. A new upload over the limit returns 409. Use the returned `attachmentId` at publication. `DELETE` discards an unpublished upload. `GET` reads an authorized published photo. |
| `POST activities/kind` | Send `{name}` when the member chooses a custom name. Returns `{name, kind, timer, decided}` with the cleaned name. Send that name back unchanged on preview, save and post. |
| `POST activities/cards` | Send `{activity}` to preview without saving. Returns `{suggestedTitle, cards}`. Each card includes the flat spec, `candidateId`, `specRevision` and `change_options`. Each option carries its own revision. Alternate options include the exact display spec, or `null` for map removal. |
| `PUT activities/{id}` | Send `{activity}` with the matching UUID and summary fields only. Returns `{id}`. Repeating the same save returns the same receipt. Reusing the UUID for a different summary returns 409. |
| `POST posts` | Send a client UUID in `id` and at least one of `caption`, `cards` or `attachmentId`. Send up to 12 distinct picks in display order. Include `setRevision` for suggested cards and send `{candidateId, option}`. For recorded and See yours cards, send `{candidateId, option, specRevision}` for the chosen option. Recorded picks also require the previewed `activity`. Send `original` for the unmodified card. Returns `{id, version}`. Retry with the same UUID. |
| `GET / PATCH / DELETE posts/{id}` | GET returns `{post}`. PATCH takes `expectedVersion`. Authors can edit the caption on any live post they own. Payoff posts accept only caption edits. On other posts, send `removeCardIds` to remove specific frozen cards or `cards: []` to clear the selection. Ordinary posts also accept a replacement selection from the current set. Both `mine:` and `game:` picks require a new post. Keep at least a caption, card or photo. PATCH returns `{id, version}`. A revision conflict returns 409. DELETE returns 204. |
| `GET posts/{id}/see-yours?card={frozenCardId}` | Returns `{measure, card, reason, friend}` in the viewer’s client units. An inaccessible post or missing card returns 404. The viewer’s own post or a card without a measure returns 400. The limit is 10 reads per viewer per minute, then 429. |
| `GET feed` | Returns `{posts, nextCursor}`. Pass `nextCursor` in `?cursor=` until it is null. An intervening removal can leave an empty page with a continuation. |
| `PUT / DELETE posts/{id}/cheer` | Set or clear the viewer's cheer. Both return 204. |
| `GET / POST posts/{id}/comments` | GET returns `{comments, nextCursor}`. POST takes a client UUID in `id`, `body`, optional `visibility` (`everyone` or `poster`) and optional UUID `replyTo`. Only the poster can use `replyTo`, targeting another writer's visible, original poster-only comment on this post. Web ignores submitted visibility for a reply. POST returns `{id}`. |
| `DELETE comments/{id}` | Deletes the writer's comment and returns 204. |
| `GET people/{memberId}/profile` | Returns `{memberId, firstName, avatarUrl, numbers, posts, nextCursor}`. Numbers come from the pair board and are null when unavailable. |
| `GET hides` | Returns `{people: [{memberId, firstName, avatarUrl}]}` for the viewer’s outgoing hides, newest first. Name and avatar can be null when the profile is unavailable to the viewer. |
| `PUT / DELETE hides/{memberId}` | Hide a visible partner or comment writer, or clear an existing hide. Returns `{hidden}`. |

To publish a payoff, send one `game:<gameId>` pick with `option: "original"`,
its previewed `specRevision` and a ready `attachmentId`. A payoff needs no
`setRevision`. A changed spec returns 409 `HEALTH_PAYOFF_CHANGED`. A different
live post for the game returns 409 `HEALTH_PAYOFF_EXISTS`. An ineligible game
returns 404. Retrying the original post ID returns its receipt.

### Recorded activity fields

| Field | Meaning |
| --- | --- |
| `id`, `kind` | Client UUID and one of `sauna`, `cold_plunge`, `lift`, `other`, `run`, or `walk`. A run or walk without a route uses the timed card builder. |
| `name?` | Optional activity name, 1–32 Unicode scalars. The private summary and Settings export include it when supplied. |
| `startedAt` | ISO timestamp with an offset or UTC designator. The card discloses only the day in the member’s game-profile time zone and the part of day (night before 5:00, morning, afternoon from 12:00, evening from 17:00), never the start time. |
| `elapsedSec`, `movingSec`, `timerSec?` | Whole seconds, each positive and at most six hours. Elapsed runs from Start to Finish, pauses included. Moving time is the recording time with pauses cut out, at most the elapsed time. Cards show moving time, the same clock the phone's timer runs on. |
| `heartRate?` | Summary with `avgBpm`, `lowBpm`, and `peakBpm`, ordered low to average to peak within 30–230 bpm. For preview and post, also send `perMinute`: one whole-number average per minute of moving time (within one of `ceil(movingSec / 60)`), or `null` for a minute without a reading. Omit the series on a private save. |
| `route?` | Available only for `run` and `walk`. Preview and post accept the route below. On a private save, send the same summary fields and omit `paths`. |

The minute array has at most 360 entries. Each reading must lie within the
summary envelope. Raw samples, GPS fixes and extra fields are rejected at every
level. All recording JSON shares the
32 KiB request limit. The client supplies presentation units via `X-Murph-Client-Units`.

### Choosing an activity name

The client filters names locally while the member types. When the member
chooses a new name, Web rejects raw line breaks, strips control and format
characters, trims and collapses whitespace, and normalizes the result to NFC.
The name must contain a letter. It may also include combining marks, numbers, spaces,
straight or curly apostrophes, ampersands, slashes, periods and hyphens.
Web applies the game task-text refusal rules before classification.

With `MURPH_HEALTH_ACTIVITY_DECISIONS=true` and an OpenAI API key configured,
Web reuses a shared classification or asks Decisions once with a three-second
deadline. The cleaned name is the only member-supplied information the
provider receives. Each member can make 30 cache-miss attempts per 24 hours.
A run or walk requires both a route score of at least 0.5 and current route
access. Otherwise that selection becomes `other`. A timer score of at least
0.5 enables the countdown, as do the `sauna` and `cold_plunge` kinds. The
client also checks route access before starting from a built-in or recent
selection. A recording already in progress keeps its kind.

When Decisions is off, unavailable, or the budget is exhausted, the result
keeps the cleaned name with `kind: "other"`, `timer: false` and `decided: false`.
Web checks names on new choices, previews, private saves and new posts.
A refused name returns HTTP 400 with `HEALTH_ACTIVITY_NAME_INVALID`. On this
code during preview or an uncommitted private save, the client can remove
the name from its retained draft, keep the rest of the recording, retry once
and tell the member. An exact retry of a committed private save returns its
receipt even if the name would now be refused. Export, previous-activity
lookup and comparison against a sealed save use the stored name without
checking today's refusal rules.

### Route recording

`POST activities/cards` and `POST posts` accept the following closed object in `activity.route`.

```ts
{
  distanceM: number,
  climbM: number,
  splits: { distanceM: number, seconds: number }[],
  paths: string[]
}
```

- `distanceM` is the phone's moving distance in metres, greater than zero and at most 100,000. `climbM` is from zero through 3,000 metres.
- Send one to 100 splits in recording order. Full splits use one unit throughout, either 1,000 metres or 1,609.344 metres. Only the last may be shorter. Each duration is a positive whole number of seconds. Split distances must total within 1% of `distanceM`, and durations must total at most `movingSec + 1`.
- Send zero to eight precision-5 Google encoded polylines, at most 1,000 decoded points in total. Every coordinate must fall on the 0.0001-degree grid. The phone trims the ends, cuts private zones and simplifies the paths before submission. When no shareable path remains, send `paths: []`: the run keeps its splits card and gets no map.
- Each path may cover at most `distanceM` plus the larger of 16 metres and 1% of `distanceM`. The diagonal of the bounding box across all paths must fit within `distanceM`. Average moving pace must be 150–1,200 seconds per kilometre for runs or 300–2,400 for walks, inclusive.

The `activity_route` card's `route_map` chart contains `paths` and
`frame: {west, south, east, north}`. Below the map, display `stats` in order.
Each entry has a `label`, a formatted string `value` and an optional `unit`.

| Label | Value and unit |
| --- | --- |
| Distance | Moving distance in `mi` or `km` |
| Pace | Average moving pace with unit `/mi` or `/km` |
| Time | Moving time as `m:ss` or `h:mm:ss`, without a unit |
| Climb | Ascent in `ft` or `m`, included when it rounds to at least one in the display unit |

Heart rate stays on its own card, so leaving that card out or hiding its numbers never shares a heart rate.
The original chart also includes `chips: [distance, pace]` for older apps.
The frame covers three by two Web Mercator tiles. Zoom 15 gives the smallest geographic frame. Larger
routes use a coarser zoom. A block may slide by whole tiles to enclose a route
that crosses a block edge. A date-line crossing can have an east bound above
180 degrees to keep the frame continuous. Latitudes beyond the Mercator limit
project to the outermost tile row.

The published chart can also carry `art: {key}`. The key is `area:v2:` followed
by an unpadded base64url HMAC-SHA256 of the northwest tile's `z/x/y`. The server
uses a purpose-specific key from `HOSTED_CONTACT_PRIVACY_KEYS`, selected by
`HOSTED_CONTACT_PRIVACY_CURRENT_KEY_VERSION`. Runs in the same frame share
a key under that version. Rotation changes the painting key on future cards.
Published cards keep their original painting keys and can still fetch ready
JPEGs. The key reveals no coordinates. Previews use the native map. If Web
lacks a usable key, the published chart also uses the native map.

With `MURPH_HEALTH_PAINTED_RUNS=true`, committing a new post with a selected
route map schedules a painting after the response. Before each provider call,
Web checks the author's current access and consent and confirms the post
still contains that route card. Mapbox receives the frame from the card. The
image provider repaints its satellite image. Everyone with the same key shares
one painting and the phone draws the sealed path on top.

The authenticated `GET /api/game/v1/progress/art/{key}` takes the URL-encoded
key and serves the ready JPEG. A missing painting returns 404. Reading a key
uses no generation budget. Area and game paintings share the allowance of
150 image attempts per UTC day. A member can start at most five area claims
per UTC day. Reusing a ready painting or one already in progress is free.
If the post loses admission before a provider call, Web refunds both allowances
and the attempt, and another eligible post can claim the area immediately.
While art is pending, over budget or unavailable, the phone uses its muted map.
Turning the flag off stops new
generation. Previously painted keys continue to serve their immutable JPEGs.

The `activity_splits` card's `splits` chart contains `unit` (`mi` or `km`), a formatted
summary `line`, and `splits: [{label, seconds, text, partial?}]`. Each row's
`text` gives its duration. `fastest` is the zero-based index of the quickest
full split, first on ties. With fewer than two full splits, `fastest` is `null`
and the subtitle shows moving time and average pace. Distance and
pace in the summary use miles for `us` and `uk`, kilometres for `metric`.
Climb uses feet for `us` and metres otherwise. Split labels retain the unit the phone
used to cut the splits. For a single partial shorter than a kilometre, either unit
could have been used, so its label uses the request units.

`hide_numbers` keeps the route map, omits both `stats` and `chips`, and removes
the measurements from the title and subtitle. On the splits and heart-rate
cards, the option replaces the numeric chart. To share a number-free set, select this option on
each included card. Only the route card offers `hide_map`. Its change option
carries `spec: null` and the SHA-256 revision of JSON `null`. Posting that
option removes the entire card, including paths, frame and art key. Other picks
retain their order. At least one remaining card, a caption or a photo is required.

A private save accepts `route: {distanceM, climbM, splits}` with the same split
pairs as the preview. The sealed row and Settings export retain only
`{distanceM, climbM, splitSec}`, with one duration in seconds per split.

### Publishing a recording

A recorded candidate ID has the form `activity:<uuid>:<card-kind>`. Use the chosen
option's SHA-256 revision when posting. If the rebuilt spec differs, the server returns
409 `HEALTH_ACTIVITY_CARD_CHANGED`. Preview again and ask the member to confirm.
A successful post binds that recording once. Replaying the post ID returns its
stored receipt before name admission, even if the card builder or refusal rules
have since changed. Deleting the post removes the shared cards. The private
summary remains available in Settings export.

Posts include `id`, `authorMemberId`, `firstName`, `avatarUrl`, `createdAt`,
`version`, `caption`, `cards`, `attachmentId` and `cheered`. Each published
card carries `{id, specRevision, spec}`. Comments include their `id`, `postId`,
author ID, first name, avatar URL, creation time, visibility and body. Each
also includes nullable `recipientMemberId` and `recipientFirstName`. A private
reply has `poster` visibility and identifies the partner who receives it.
The name is null when the viewer lacks access to the partner's profile or
no name is available. Ordinary comments return null for both fields. Feed,
profile posts and comments page newest first, up to 20 per page.
After consent withdrawal the author receives only `{id, createdAt, version}`
for their own posts. A cumulative distance card’s map chart may contain
`art: {url}`, a link to the painting selected when the card was prepared.

## Rollout

Deploy See yours on the existing feed allowlist before releasing a client
that requests it. The client offers See yours only on another member’s
published card with a `measure`. Detector v6 adds that field to eligible
cards when a daily set regenerates. Previously published cards keep their
frozen specs.

`MURPH_HEALTH_DIET_MEMBER_IDS` controls suggestion generation. Existing
offers remain usable until their cached set is replaced. A client that lacks
the tally chart can still show its update prompt. `MURPH_HEALTH_PAYOFF_MEMBER_IDS`
controls payoff eligibility and publication for feed members. Apply the
`health_post.game_id` migration and deploy the scoped readers with the writer
disabled. Wait for every older reader to drain before enabling payoffs. Keep
the scoped readers on every rollback once any payoff has been posted.

The feed, recording, Diet and payoff allowlists take member IDs, or `*` for every member.
The feed uses `MURPH_HEALTH_FEED_MEMBER_IDS`. Timed recording also requires membership in
`MURPH_HEALTH_RECORD_MEMBER_IDS`. Route recording additionally requires
`MURPH_HEALTH_ROUTE_MEMBER_IDS`. Deploy route-capable Web and the companion's
final route privacy transform before enabling this subset. After strict request
parsing, a new route-bearing request from a member without route recording returns 404. An already committed
post ID replays for its author after the recording flags turn off. Deploy the Progress
media worker that accepts health-post envelopes and the Web server that
purges them during account deletion before enabling uploads. Both capabilities
must remain available as long as health photos exist.

The native Home design keeps the games row and adds the feed below it. The
native composer, profile sheet, and **Try it** actions have a separate client
rollout. Deploy the activity migration and recording-capable Web before enabling timed clients.
Keep the compatible Web writer and exporter available once summaries exist. GPS recording
and recording-based session wins have separate rollout steps.

Production sets `MURPH_HEALTH_WIN_TEXT_MEMBER_IDS` to `*` so every feed member
can enroll by opening the composer. To limit texts to selected feed members,
list their IDs. An empty list disables enrollment, evaluation and queued
delivery. Deploy compatible Web and runner builds and the companion's win-link
handling before enabling texts.
On rollback, keep the signed egress rejection for this key family until all
queued and already imported delivery work has reached a terminal state.

Deploy the activity-kind cache migration and finish rolling out Web readers
and writers that support `name` before releasing a client that sends it.
Keep compatible readers, writers and exporters available after the first
named save. In staging, enable `MURPH_HEALTH_ACTIVITY_DECISIONS` and check
the route and timer thresholds with synthetic names. The switch controls
classification only. Timed-recording members can use names with it off.

The server storage, authorization and deletion contract is in
[Health wins architecture](../../ARCHITECTURE.md#health-wins).
