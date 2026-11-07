# End a game at the last post

Status: active
Created: 2026-11-06
Updated: 2026-11-06

## Goal

A pair game ends the moment nobody can change the score, instead of waiting for
the 3am boundary and then for someone to open the app. The app stops saying the
recap is ready before Murph has written it. When nobody opens the app after an
overnight ending, the game still ends and the recap still lands, in the morning.

Why: the owner finished a real game on Nov 6. Both last-day photos were in by
6:07 PM ET. The game stayed live, with no signal, and could not end before 3am
plus a read. Round one's gap from last post to settlement was 6h03m. The next
read reports `settled` with `recap: null`, and iOS shows "Your recap is ready"
and plays its built-in template, then marks it watched.

Owner decisions (Paper "Murph · Game ending"): end at the last post, result
before the recap, overnight endings wait until about 9am, no push when the recap
is ready. Reply stays open on the last photo; the last day's retake and Prove it
go once both are in.

## Success criteria

- Both players' last post lands: the same request or the next read settles the
  game, tickets are written once, the recap is reserved once.
- The other player still gets the post push for that last post.
- Either player can still reply to the other's posts until the old end time.
- `GameView.recapPending` is true only while a recap can still arrive.
- A due game nobody reads settles after about 9am in the last player's zone.
- Missed last day, cross-zone and any-N endings behave as in the table below.

| Ending | Game ends | Murph posts |
| --- | --- | --- |
| Both post the last game day | At the last post | Right after |
| Any-N, both reached N | At the last post needed | Right after |
| Trailing days off | At the last game day's last post | Right after |
| Someone misses the last day | First read after 3am (4am while a late post is possible), or the sweep after 9am | After it ends |
| A last post is marked didn't finish | Stays open to the old end time | After it ends |

## Scope

- In scope (`apps/web/src/lib/game` plus specs):
  1. `isGameDecided(state)` in `rules.ts`, folded into `isGameDue`.
  2. Reply window to the old end time (`replies.ts`).
  3. Post push delivery survives settlement (`post-notification.ts`).
  4. `recapPending` on `GameView`.
  5. Morning settle inside the existing missed-day sweep.
  6. Settled any-N projections.
  7. `weekly-game.md`, `ios-game.md`, tests.
- Out of scope: group games keep today's timing (open invitees can still join
  and post until the end; group iOS is unreleased). No recap prompt change. No
  push for a ready recap. No tie-rule change. iOS ships in murph-ios separately.

## Design

### 1. The rule

```ts
/** Nobody can change the score: every remaining pair player has finished. */
export function isGameDecided(state: RuleState): boolean
```

Pair games only (`seats === 2`), `status === "live"`, both players remaining
with a `dayOne`. With `currentTerms(terms).schedule`:

- `count` schedule: each player's `scorePlayer(...).score >= count`.
- `days` schedule: find the last index under `lengthDays` where
  `isScheduledDay` holds; each player has `completedEntry` on it. A post marked
  incomplete has no credit, so it does not decide the game, and that player can
  still retake.

`isGameDue` keeps its invited and negotiating expiry branch unchanged; only its
live return gains `|| isGameDecided(state)`. `settleDueAt` stays the natural end
and keeps its name, so `settlesAt`, the dev tools and the reply window read the
old end time. No new column, event type or migration. Settlement stays in
`settleLoaded` under the game lock, driven by the read that follows the post
(`requireView` -> `loadCurrent`).

`requireLivePlayer` also refuses a decided pair. The post and the read that
settles it are separate transactions, so without this a queued withdrawal or
retake could land between them and reopen a finished game. Duplicate post
replays still return before `decidePost`. `readGamePhotoPostingStateTx` stops
offering a replacement for a decided pair; the locked mutation stays the final
authority.

`isGameDue` is the shared "game is over" gate, so these now close at the last
post, which is intended: Prove it, day-completion edits, withdraw/retake through
`status`, talk. Audit each caller in `rules.ts`, `talk.ts` and `service.ts`.

### 2. Replies

`replyEligibility` closes on `status` not live or settled, or
`settleDueAt(state) <= now`, instead of `status !== "live" || isGameDue`. A
naturally settled game is at or past that time, so it stays closed. Evidence: on
Nov 6 two replies landed on last-day posts at 6:08 and 6:24 PM ET, both after
the last post. `reply_accepted` runs under `runLocked`; confirm nothing there
requires `live`.

### 3. Post push

`claimGamePostNotification` runs in the post transaction, while the game is
live. `stillValid` runs after commit and requires `row.status === "live"`, and
its state literal hardcodes `"live"`. The read after the post settles the game,
so the last post's push would be dropped. Allow `settled` in `stillValid`, keep
every other check. Same review for `reply-notification.ts`.

### 4. `recapPending`

