# Health wins

## Posting a win

Murph prepares cards from a member’s own health and game data. The suggestions
are private until the member chooses what to post. In the native composer the
member can pick several cards, choose an available variation, add a caption or
attach a photo. A member with no eligible cards can still share a caption or photo.

Each card describes the measure, time period and source. Wearable comparisons
use comparable readings, and percentile cards require a sourced reference
for the person's age and measurement method. Lab changes require comparable,
eligible draws. Experiment cards carry the observed outcome, including relevant
overlap and adherence caveats. A game streak counts a scheduled day when the
member posted in every game due that day.
Medication, genetic, condition, weight and flagged lab results are excluded
from suggested cards. An unavailable source can leave the picker partly or
entirely empty.

Lab population percentiles use NHANES data from August 2021 through August
2023. The population, survey weights and sample sizes determine which
comparisons are available. Lab percentile labels stop at “Top 5%” because the
reference groups have few observations beyond that point. See the [source and method notes](../../apps/web/src/lib/game/progress/lab-norms.md).

The member previews the exact version they will share. **Hide my numbers**
removes the measurements from the card, including its chart and tooltips. If
the suggestion set changes before posting, the composer asks the member to
choose from the refreshed set. Later readings do not change published cards.
The picker returns up to 24 eligible cards and balances the first 12 across
available categories. A cumulative distance card includes the existing
Progress route painting when available.
If a client encounters an unfamiliar chart, it shows the title, subtitle and
a prompt to update Murph.

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

A member can cheer once per post and undo the cheer. Comments default to
**Everyone**, meaning people who can open the post. **Just the poster** limits
a comment to its writer and the poster. Hides and blocks apply to the comment
writer as well as the poster. A partner’s comment disappears for all readers
if the writer and poster stop sharing a game, or either blocks or hides the other.
Only authors on the rollout allowlist can share posts and comments. The feed
shows neither interaction counts nor automatic comments from Murph.

The poster can receive a push for a new comment or cheer. An hour of cheers
on one post generates at most one push. A private comment can notify only
the poster. Removing access before delivery suppresses the notification.

## Companion API

All paths below are relative to `/api/game/v1/health` and require member
authentication. The client reads the optional `flags.health_feed` from game
Home and shows the feed only when it is true. A disabled route returns 404.
Responses use `private, no-store`.

| Route | Request and result |
| --- | --- |
| `GET wins` | Returns `{day, setRevision, candidates}`. Use `?refresh=1` to request a refresh. A timeout can return a previous day's set. Use the returned day and revision together. |
| `POST wins/{candidateId}/change` | Send `{setRevision, option}` using an ID from the candidate's `change_options`. Returns `{card}` for preview. |
| `PUT photos/{id}` | Upload a JPEG up to 2 MiB and 2048 pixels per side under a client-generated UUID. Each member can have 20 unpublished uploads. A new upload over the limit returns 409. Use the returned `attachmentId` at publication. `DELETE` discards an unpublished upload. `GET` reads an authorized published photo. |
| `POST posts` | Send a client UUID in `id` and at least one of `caption`, `cards` or `attachmentId`. For cards, include `setRevision` and up to 12 distinct `{candidateId, option}` picks. Send `original` to choose the unmodified card. Returns `{id, version}`. Reuse the UUID on retry. |
| `GET / PATCH / DELETE posts/{id}` | GET returns `{post}`. PATCH takes `expectedVersion` and a caption or replacement card selection using the same fields as POST. It returns `{id, version}`. A revision conflict returns 409. DELETE returns 204. |
| `GET feed` | Returns `{posts, nextCursor}`. Pass `nextCursor` in `?cursor=` until it is null. An intervening removal can leave an empty page with a continuation. |
| `PUT / DELETE posts/{id}/cheer` | Set or clear the viewer's cheer. Both return 204. |
| `GET / POST posts/{id}/comments` | GET returns `{comments, nextCursor}`. POST takes a client UUID in `id`, `body` and optional `visibility` (`everyone` or `poster`). It returns `{id}`. |
| `DELETE comments/{id}` | Deletes the writer's comment and returns 204. |
| `GET people/{memberId}/profile` | Returns `{memberId, firstName, avatarUrl, numbers, posts, nextCursor}`. Numbers come from the pair board and are null when unavailable. |
| `GET hides` | Returns `{people: [{memberId, firstName, avatarUrl}]}` for the viewer’s outgoing hides, newest first. Name and avatar can be null when the profile is unavailable to the viewer. |
| `PUT / DELETE hides/{memberId}` | Hide a visible partner or comment writer, or clear an existing hide. Returns `{hidden}`. |

Posts include `id`, `authorMemberId`, `firstName`, `avatarUrl`, `createdAt`,
`version`, `caption`, `cards`, `attachmentId` and `cheered`. Each published
card carries `{id, specRevision, spec}`. Comments include their `id`, `postId`,
author ID, first name, avatar URL, creation time, visibility and body. Feed,
profile posts and comments page newest first, up to 20 per page.
After consent withdrawal the author receives only `{id, createdAt, version}`
for their own posts. A cumulative distance card’s map chart may contain
`art: {url}`, a link to the painting selected when the card was prepared.

## Rollout

The server allowlist is `MURPH_HEALTH_FEED_MEMBER_IDS`. Deploy the Progress
media worker that accepts health-post envelopes and the Web server that
purges them during account deletion before enabling uploads. Both capabilities
must remain available as long as health photos exist.

The native Home design keeps the games row and adds the feed below it. The
native composer, profile sheet, and **Try it** actions have a separate client
rollout. Timed activities and GPS recording belong to later phases.

The server storage, authorization and deletion contract is in
[Health wins architecture](../../ARCHITECTURE.md#health-wins).
