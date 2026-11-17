# Per-game reminder times

Status: completed
Created: 2026-11-16
Updated: 2026-11-16

## Goal

- Each game a member plays can have its own reminder time. Today one
  `game_profile.reminder_minutes` covers every game, so a member who sets "noon"
  for one game in that game's group chat silently moves every other game too.
- After this change:
  - A time set in a game's group chat changes that chat's game only.
  - In the direct chat, "remind me at 9pm for pullups" moves only pullups, and
    "remind me at 7pm" with no game moves all of them.
  - The push for a game comes at that game's time. The private text, for games
    that get one, comes an hour after that game's time.

## Success criteria

- Two live games at 12:00 and 21:00 produce two pushes on the same local day:
  one at noon naming only the noon game's task, one at 9pm naming only the 9pm
  game's task. Each push is claimed once.
- A group `set_reminder` with minutes and no gameId changes only the actor's
  games bound to that chat. Profile default and other games are unchanged.
- Direct `my_game_reminders set` with `gameId` + `minutes` changes only that
  game. With `minutes` and no `gameId`, it sets the default and clears every
  game's own time.
- An old iOS PUT (no `gameMinutes`) keeps every game's own time.
- The `my_game_reminders` read shows each game's effective time. The runner's
  rendered result (#5125) shows that time in words.
- Private evening text: two uncovered games at different times get separate
  texts, each an hour after its game's time. The 3-unanswered pause still
  works across slots.
- Play again (carry-over on activation) keeps the previous game's own time
  unless the member chose one for the new game.

## Scope

- In scope:
  - Nullable `game_player.reminder_minutes` (null = follow the profile time).
  - `setReminders` command/contract and `GET/PUT /api/game/v1/me/reminders`.
  - Push sweep slotting and claims.
  - Private evening slotting, eventId, receipts and pause.
  - Direct tool and group `set_reminder`.
  - Carry-over.
  - Runner tool descriptions and guidance.
  - ARCHITECTURE.md reminder section.
  - iOS Settings › Notifications per-game time (separate murph-ios PR).
- Out of scope:
  - Room `game_evening` check-in timing. It stays at the room's evening and
    never read `reminder_minutes`.
  - The `new_rhythm` kickoff wording for set-weekday games, which is a
    separate open owner call.
  - Multiple times per game.

## Design

### Storage

- Add the column with an additive migration: `ALTER TABLE game_player ADD
  COLUMN reminder_minutes integer`, nullable, with no CHECK. The predeploy
  migration guard allows a CHECK only through a reviewed exception. The
  `setReminders` parser bounds the value to 0..1439, and it is the only
  writer.
- No backfill. Every existing seat follows its profile time, which is exactly
  today's behavior.
- Effective time = `seat.reminder_minutes ?? profile.reminder_minutes`.
- `game_profile.reminder_minutes` stays. It is the default for new games and
  for games without their own time, and it is still what old iOS shows and
  sets.

### Command and app API

- `GameReminders` gains `gameMinutes: Record<gameId, minutes>`, listing only
  live seats with their own time.
- `setReminders` gains optional `gameMinutes`.
  - `undefined` keeps every seat's own time. This is what old iOS sends.
  - An object replaces the own times for every live seat: seats not listed go
    back to null. This mirrors how `everyDayGameIds` works today.
- Validation:
  - Keys are `clientId` game IDs; values are integers 0..1439.
  - At most 1000 keys, the same bound as `offGameIds`.
  - Foreign or settled IDs are ignored, as `offGameIds` ignores them today.
- `saveGameReminders`:
  - Sets `reminder_minutes = (gameMinutes ->> game_id)::int` in the existing
    raw UPDATE, guarded the same way (`CASE WHEN defined`).
  - Records a `reminder_minutes_chosen` choice event per live seat when
    `gameMinutes` is defined, like `reminder_every_day_chosen`.
- GET returns `gameMinutes`. Old iOS decodes with Codable, which ignores
  unknown keys.

### Tools

- Scoped writes, after review finding 1: `setReminders` also takes
  `timeForGameIds`.
  - When it is present, `minutes` is the own time of just those seats (none
    when the list is empty). The profile time is not written.
  - The minutes choice fact is recorded only for those seats.
  - It cannot be combined with `gameMinutes`.
  - The conversation tools never send the whole `gameMinutes` map, so two
    single-game edits and a default change can't undo each other.
- Direct `my_game_reminders`:
  - The read projection adds `games[].minutes`, the effective time. The
    runner schema for this optional field is already in #5125.
  - `set` with `gameId` + `minutes` sends `timeForGameIds: [gameId]`.
  - `set` with `minutes` and no `gameId` sets the profile minutes and
    `gameMinutes = {}`.
  - `set` without `minutes` sends `timeForGameIds: []`, so neither the
    default time nor any game's time is touched.
- Group `update_game set_reminder`:
  - `minutes` with `gameId` sets that game. That path keeps the existing
    `gameChatContextCurrent` check.
  - `minutes` without `gameId` sets every live seat of the actor whose game's
    `chatContainerMemberId` is this chat.
  - A chat with no such game is refused (`NOT_A_PLAYER`).
  - The profile time is never changed from a group chat.
  - `reaches` is computed on those same games.
- Runner text:
  - `MURPH_MY_GAME_REMINDERS_TOOL.description`: each game has its own time;
    with a gameId it sets that game; without one it sets all. Stays under
    its 850-byte budget.
  - `GAME_REMINDER_GUIDANCE`: the time is for this chat's game only.
  - `update_game` `set_reminder` field description.
  - `describeMyGameReminders` (from #5125) already shows a per-game `time`
    when `minutes` is present.

### Push sweep (`reminder-notification.ts`)

- The page query selects one row per profile with `array_agg(DISTINCT
  COALESCE(seat.reminder_minutes, profile.reminder_minutes))` over live,
  not-off seats. It keeps the same shard, page size and route filters.
- A slot is `(memberId, minutes)`. It is due when `gameReminderWindow(now,
  zone, minutes)` is open.
- Claim key: `game-reminder:<sha256([memberId, day, minutes])>`. It is
  claimed once and never released, as today.
- `readOpenGames` takes slots and keeps only seats whose effective time equals
  the slot. Both the claim-time read and the recheck read use it, so the push
  names only that slot's games.
- Collapse ID is the slot's key hash. Two games at one time still get one push.
- A member whose times are within 30 minutes of each other can get two pushes
  close together. That is accepted.

### Private evening text (`private-notification.ts`)

- A slot is `(memberId, date, minutes)`. Its window is `(minutes + 60) % 1440`.
- `currentEvening(memberId, date, minutes, …)` batches only seats with that
  effective time.
- EventId: `game-evening-private:<member>:<date>:<minutes>`. sourceRef:
  `<member>:<date>:<minutes>`.
- `chat-lifecycle` `processPrivateEveningIntent` parses the new sourceRef.
  - Prod has no legacy receipt. As of 2026-11-17 it has 0
    `game-evening-private:` mailbox wakes and 0 `game_private_evening`
    receipts, against 11 room `game-evening:` wakes and 3 `game-dm:` wakes.
  - Review finding 4: after its 30 minutes, unsent work is skipped
    (`game_private_evening_expired`) and published work stops being polled
    (`retryAfterAt = null`), the same as the room's evening.
- Policy schema refine accepts the eventId with or without `:<minutes>`. It
  must compare minutes against the policy, so the policy gains no field: the
  suffix is checked as an integer 0..1439.
  - This reader half goes into #5125 (runner not yet deployed), so one runner
    deploy carries it before this Web change sends it.
- Pause, after review finding 2: dispatch rewrites a receipt's template and
  source but keeps its idempotency key.
  - Read the member's published `game-evening-private:<member>:` wakes from
    the last 28 days (at most 30, unique `(user_id, dedupe_key)`).
  - Look up their receipts by idempotency key, take the last three accepted,
    then run the inbound check since the third.
  - Notification wakes in prod date back to 10-18, and 117 of 125 have no
    expiry, so 28 days of history is available.
  - "Three days" becomes "three texts", at any of their times.

### Carry-over (`reminder-preferences.ts`, `private-kickoff.ts`)

- `carryOverGameReminderPreferencesTx` also carries `reminderMinutes` from the
  previous seat, unless `reminder_minutes_chosen` exists for the new seat.
  That fact is written only for seats a save actually chose (see Scoped
  writes).

### iOS (murph-ios, separate PR)

- `GameReminderSettings` gains `gameMinutes`.
- Each game row in Settings › Notifications shows its time. Tapping the row
  opens the same time drawer, for that game only.
- The top time becomes "Other games" or "Default", with the wording to be
  decided while building.
- The footer "One push a day, however many games you're in." is replaced.
- PUT sends `gameMinutes`.
- Before that ships, old builds keep working: they set the default, and games
  with their own time keep it.

## Constraints

- Technical constraints:
  - Runner parses Web tool responses and notification policies with strict
    zod. Reader halves (`games[].minutes`, eventId suffix) must be deployed in
    runners before Web sends them.
  - Instruction budgets (description 850 B, declaration 1250 B) and the
    complexity guard (≤20, no new debt).
- Product/process constraints:
  - No member messages are sent by operators.
  - No old iOS build compat beyond not breaking decode.
  - ReviewGPT plan review before build.

## Deploy order

1. #5125 (reader halves: response `games[].minutes`, private eventId
   suffix): merge, then runner `pnpm cf:deploy`, then confirm convergence.
2. This PR: merge. Web deploys the migration and the per-game behavior. Then
   the runner deploy updates descriptions and guidance, right away.
   - Between the two deploys, the old #5125 description still says one time
     covers all games.
     - In a group chat, new Web moves only that chat's games. The old wording
       can make the confirmation sound broader, but the write is narrower.
     - In the direct chat, the old wording leads to minutes without a game.
       That moves every game, which matches what the reply says.
     - This lasts minutes.
3. murph-ios PR goes into the next TestFlight build.

- Rollback: revert the runner first, then Web.
  - With a new runner on old Web, `{gameId, minutes}` would move every
    game's time while the reply names one game.
  - Old Web ignores the nullable column, so every game falls back to the
    profile time.
  - Old Web cannot parse three-part private sourceRefs. Before reverting Web,
    skip any `awaiting_generation` `game_private_evening` receipts. Prod has
    none so far.

## Risks and mitigations

1. Risk: a duplicate push on deploy day. A member whose window is open across
   the deploy may already hold the old `(member, day)` claim, and the new
   `(member, day, minutes)` key misses it.
   Mitigation: accepted (one extra push, once). Option: for one release, also
   check the legacy key. Review decides.
2. Risk: a time moved after that day's push fires a second push at the new
   time.
   Mitigation: accepted. The member asked for that time.
3. Risk: the private text wording says "evening" for midday slots.
   Mitigation: this already happens today with a noon profile time. Note it;
   no change here.
4. Risk: iOS shows the default time as "Remind me at" until the iOS PR
   ships.
   Mitigation: ship the iOS PR in the next build.

## Tasks

1. #5125: private policy eventId refine accepts `:<minutes>`, with a test.
2. Migration + Prisma field.
3. Contract/command `gameMinutes`, `readGameReminders`, `saveGameReminders`,
   choice event, with Postgres tests.
4. Push sweep slots, with Postgres tests: two slots, title per slot, claims.
5. Private evening slots, eventId, sourceRef parse, pause query, with Postgres
   tests.
6. Direct tool + group `set_reminder` targeting, with Web tests.
7. Carry-over of minutes, with an activation Postgres test.
8. Runner descriptions and guidance, budgets, game-tools tests, and a live
   journey for "pullups at 9pm, others stay".
9. ARCHITECTURE.md.
10. murph-ios PR.

## Decisions

- Nullable per-seat override instead of a required per-seat time: no backfill,
  and old iOS keeps working.
- Deploy-day duplicate push accepted (risk 1). There is no legacy-claim check.
  Prod has 5 game profiles. Review agreed.

## Review outcomes (ReviewGPT architecture, 2026-11-17)

Response: `audit-packages/plan-game-reminder-per-game.md`.

1. P1, conversation edits as whole-member replacements (lost updates, stale
   default write-back, unscoped choice facts): accepted.
   - Fix: `timeForGameIds` scoped writes; see Tools.
   - Tests:
     - Concurrent single-game edits plus a default change all survive.
     - The own-time choice fact is scoped, so another game's activation still
       inherits.
     - An own time equal to the default stays put.
     - `gameMinutes` + `timeForGameIds` is refused.
   - The group selection stays outside the transaction. The UPDATE rechecks
     that the actor's seat is live, and a game moving to another chat between
     the read and the write is not a supported flow.
2. P1, pause by template misses dispatched texts: accepted. Confirmed in
   `linq-delivery-store.ts`: the dispatch claim writes `template` and
   `sourceRef` from its own input.
   - Fix: published wakes plus idempotency keys; see Private evening.
   - The test seeds rewritten receipts across two times, plus a failed one.
3. P2, move inheritance into the live-admission transactions: rejected for
   this change.
   - Off and every-day already inherit in `activateOne`. Minutes follows the
     same owner, so moving all three is a separate refactor with its own
     cutover.
   - The review's main hazard was the flag being off. The flag is on in prod:
     the owner's direct chat used `my_game_reminders` on 11-16, and
     `handleMyGameRemindersTool` returns unavailable without it.
   - Activation runs right after the command commits. The fallback-time
     window is limited to a failed activation before the next sweep.
4. P2, private receipts never expire: accepted. Fixed with the room
   evening's transition; tested through `drainGameChatLifecycle`. There is
   no legacy two-part parsing, because prod has none (see Private evening).
5. P2, gate the semantic cutover with `MURPH_GAME_PRIVATE_REMINDERS_ENABLED`:
   rejected.
   - Turning it off pauses all private reminders and needs Web env redeploys.
   - Web-first keeps every interim write no broader than the reply says (see
     Deploy order).
   - The rollback order is runner first.
- Extra cases the review asked for, now tested:
  - Two times in one half hour send separately.
  - Two games at one time get one push (existing test).
  - A game moved after its push was claimed is dropped and reminds at the
    new time.

## Evidence (2026-11-17)

- Web game unit tests: 1860 passed. Typecheck passed.
- Postgres game suites: 915 passed, on an isolated loopback `murph_test_*` DB.
  The reminder suites alone: 59 passed, including:
  - Per-game pushes, two times in one half hour, and a moved game.
  - Per-time private texts, the rewritten-receipt pause and expiry.
  - Scoped chat and direct edits, concurrent edits.
  - Carry-over, with and without an edit to another game.
- `hosted-execution`: 1010 passed. `assistant-engine` game tools and
  instruction budgets: 120 passed. Complexity and doc checks passed.
- Live journeys (`gpt-6.1-sol`), all Ready:
  - Pullups at 9pm: `set {gameId: pullups, minutes: 1260}`. The other game
    stays at noon, and the reply names only pullups.
  - Group "remind me at 6": the confirmation is just to them.
  - Direct read and direct set.
- Provider input against the #5125 head:
  - The first requests are unchanged (124000 and 159719 bytes).
  - After `read_game`, -5 bytes (group and mixed).
- iOS: a separate murph-ios PR.

## Verification

- Commands to run:
  - `pnpm --dir apps/web exec vitest run --no-coverage` for the touched unit
    tests.
  - Postgres suites on an isolated `murph_test_*` DB.
  - `pnpm --dir packages/assistant-engine exec vitest run --config
    vitest.config.ts --no-coverage test/instruction-budgets.test.ts
    test/assistant-game-tools.test.ts`.
  - `pnpm --dir packages/hosted-execution exec vitest run --no-coverage`.
  - `pnpm complexity:diff`.
  - Live journeys.
- Expected outcomes: all green; the live reply for "pullups at 9pm" says only
  pullups moved.
Completed: 2026-11-16
