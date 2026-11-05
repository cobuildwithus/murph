# iOS game contract

The canonical wire types live in `apps/web/src/lib/game/contract.ts`.
The [weekly-game spec](weekly-game.md) owns rules, authority and delivery.

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

A number is `{ state: "not_shared" | "pending" | "hidden" }`, or
`{ state: "available", unit, latest: { date, value }, stale, daily, comparison }`.
Daily points are ascending, one per date, with gaps omitted. Daily values round
to integers except VO2 (one decimal); window means retain their precision.
`stale` means the latest date precedes `window.through` by more than seven days.
Missing or legacy publications remain pending. A viewer outside the sharing
group sees the other person's numbers as hidden and may intentionally enroll.
Both people's numbers come only from the same authorized shared snapshots.

Each metric selects one public source for both windows, preferring sufficient
coverage, then more distinct dates across the windows, later latest date, and
source id. Never fill gaps from another source. Unknown-source legacy values
can display but cannot support comparison. Explicit naps do not count as sleep.
Daily comparisons need four dates in each seven-day window: baseline starts at
`max(firstGameOn, window.from)` and current ends at the source's latest date.
Overlap gives null. VO2 uses its existing median/two-date policy with a 14-day
current window and an up-to-90-day baseline clipped before that window and to
retention. `comparison` contains `baseline` and `current`, each
`{ from, through, value, days }`, plus raw `delta`, direction-adjusted
`improvement`, and `sinceFirstGame`. The latter is false when Day 1 has aged
out of retention. `firstGameOn` itself is never clipped or inferred from capped
history. Crowns name the unique largest positive improvement (or positive
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
