# iOS game contract

The canonical wire types live in `apps/web/src/lib/game/contract.ts`.
The [weekly-game spec](weekly-game.md) owns rules, authority and delivery.

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
