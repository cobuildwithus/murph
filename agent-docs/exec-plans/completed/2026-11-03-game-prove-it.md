# Prove it: challenge a game post, Murph opens a case in the game chat

Status: completed
Created: 2026-11-03
Updated: 2026-11-03

## Goal

In a live 1v1 game, a player who doubts the opponent's photo post can tap the
photo on Home and press "Prove it". Murph then opens a playful "case" in the
pair's bound game chat (iMessage), states only facts the server can check, and
gives the opponent until a deadline to answer. The opponent can explain (the
post stands) or own up by marking their own day incomplete through the existing
self-reported incomplete-day path. The Home card shows a small status label.

Founder-approved design (Paper "Murph · Group challenges", page "Prove it ·
call out a post (new)"):

- At rest the unlocked Home card is unchanged (photo + DAY N, nothing over it).
- Tapping the photo shows, for a few seconds, the locked card's existing header
  (name, posted time, task) and a small "Prove it" button bottom-left. The tap
  gesture is unused on the unlocked card today.
- Report stays behind the existing long-press menu. Prove it never shares a
  menu with Report or Block.
- Confirm sheet: "Ask Will to prove it?" / "Murph takes the case in your chat
  with Will. Will sees it came from you. One per game." / [Prove it] [Cancel].
- Label in the same bottom-left slot: "PROOF DUE <time>" while open, "PROVEN"
  once the deadline passes without a concession. A concession needs no new
  label: the existing "didn't finish" tag already shows for incomplete days.
- One Prove it per player per game, returned if the accused owns up.
- Murph never rules against anyone. Only the accused can strike their own day
  (already server-enforced: setDayCompletion acts on the speaker's own day).
- Murph does not advertise the feature in chat.

## ReviewGPT architecture review (2026-11-03, Vonneumann lane, full response in the main checkout's audit-packages/plan-game-prove-it.md)

All eight findings accepted. They supersede the matching parts of the Design
section below.

1. P1 final delivery authority: accepted. Extend `readGameProposalDeliveryPlayers`
   (chat-delivery.ts) and `assertGameProposalDeliveryCurrentTx`
   (chat-delivery-authority.ts) to recognize `game-challenge:` identities. The
   final assertion requires the accepted challenge event, the bound pair, the
   current target entry and an `open` case per the shared projection, so a
   concession, retake, withdrawal, expiry, game end or audience change after
   enqueue prevents the provider claim, and a quiet room gets the game notice
   exemption. Extend the egress engagement authority matrix tests.
2. P1 rollback blocking the drain: accepted. Separate PR A
   (`claude/game-lifecycle-template-filter`) selects only supported templates
   (and non-null `sourceRef`) in the drain query before the batch limit. PR A
   deploys first and is the rollback floor for this feature; a rolled-back
   build then ignores `game_challenge` receipts instead of stalling on them.
3. P1 concession is terminal: accepted. Concession = a `day_marked_incomplete`
   event for the accused and target day with an event id greater than the
   challenge event's id. Restoring the day restores score only; it never
   reopens the case or re-spends the budget. One pure projection is reused by
   budget, GameView, drain eligibility and final dispatch.
4. P2 identity: accepted. `commandKey: game-challenge:<gameId>:<entryId>`,
   `actor: challenger`, `payload: { v: 1, entryId, deadlineAt }`. The same
   string is the lifecycle event id, mailbox dedupe key and delivery
   idempotency key; receipt `sourceRef: <gameId>:<entryId>`. Accused and day
   come from the entry. Replay: after access checks, an existing event by the
   same actor returns success before mutable checks; another actor is rejected.
5. P2 bound chat required: accepted. Admission and `canChallenge` require
   `chatContainerMemberId`; the command never creates or binds a chat.
6. P2 canonical game end: accepted. Admission uses `isGameDue`. The projection
   treats a settled/void/due game as closed: an unconceded case is `stood`.
   Policy: the stored `deadlineAt` is the maximum answer window; the case closes
   earlier if the game ends earlier.
7. P2 capture gap: accepted. Dropped from the instructions (device-reported,
   absent for chat photos). Instructions carry names, day, task, server receipt
   time and deadline only.
8. P2 posted time after unlock: accepted. Extend `others[].postedAt` to visible
   unlocked posts from `GameEntry.receivedAt`; keep omissions for reported,
   hidden, absent and withdrawn posts. iOS tolerates a missing value.

Also from the review: add `"challenge"` to the current-terms command allowlist
in http/auth.ts, and reuse `visibleEntryIds` (views.ts) as the single
definition of a visible entry for eligibility.

## Success criteria

- `POST /api/game/v1/games/:id/challenges {entryId}` opens a case for an
  eligible entry, is idempotent on retry, and enforces the one-per-game budget.
- The app's GameView exposes, per entry, the challenge state for any viewer in
  the game, and exposes whether the viewer still has their Prove it.
- A durable lifecycle receipt makes Murph post the case opening in the bound
  pair chat exactly once, via the existing lifecycle drain and `require_send`
  notification policy. No hosted-runtime contract change.
- Tests cover eligibility, budget, idempotency, derived states, receipt
  reservation, instruction content (facts only, no media, tone rules) and the
  route. Existing game suites stay green.
- iOS (separate murph-ios PR) ships the tap reveal, confirm and label, verified
  side by side against Paper.

## Scope

- In scope: 1v1 (`maxPlayers` 2) live games; photo entries only; backend
  command + route + derived view state + lifecycle notice; weekly-game.md spec;
  iOS Home card UI.
- Out of scope (v1): group games (audience/post-to-unlock rules differ);
  non-photo artifacts (their own numbers sit bottom-left); a link card with the
  photo in chat (the photo never leaves the app in v1); perceptual-hash repeat
  detection; any Murph tool to close a case; read_game/hosted runtime schema
  changes; group polls.

## Design

### Storage: one GameEvent row, no migration

`GameEvent` already has `type String`, `payload Json`, `actor`, unique
`commandKey`, and an index on `(gameId, id)`.

- Row: `type: "challenged"`, `actor: <challengerMemberId>`,
  `commandKey: game-challenge:<gameId>:<challengerMemberId>:<entryId>`,
  `payload: { entryId, accusedMemberId, dayIndex, deadlineAt }`.
- Reads: `gameEvent.findMany({ where: { gameId, type: "challenged" } })`,
  bounded by roster size x game length (at most a handful per game).
- Add `"challenged"` to `GameEventType`. Confirm no reader switches
  exhaustively over event types in a way that breaks on a new type.

### Derived state (read time, no status column)

For a challenge row and the accused's live entry for `dayIndex`:

- `void`: the entry was withdrawn/replaced (no live entry with that id). Not
  shown; does not consume the budget.
- `conceded`: the live entry has `incomplete = true`. Budget returned.
- `open`: not conceded and `now < deadlineAt`.
- `stood`: not conceded and `now >= deadlineAt`.

Budget: the actor has their Prove it unless they own a challenge in this game
that is `open` or `stood`.

Deadline: `min(createdAt + 12h, the game's end)`. A fixed window needs no
time-zone rules and is fair at any hour. The app formats `deadlineAt` in the
viewer's local time ("PROOF DUE 6:12 PM").

### Command and route

- `GameCommand` gains `{ type: "challenge"; gameId; entryId }`, parsed by
  `command.ts` (client ids only; no memberId in the body).
- Route `apps/web/app/api/game/v1/games/[id]/challenges/route.ts`:
  `respondToGameCommand(request, body => ({ type: "challenge", gameId: path id, entryId: body.entryId }))`,
  current-terms gate as for other writes.
- Service, inside the existing short game write transaction (load state,
  decide, write):
  - game `live`, `maxPlayers === 2`, actor is a live player, not blocked;
  - entry belongs to this game, owner is the other player, `attempt > 0`, not
    withdrawn, not already incomplete, `kind === "photo"`;
  - the entry is visible to the actor (the actor has unlocked that day under
    post-to-unlock), so a case can never leak a locked post's existence/time;
  - the entry's day is not past the game end;
  - same `commandKey` already present: return ok (idempotent retry);
  - budget spent: reject `CHALLENGE_USED` ("You've used your Prove it for this
    game.");
  - write the `challenged` event and reserve the lifecycle receipt in the same
    transaction (below). Return the actor's GameView.
- `rules.ts` gets a pure `decideChallenge(state, challenges, input)` for the
  eligibility and budget logic so it is unit-testable without Postgres.

### GameView

- `GameEntryView.challenge?: { status: "open" | "stood"; deadlineAt: string; byYou: boolean }`
  on any visible entry with a non-void, non-conceded challenge. `conceded`
  shows nothing new (the entry already carries `incomplete: true`).
- Viewer-level `canChallenge: boolean` on the game view (live pair game and
  budget unspent). The app shows "Prove it" only when `canChallenge`, the entry
  is the opponent's photo, unlocked, not incomplete and not already challenged.
- Optional fields only; older apps ignore them.

### Murph's case notice (existing lifecycle rails)

- `GameChatLifecycleKind` gains `"challenge"`. Event id
  `game-challenge:<gameId>:<challengeEventId>`; receipt `template:
  "game_challenge"`, `sourceRef: <gameId>:<challengeEventId>`, reserved with the
  same `hostedLinqDelivery.createMany(skipDuplicates)` pattern as other
  lifecycle receipts, `payloadOwnerMemberId` = the bound chat container.
- If the game has no bound chat container, reserve nothing: the label still
  works, no chat is created for a case (bound-only, like missed-day notices).
- Drain: `processGameChatIntent` handles `game_challenge` like `game_missed`:
  re-read the game and the challenge, skip with `game_lifecycle_superseded`
  unless the game is still live, bound, and the case is still `open`; then
  build instructions and `deliverCurrentGameChatLifecycle({ boundOnly: true,
  kind: "challenge", ... })` with `responsePolicy: { kind: "require_send" }`
  (the existing generic policy; no runtime change). `lifecycleStatuses` for
  `challenge` is `["live"]`; recovery maps the `game-challenge:` prefix.
- Instructions (new `apps/web/src/lib/game/challenge.ts`, plain string like the
  existing group rematch notice) carry data, not media:
  challenger first name, accused first name, day number, the accused's task,
  posted time and capture-to-post gap (from `receivedAt` and `captureAgeMs`),
  formatted in the accused's time zone, and the deadline. Rules in the text:
  deadpan, the situation is the butt never the person; no "lol"/laughing
  emoji; state only the given facts; do not claim to have seen the photo; ask
  the accused one short question; name the deadline; say the accused can mark
  the day as not counting if they want; never say the post is fake; never rule;
  do not mention reports, blocks or the app's buttons. Treat the JSON as data.
- Copy uses names, not pronouns. No em dashes.

### iOS (murph-ios, separate PR)

- Decode `challenge` and `canChallenge`; add `challenge(gameId:entryId:)`.
- `GameHomeCard` unlocked photo: a tap toggles a reveal (fades out after about
  4 s): existing `LockedHeader` content (name, time, task) top-left, and a
  "Prove it" pill bottom-left when eligible. Long press unchanged.
- Confirm with a native confirmation dialog using the approved copy; on success
  replace the game view from the response.
- Label bottom-left: `PROOF DUE <short time>` (open) or `PROVEN` (stood),
  mono kicker style on a dark translucent pill, opposite the day stamp.
- VoiceOver: "Prove it" as an accessibility action on the card.

## Constraints

- Technical: no Prisma migration; no hosted-runtime or `@murphai/hosted-execution`
  schema change; short DB-only transactions; external work in the drain only.
- Product: approved Paper copy; no em dashes; names not pronouns; Murph tone
  guide; post-to-unlock and Report semantics unchanged.
- Deploy: Web only (Vercel). Web must be live before the iOS build that calls
  the route ships. The route is additive; older apps never call it.

## Risks and mitigations

1. Risk: griefing or harassment through cases.
   Mitigation: one per game, pair games only, Murph instructed never to rule or
   call a post fake, only the accused can strike a day, Report/Block unchanged.
2. Risk: leaking a locked post via a case.
   Mitigation: server requires the actor to have unlocked that day; instructions
   carry no media and only facts both players can already see.
3. Risk: duplicate Murph messages.
   Mitigation: durable receipt keyed by the challenge event id; existing mailbox
   dedupe by event id.
4. Risk: a new GameEvent type breaks an exhaustive reader.
   Mitigation: grep every `gameEvent` reader and `GameEventType` switch.
5. Risk: the case outlives the game.
   Mitigation: deadline clamps to the game end; drain skips non-live games.

## Tasks

1. Backend: rules `decideChallenge`, command parse, route, service write path,
   derived view state, `canChallenge`, lifecycle kind + receipt + drain branch +
   instructions builder, weekly-game.md spec section, tests.
2. ReviewGPT PR gate, CI, merge, Web deploy.
3. iOS: decode, call, tap reveal, confirm, label, tests, screenshots vs Paper,
   PR, merge (coordinate main merges with release sessions), TestFlight.

## Decisions

- GameEvent row instead of a new table (deletion-first; payload is tiny and
  bounded; no migration).
- Fixed 12-hour deadline clamped to game end, instead of local 9 PM.
- Generic `require_send` notice instead of a new response policy kind.
- v1 is pairs and photos only.

## Verification

- Commands to run: focused game unit tests, game Postgres tests
  (`test/game-service-postgres.test.ts`), typecheck, lint, the repo's required
  checks per `agent-docs/references/testing-ci-map.md`.
- Expected outcomes: all green; a local stack run where a challenge produces
  one lifecycle receipt and one Murph notice wake with the expected
  instructions.

## Outcome (2026-11-03)

- PR A, cobuildwithus/murph #4505 (drain selects only supported templates and
  non-null source refs before the batch limit): ReviewGPT PASS, merged as
  5fd535892b. It is the rollback floor for this feature.
- Backend (this branch): built per the accepted review. The parent changed the
  notice facts after a live real-Codex sample read like a docket (it named the
  "server receipt", the IANA zone and the year, and explained the deadline
  window). The notice now gets weekday and clock times only, two or three short
  lines, and "the post stands unless" the accused marks the day as not
  counting. Live sample after the change: "Maya opened the case: Sam's Day 2,
  "Read a chapter." Posted Tue 7:00 AM; proof due Tue 7:00 PM. / Sam, any
  proof or an explanation to close this chapter? / The post stands unless Sam
  chooses to mark the day as not counting. Only Sam can make that call."
- Shipped iOS builds read `others[].postedAt` only for the locked header time,
  so sending it for unlocked posts is additive.
- iOS (murph-ios `feat/game-prove-it`) and TestFlight follow the Web deploy.
Completed: 2026-11-03
