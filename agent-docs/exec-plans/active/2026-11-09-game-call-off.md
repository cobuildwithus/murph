# Call off a live game when every player agrees

Status: active
Created: 2026-11-09
Updated: 2026-11-09

## Goal

Owner ask (2026-11-09): players can stop a game mid-game, or at any point in its
lifecycle, when everyone in the game agrees. Murph does it through its existing
game tool in the game's chat. No app UI.

Today:
- Pair `invited`/`negotiating`: `cancel_game` (unilateral) already works.
- Group `invited`, or `live` before any check-in: only the starter can
  `cancel_game` (unilateral).
- Pair `live`: cannot be called off at all ("it settles on schedule").
- Group `live` after a check-in: cannot be called off at all.

New: a `live` game (pair or group) can be called off at any time before it is
due, once every remaining seated player has said yes. It ends `void`: no winner,
no tickets, no recap.

## Design

Reuse the existing change-ask machinery instead of building a second vote
store. Add one change kind, `{ kind: "call_off" }`.

- Ask: any remaining player, via `update_game propose` with
  `change: { kind: "call_off" }` (pairs and groups; groups today accept
  `propose` only for `start_now`). The asker counts as yes. One ask waits at a
  time, the same as today.
- Agreement:
  - Pair: the other player approves (today's rule already is "everyone").
  - Group: unanimity instead of majority. `gameChangeMajority` takes the change
    kind: `approved = yes === players.length`, `declined = no > 0`,
    `yesNeeded = players.length - yes`. Votes stay final per member; a leave
    still expires the ask (roster changed); a late join adds an undecided voter.
- Freshness: the existing outdated/expired rules apply (status not live, game
  due, terms version moved). `decideChange` returns early for `call_off` right
  after the actor check and before the terms editor's calendar cutoff
  (`canEdit`): a call-off needs only `status === "live"`, a pair outcome not yet
  decided, and `!isGameDue` (ReviewGPT 1). `negotiating` pairs keep using
  `cancel_game`.
- Apply (under the existing game lock, as the first line of
  `applyApprovedChange`, before `applyChangeTermsTx`, so no terms version is
  written; ReviewGPT 5):
  1. group: `resolveGroupGameChangeTx(change_applied, tally)` with the notice
     suppressed (the cancellation notice is the one announcement);
     pair: `change_applied` event on the resolution key (keeps
     `replayChangeResolution` idempotency).
  2. `endGame(tx, gameId, { status: "void" })` (same terminal path as block,
     leave-to-one and starter cancel).
  3. `cancelled` event with payload `{ calledOff: true, proposalId }`.
  4. When the game has a chat container, reserve the `cancelled` lifecycle
     notice, exactly like `cancelInvite`. That receipt is also what keeps a
     game-funded pair room able to deliver after the game is void
     (`chat-access.ts` admits a void game with a `cancelled` event and a
     pending `game_cancelled` receipt).
  Reusing the `cancelled` event type also hides the game from Home, the same as
  every other cancellation, so iOS needs no new terminal state. Steps 2-4 are
  one shared `cancelGameTx` primitive used by both `cancelInvite` and call-off.
- Notice copy: `lifecycleInstructions("cancelled")` reads the cancelled event's
  `calledOff` flag and uses a new call-off line ("everyone agreed to call off
  the game; no winner, nothing owed") instead of the invite-cancelled line,
  which says "before it started".
- Chat only: an app-origin `proposeChange` with `call_off` is refused (no app
  proposal notice copy exists for it, and iOS has no UI). Pair approve/decline
  is already chat-only. Group app votes exist on the server, so
  `respondToPendingChange` requires chat context to approve or decline a
  `call_off` (the asker may still withdraw it anywhere); other group changes
  keep app voting (ReviewGPT 4).
- Retry: the yes that calls off a pair voids it, so `canRunGameChatRequestTx`
  admits a `void` pair for an approve that carries a `proposalId`; the response
  owner then reaches `replayChangeResolution` (ReviewGPT 3).
- Fresh consent: `closedChangePayload` does not keep a declined `call_off` as a
  standing offer, so `agreeToDeclinedChange` never ends a game on an old yes; the
  decliner's later "ok, call it off" becomes a new ask the other side confirms.
- `latestTermsAuthor` (reports) skips an applied `call_off` (at most one per
  game, and it is the last change), so it never names the call-off asker as the
  terms author.

### Contracts touched

- `apps/web/src/lib/game/contract.ts` `GameChange` gains `{ kind: "call_off" }`.
- `apps/web/src/lib/game/command.ts` `parseGameChange` accepts it.
- `packages/hosted-execution/src/game-tools.ts`: `hostedGameChangeSchema` and
  the chat-state pending schema gain `call_off`; `yesNeeded` max 6 → 9
  (unanimity in a 10-seat game).
- `packages/assistant-engine/.../games.ts`: change `kind` enum gains `call_off`;
  pair and group guidance replace "a live pair game cannot be called off" with
  the call-off rule (explicit request to end the whole game only, never from a
  joke, a missed day or frustration; quiet after the deciding yes because the
  lifecycle notice announces it). Unrelated guidance text stays byte-identical.
- Dropped during build: a `change-resolution.ts` `changeKind` for `call_off`.
  An applied group call-off resolves with `answeredInBoundChat: true` (no
  resolution notice), and declined/expired call-offs never reach that path's
  kind-specific copy, so it would be dead code.

### iOS

`GameWire.Change.Kind` decodes unknown kinds as `.unknown` and the change sheet
renders "A change to the game" with no proposer cancel button
(`GameProtoChange.swift`). iOS has no approve/decline call. So a waiting
call-off shows as a generic pending change and nothing breaks. No iOS change.

## Deploy skew

- Web (Vercel) deploys before the runner. Until the runner deploys, its strict
  `hostedGameUpdateSchema` rejects `call_off`, and the app path is refused, so
  no `call_off` ask can exist while an old runner parses chat state. The wider
  `yesNeeded` bound is only reachable with a `call_off` ask.
- Runner rolling rollout (ReviewGPT 2): a new runner in one room can create a
  `call_off` ask that an old runner in another room of the exact same pair then
  fails to parse. Accepted for this release, not split into a runner-first PR:
  it needs the same pair in two Murph rooms, a call-off asked inside the
  ~20 minute rollout window, and it is a read failure that clears once the
  rollout converges (no write, no corruption). The owner already accepts
  temporary game deploy skew. Group games have one bound room.
- Runner rollback after call-offs exist: an old runner would fail to parse chat
  state for a game with a waiting `call_off` ask. Accepted (brief, rare); a void
  game has no pending ask.
- Web rollback floor: old Web's `parsePendingGameChange` rejects `call_off`.
  Before reverting Web, clear any waiting `call_off` asks
  (`pending_change->'change'->>'kind' = 'call_off'`), or reads of those games
  fail.
- No migration. `pending_change` is JSON; `call_off` stores no words.

## ReviewGPT plan review (2026-11-09)

Mountain lane, `audit-packages/plan-game-call-off.md`. Design kept.

1. Call-off inherited the edit cutoff (`canEdit`), refusing it while one
   player's last day was over but the game was not due. Accepted: call-off
   branches before `canEdit`; test with Auckland/Honolulu players.
2. Rolling-rollout reader skew across exact-pair rooms. Partly accepted:
   recorded the skew and the Web rollback floor above; rejected the
   runner-first split for the reasons above.
3. Retry of the deciding pair yes blocked by chat authorization on a void
   game. Accepted: `void` admitted only for approve with `proposalId`; unit
   test on the admission statuses plus a postgres double-approve.
4. Group app vote route could decide a call-off. Accepted: chat required for
   call-off approve/decline; postgres test proves app votes are refused.
5. Terms writer ran before the planned branch; cancellation sequence would be
   copied. Accepted: branch first in `applyApprovedChange`, shared
   `cancelGameTx`; tests assert terms, words, length and start unchanged.

iOS fallback (unverified by the reviewer, no Swift in the bundle): checked in
murph-ios, `GameWire.Change.Kind` decodes unknown kinds as `.unknown`.

## Risks and mitigations

1. Murph proposes a call-off from a joke or a bad day.
   Mitigation: guidance requires an explicit request to end the whole game;
   the other players still must each say yes.
2. Double announcement (Murph's reply plus the lifecycle notice).
   Mitigation: same rule as `cancel_game` ("stays quiet; the lifecycle owns its
   one announcement"); group resolution notice suppressed for call-off.
3. A stale yes ends a game.
   Mitigation: asks are per proposal and closed by any no; declined call-offs
   are not standing offers; the asker can cancel; the ask expires when the game
   is due.

## Tasks

1. Contracts + parsing (`contract.ts`, `command.ts`, `game-tools.ts`).
2. Rules (`changes.ts`): `call_off` decision, unanimity tally, view `yesNeeded`.
3. Service: allow group/pair `propose call_off` from chat only; apply path;
   declined-offer exclusion; `latestTermsAuthor` skip.
4. Lifecycle copy for called-off games.
5. Murph tool schema + guidance.
6. Tests: postgres pair (ask → approve → void, cancelled event, notice reserved,
   Home hides it; decline then re-ask needs fresh yes; app-origin refused;
   not-live refused), postgres group (unanimity: majority not enough, one no
   closes, last yes voids), unit tally, tool schema/guidance tests; one focused
   live Murph journey per verify-murph-assistant.

## Decisions

- Reuse the change-ask machinery (vs. a separate call-off vote table/events):
  it already owns ask identity, one-at-a-time, final votes, roster expiry,
  proposer cancel, replay idempotency and read_game visibility.

## Verification

- `pnpm --dir apps/web exec vitest run test/game-changes.test.ts test/game-changes-postgres.test.ts test/game-groups-postgres.test.ts` (and new call-off tests)
- `pnpm --dir packages/assistant-engine exec vitest run test/assistant-game-tools.test.ts`
- typecheck for apps/web, packages/hosted-execution, packages/assistant-engine
- `pnpm test:assistant:live -- --test "<call-off journey>"`

Results (2026-11-09):
- Web game tests: 63 files, 1653 passed. hosted-execution: 952 passed.
  assistant-engine game/tool tests: 220 passed. assistant-runtime game: 53.
  hosted-group-tool: 170. Typecheck clean (web, hosted-execution,
  assistant-engine).
- Live Murph (3 journeys, all passed): an explicit ask proposes `call_off` and
  asks Sam ("Sam, Ava would like to call off the game. Do you agree to end it
  with no winner and nothing owed?"); the other player's yes approves the
  pending ask and Murph stays quiet; venting about a hard day makes no call.
- Complete first provider input (credential-free harness, base = merge-base):
  direct +0 from this change; group and mixed +369 bytes (+0.225%), all of it
  the `call_off` enum value and its description; after `read_game` +747 bytes
  group, +1023 mixed (guidance).
