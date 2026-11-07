# Private game reminders

Status: active
Created: 2026-11-06
Updated: 2026-11-06

## Goal

A game player who hasn't done today's task hears about it at a sensible time in
their own evening, without one person's reminder waking someone else. A player
in Atlanta and a player in Warsaw can't share a 7pm in one chat, and today the
only game pushes fire when someone else posts or replies, so nobody hears
anything if nobody has posted.

Product design and copy: Paper file `Murph · Game reminders`
(`01M6SGY32432CZSWX1DMPJCBCJ`). The owner approved these decisions:

- **Reminder.** One push at 7pm in the player's own time zone, only if they
  haven't posted, one per day across all their games. It names their own task
  ("100 pushups" / "Still time today."). One time for all games, push and text
  switches, and an on/off switch per game. Push is on by default once
  notifications are allowed. Every new game starts switched on.
- **Check-in.** At 8pm, if someone still hasn't posted, Murph asks: "Hey Ava,
  are you going to do your pushups today?" It goes in the group chat when
  everyone is within 3 hours of each other. When they are further apart it is a
  private text, only for someone who said yes.
- **Far apart.** 3 or more hours apart: at kickoff Murph says nothing about
  reminders at all. Closer than that, the existing chat offer stays.
- **Private texts and the DM.** Anyone with a plan or AI usage left. The game
  alone does not grant private Murph.
- **New-person DM.** When a game with someone new goes live, Murph texts each
  eligible player privately and offers help, using its existing
  behavior-followthrough skill. Held overnight (9pm to 9am local) until 9am.
- **Carry-over.** Same person, same rhythm: no message, reminders carry over and
  use the new task. Same person, new rhythm (weekday pushups to 3 lifts a week):
  Murph asks how it should check in.
- **Ask drawer.** One line changes: "Plus a reminder if you haven't."

## Success criteria

- A kickoff between players 3+ hours apart mentions no reminders.
- On a scheduled open day with no post, a player with a capable build gets at
  most one push at their reminder time, naming their own task or tasks, and none
  when they've posted, excused, are on a day off, before Day 1, after the end,
  or after leaving.
- A close-together room gets at most one Murph check-in per evening, addressed
  to everyone still open, and it stays quiet when that was already covered.
- A far-apart player who opted in gets at most one private check-in per evening.
- Settings and chat change the same saved values.
- The owner's journey replays: a US and Poland pair gets no chat offer, each gets
  a 7pm local push, and neither is messaged at the other's 8pm.

## Existing seams (verified on main, 8a1ecf23c9)

- Kickoff copy: `buildGameKickoffInstructions`
  (`packages/hosted-execution/src/game-chat-notifications.ts`). It already has
  each player's `timeZone`; nothing compares them.
- `GAME_REMINDER_GUIDANCE` (`dynamic-tools/games.ts`) governs chat reminders via
  ordinary room automations.
- Minute job: `drainGameChatLifecycle` in the Stripe cron route, 180s budget,
  10 receipts per drain, 4 workers, oldest receipt per chat first.
  `reserveDueGameMissedDayCheckIns` runs at its top, sharded by minute-of-hour.
- Next-morning missed-day check-ins: `hostedLinqDelivery` receipts
  (`game_missed`, `game_group_missed`), `missed-check-in.ts`,
  `group-missed-day.ts`, delivered by wake with a dedicated response policy that
  the runner parses.
- `allow_send_or_skip` is an existing runner policy already used by polls and
  phone calls, so a turn may stay quiet with no runner change.
- Egress: `assertGameProposalDeliveryCurrentTx` dispatches on the event key
  prefix and returns false for unknown keys.
- Push: `post-notification.ts`, `deliverGamePush`, `companion_push_route` (one
  row per member, `alertsAllowed`, `gameSessionId`). `apple-push/send.ts` sends
  no `sound`; iOS requests only `.alert`. iOS opens a game only for
  `game_post`/`game_reply`.
- Game tools exist only in group scope
  (`isConversationGameReadAvailable`), and `requireExactGameChat` refuses
  anything but the room.