`recapPending?: true` beside `recapWatched`, set when `status === "settled"`,
`recap === null`, the game has `chatContainerMemberId`, and `clock - settledAt`
is under `GAME_RECAP_UI_WAIT_MS` (10 minutes). This is how long the app holds
Watch back, not a generation deadline: a recap can still land later and every
late-recap path stays as it is. Derived from the row, so no receipt read and no
new state. Older clients ignore it.

### 5. Morning settle

In `reserveDueGameMissedDayCheckIns`, which already visits each live chat-bound
room once an hour by shard, before choosing the room's pair or group collector:
for each live pair game that `isGameDue`, call `settleGame` when `now` is at or
past `morningAfterLastDay(state)`, and either way give that game no check-ins.
Then reload the remaining live candidates and run the existing collectors. This
order also covers mixed rooms, which the group branch would otherwise swallow.
`morningAfterLastDay` is the latest `missedCheckInDueAt(lastDate, timeZone)`
across remaining players. Games with no chat get no recap, so a read still
settles those.

Background reads no longer settle. `readGameChatState` calls `loadCurrent` with
or without a foreground actor; `loadCurrent` skips settlement when there is no
actor, so preparing another notice in the room cannot end a game before the
morning. Pending-change expiry stays as it is. A foreground read at 3:30am still
settles and Murph posts then; someone is awake. Accepted.

### 6. Any-N projections

Only any-N games have scheduled days left after an early end. Settled-game
projections stop at the day play stopped, from `settledAt` and the game clock,
and never touch `lengthDays`, frozen scores or prizes:

- `pairBoardStreak`: a settled game creates no obligation after that day.
- `readGameRecapMaterial`: a blank any-N day is not "missed".

A naturally settled game ends after its last day, so the bound changes nothing
for it. Count-mode streaks in a live game keep their current behavior.

## Constraints

- Prizes: `decideSettle` and ticket creation stay as they are, run once under
  the lock. Tie and perfect outcomes unchanged.
- No migration. `GameView` change is additive.
- Keep compatible with released app builds: they map any settled game to "Your
  recap is ready".

## Risks and mitigations

1. Risk: an older app hits the template sooner, right after the last post.
   Mitigation: same bug as today, moved earlier. Merge the iOS build first;
   backend can follow in either order.
2. Risk: a first poster's retake races the last post.
   Mitigation: both take the game lock. Retake after settlement is refused as
   `GAME_NOT_LIVE`; the app stops offering it once settled.
3. Risk: an offline post for the previous game day arrives after the end.
   Mitigation: only possible when both post the last day inside that day's
   first grace hour (3am to 4am). Accepted, stated here.
4. Risk: `isGameDue` callers that assumed "time passed".
   Mitigation: caller audit in task 1, with a test for each that changes.
5. Risk: rematch right after an evening end starts on the same date.
   Mitigation: existing settled-game rematch path; test Day 1 and the two
   games' chat recap binding.

## Tasks

1. `isGameDecided`, `isGameDue`, `requireLivePlayer`, photo preparation, caller
   audit, rule tests, the race test.
2. Reply window and post push, tests including a real post-then-read flow.
3. `recapPending` in contract, views and service, tests.
4. Morning settle, background reads, mixed rooms, tests.
5. Any-N projections, tests.
6. Specs, changelog decision, focused checks, PR.

## Decisions

- Pair games only for now.
- One backend PR. Merge order: iOS build, then backend.

### ReviewGPT plan review (architecture, Mountain lane, Nov 6)

1. Close score mutations when decided: accepted. `requireLivePlayer` and the chat
   photo preparation path, with a deterministic post-then-read race test.
2. Derive `recapPending` from the generation lifecycle: accepted in part. Renamed
   a UI wait limit, so it no longer claims to own generation and late recaps stay
   allowed. Rejected the receipt lookup: a batched cross-table read on every game
   view to shorten a "writing" line by up to 10 minutes, in rare retired or
   blocked games. Rejected tracking a template watch separately: past the wait
   limit only, and the chat link and the card both still open a late recap.
3. Background reads bypass the morning boundary: accepted, with a smaller change
   than the proposed loader split: `loadCurrent` skips settlement with no actor,
   and due pairs get no check-ins while they wait for morning.
4. Any-N projections: accepted, as section 6.
5. Mixed rooms: accepted, settle before choosing the collector.
6. Invite expiry branch: accepted; the plan's formula was shorthand.
7. Deploy settled-aware readers before early writes: rejected a split release.
   The worst case is one dropped post push or one refused reply during a cutover,
   with 2 live games in production. Recorded instead: once early-settled rows
   exist, these reader changes are the rollback floor.
8. Exactly-once fixture must produce a ticket: accepted, unequal weekday scores.

## Verification

- Commands to run: focused Vitest for `apps/web` game suites, including the
  Postgres service suite; `pnpm typecheck`; `pnpm complexity:diff`.
- Expected outcomes: all pass, with a test proving tickets and the recap
  reservation happen exactly once at the last post.