- First-contact egress has three authorities only
  (`imessage-deliverability.md`). The DM therefore requires an existing direct
  route; it never opens one.
- Web deploys on merge. The Cloudflare runner deploys by manual dispatch from
  main HEAD. A new Web producer that needs new runner behavior must be gated.

## Design

This is the design after the ReviewGPT architecture round. Findings and their
outcomes are under Decisions.

### Reminder eligibility

`apps/web/src/lib/game/reminders.ts` is a thin composition of existing rules
(`needsPostToday`, `eligibleFromDay`, `attemptsUsed`, `liveEntry`, `scorePlayer`),
not a new rules owner. A player is open on a game day when they still need a post
and can still make one: the day is scheduled and unclosed, no excuse, and attempts
remain. `{ count }` games add urgency separately: outstanding credit is positive
and remaining opportunities are at or below the shortfall. "Every evening" skips
urgency, never posting eligibility. Game-day facts use the frozen game zone.
Notification timing uses the member's current profile zone.

### 1. Far-apart kickoff (PR #4714)

`gameZoneSpreadHours` compares clocks at one instant. 3 or more hours apart: no
offer and no mention of reminders. No runner dependency.

### 2. Settings, capability and the push

Additive migration, all with defaults:

- `game_profile.reminder_minutes int not null default 1140`
- `game_profile.reminder_push boolean not null default true`
- `game_profile.reminder_text boolean not null default false`
- `game_player.reminder_off boolean not null default false`
- `companion_push_route.game_reminders boolean not null default false`

One `setReminders` command through `runGameCommand` owns every write: Settings
now, chat later. `GET`/`PUT /api/game/v1/me/reminders` leave Home unchanged.
`canText` stays false until private texts ship.

Capability lives on the current push registration. The game route declares
`gameReminders: true`; a registration that omits it clears it, so an old build
replacing the route loses reminders. A wearable registration keeps the value only
for the same address.

The sweep runs in the minute job, pages live seats and groups by member, with a
30-minute window, and shares the drain's deadline. The claim is
`GameEvent.commandKey` `game-reminder:<hash(member, localDate)>`, member-wide even
though anchored to one game. It is one best-effort attempt: at most one push a
day, not guaranteed delivery. After claiming, one fresh projection of the
member's open games builds the title, body and navigation target just before
sending. APNs expiry matches the window. The payload gains a sound.

### 3. The 8pm check-in in the chat

- Recipients decide eligibility: the room's authorized audience, not just seated
  players. Every recipient needs a known zone and the spread must be under 3
  hours, else the room gets no check-in.
- The horizon is stable: the latest 20:00 across every eligible scheduled slot,
  following the missed-day pattern, and independent of who has posted. The
  addressed players are filtered afterwards. The window is 30 minutes from that
  horizon, ending any retry.
- Room timing uses the frozen game zones, so the horizon stays stable. If everyone
  in a room travels together it's off by that offset, and their profile zones still
  decide whether the room is close enough.
- Receipt: template `game_evening`, event `game-evening:<roomId>:<date>`,
  `payloadOwnerMemberId` the room. `readOldestReceiptPerChat` uses that owner for
  the new families so rooms don't share one queue slot.
- A typed `game_evening_check_in` policy carries the frozen witness (addressed
  game, member and day set, terms versions, `expiresAt`, conversation watermark),
  like the group missed-day policy. Web revalidates it under locks at publication
  and dispatch, so a post, leave, opt-out, terms edit or new chat message stops
  the message. The runner only parses it and permits a skip.
- Egress: currentness and the 28-day pause exemption become two decisions.
  Evening sends must stay subject to the pause.
- Pause rule: no reservation when the last 3 evening events were accepted and no
  player has written since. Read by immutable event identity, because delivery
  rewrites `source`, `sourceRef` and `template`.
- `MURPH_GAME_EVENING_CHECK_IN_ENABLED`: off unless exactly `true`, until the
  runner has the policy.

### 4. Private texts, the DM and carry-over

Order: additive Web support with producers off, then the runner, then enable.

- `update_game` gains `set_reminder`, and a direct-scope adapter
  `murph.my_game_reminders` (`read`, `set`) shares the same Web projection and
  command. Its authority is the runtime member. It is not `read_game`, which stays
  tied to the room. Results say whether the saved reminder will reach the player.
- New game reminder requests go to `setReminders`, not ordinary room automations,
  once that path is live. Bounded legacy automations expire on their own.
- Private messages are Linq only. Telegram has no final game or pause check at
  egress, so `canText` is false there and the push still goes.
- Private check-in: `game_private_evening`, event per member and date, for open
  games no room check-in covers, when `reminder_text` and `canText` hold, on an
  existing thread (`requireThreadDelivery: true`). Same witness and pause rules.
- The new-person DM is a bounded offer on the existing output-only notification
  path. No skill loading and no interactive tools in that turn: the reply lands in
  the normal direct conversation, where behavior-followthrough applies.
- Each player's activation (game go-live, or a late group join) copies
  preferences from the validated `previousGameId`, else the latest same-people
  game, and evaluates the DM with key `game-dm:<gameId>:<memberId>`. Rhythm
  compares normalized schedule and duration, not task words.

## Risks and mitigations

1. Daily unanswered messages harm iMessage line health. Mitigation: the 3-evening
   pause, one message per room, and the 28-day pause, which still applies.
2. Default-on push for builds with no off switch. Mitigation: capability on the
   current push registration.
3. Rollback after a new-family wake is queued: old egress treats an unknown key as
   ordinary proactive work. Keep the Web rollback floor until those wakes expire
   (30 minutes) or drain.
4. Burst at 8pm: 10 receipts per drain. Delivery degrades to dropping, never late.
5. AI cost: one turn per room per evening someone hasn't posted, on the game's
   included usage; private ones use the member's own. The flag stops it.
6. A push can be lost after its claim. Accepted, and stated as at most one.

## Tasks

1. PR #4714: far-apart kickoff.
2. Web PR: settings, capability, eligibility, push sweep.
3. PR: evening check-in with runner policy, flag off. Merge, deploy runner, enable.
4. murph-ios PR: Notifications page, ask line, sound, `game_reminder` route,
   capability on registration.
5. PR: private texts, DM, carry-over, chat writes, with the same rollout order.
6. Specs: `weekly-game.md`, `ios-game.md`, `ARCHITECTURE.md`, account data docs.

## Decisions

ReviewGPT architecture round (Mountain lane), findings and outcomes:

1. One owner for reminder preferences: accepted. All new writes go through
   `setReminders`. Rejected migrating existing automations: they are bounded and
   their game link lives in free text, so matching could touch unrelated ones.
2. Validate the exact prepared message: accepted. Typed witness for text, fresh
   projection for push. The generic policy can't carry a witness, so the claim of
   "no runner change" was wrong; evening needs a runner deploy.
3. Separate recipients, horizon and addressed players: accepted.
4. Split currentness from the pause exemption: accepted, verified at
   `linq-egress/engagement/route.ts:141,234`.
5. Capability on the push registration: accepted; `reminder_capable_at` deleted.
6. Consumers before producers both ways, plus a rollback floor: accepted.
7. Explicit receipt ownership: accepted, verified in `readOldestReceiptPerChat`.
8. Compose existing rules: accepted, including the count-game fix.
9. Lineage first and per-player activation: accepted.
10. DM as a bounded offer: accepted. The owner's flow still works, because the
    coaching starts at the reply.
11. Push guarantee: accepted, reworded to at most one attempt.

Answers: minute sweep, `GameEvent` for push, `hostedLinqDelivery` for text,
separate private adapter, copy at activation.

## Verification

- Deterministic tests for `openGameDay`, spread, sweep claims, egress recheck.
- Real-Codex journeys for far-apart kickoff, evening check-in and the DM.
- iOS build, UI tests and visual proof for the Notifications page.
