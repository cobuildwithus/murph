# Game chats keep working when people are added

Status: active
Created: 2026-11-10
Updated: 2026-11-10

## Goal

Today a game's group text must hold exactly the game's people. Adding anyone
else silently cuts the game off from that chat: Murph stops seeing it there,
texted check-ins stop counting, scheduled chat notices are skipped, and app
actions that need the chat fail. The owner decided this is over-defensive:
Murph only writes text into the chat (photos and the recap stay in the app),
only seated players can act, and changes still need the group's yes.

Replace the rule with one sentence that covers two-person and group games:

> A game belongs to the chat it is bound to for as long as every current
> player is in that chat. Who else is there does not matter. An unbound game is
> claimed only by a chat of exactly its invited people, except that a pair's
> new game keeps inheriting the pair's established game chat.

## Success criteria

- A bound two-person or group game keeps reads, chat commands, texted photo
  check-ins, scheduled notices, the recap and game-funded runtime access after
  a bystander (Murph member or not) is added to its chat.
- A person who joins a group game by link (seat 10 and up) no longer disables
  the chat or its funding, provided they are in it.
- Unchanged: only a seated player can act; a blocked, suspended or
  consent-revoked person in the room still silences it; a current player
  missing from the room still silences it; first binding still needs the exact
  invited audience; a two-person game never appears in, or funds, a larger chat
  it is not bound to.
- Parallel membership-policy owners are deleted, not loosened one by one. No
  new stored state, flag, migration or runtime wire-contract change.

## Scope

- In scope: `apps/web/src/lib/game/**` room authority, funding, delivery and
  scheduled check-ins; their tests.
- Out of scope: any new Murph chat line about newcomers; seating or invitation
  rules; the app; prompts; the legacy chat-tool branch for runtimes that do not
  send `gameMultiplayer` (stays exact); the morning missed-day rule that one
  room batch needs a single lore fingerprint (stays; see Decisions).

## Current shape (verified by reading)

- Group games (`maxPlayers` 10) have one authority,
  `readGroupGameChatAuthority(game, room, prepared?, tx?, waitOnBlock?)` in
  `chat-membership.ts`: keyed audience equals `audienceKey` or is a subset of
  the original invitees (`isGroupGameAudienceSubset`), route current, every
  active player in the room with seat 0..9, no block or restriction.
- Two-person games have no single authority. About fifteen sites compare "the
  room's people" to the game's players (`sameGamePlayers`,
  `audience.contacts.length === 2`, `requireExactGameChat`, `requireExactChat`).
- Other owners of the same old rule: `chat-access.ts` funding SQL (seat 0..9,
  at most ten room members, pair = exactly two room members taken as the first
  two sorted ids), `readGameChatHandleAudience` and `supportsGameChatRoster`
  (room size capped at the game roster limit), `refreshGameChatAudience`
  (whole-room equality after a successful mutation), evening check-in
  (`readPairAudience`, `hasJoinedAudience`, delegation to the morning
  collector), morning missed-day (`pairMemberIds` only when the room has
  exactly two contacts).

## Design

1. **One authority.** Rename to `readGameChatAuthority`; it serves both kinds.
   - Bound to this room: route current; every current player's member id in
     `audience.memberIds`; no block or restriction among room people and
     players. Nothing about extra people or seat numbers.
   - Not bound to this room: group needs
     `audience.keys.candidates.includes(audienceKey)` and no other binding;
     pair needs a room of exactly its two people (keeps an unbound app-created
     pair game, and a pair game bound elsewhere, visible in an exact pair room).
   - "Current players" for a pair is the existing `gameChatPlayerIds`
     projection, which includes an invited rematch's addressee.
   - Delete `isGroupGameAudienceSubset` and the seat 0..9 clause.
   - `gameChatContextCurrent` calls it for both kinds when an audience was
     prepared; the audience-less legacy branch stays exact.
2. **Room evidence is validated as a room, not as a game roster.**
   `readGameChatHandleAudience` checks: group thread, complete roster, exactly
   one active sending self, normalizable distinct handles, unambiguous
   identities, usable line. It no longer self-compares through
   `isExactGameChat`/`isGameMemberSet`. Audience keys are computed only when
   the room has 2..10 people (a larger room can never claim an unbound game).
   `supportsGameChatRoster` stops capping multiplayer rooms at ten. Invitation
   size, `GAME_MAX_PLAYERS`, exact discovery and bootstrap stay as they are.
3. **Chat tool.** `canRunGameChatRequestTx` and `readGameChatCandidateIds` use
   the authority (candidates add any game bound to this room).
   `refreshGameChatAudience` keeps the fresh provider read and route but drops
   the old/new whole-room equality; the projection's per-game authority decides.
   Lore fingerprint and the `read_game` player list use the game's players.
4. **Funding (`chat-access.ts`) stays a cheap database-only admission
   projection.** Bound-room branches require the binding plus every current
   player among the room's fresh participants; drop the seat 0..9 clause and
   the exact-pair cardinality there. Exact alternate pair rooms keep today's
   derivation and the primary room's single allowance beneficiary. Raise the
   participant bound with a named constant so a room with bystanders is still
   bounded. Keep freshness, restrictions, pending-bootstrap, expiry and
   settled-window rules.
5. **Delivery carries one proof shape.** `readGameProposalDeliveryPlayers`
   returns the room audience for pairs as well; `deliveryAudienceCurrent` and
   the lifecycle append call the authority for both kinds; delete the pair-only
   array branch (`Array.isArray(authority)`, pair `sameGamePlayers` against
   room people). Expected game identities come from the loaded game. Bound-room
   sends replace `requireExactChat(room, pairPhones)` with the authority.
   `sealGameRecap` and the recap tool do the same. Blocks keep their retry
   (throw) versus superseded (null) distinction.
6. **Board.** `savePairBoardSharing` first enrollment follows the same room
   rule through `gameChatContextCurrent`: the pair's bound room with both
   players present, bystanders allowed. No Board-specific exact check. Its
   per-member verified-contact, consent and expected-membership checks stay.
7. **Evening check-in.** One prepared room audience; apply the authority to
   each candidate game independently; addressed batch and time zones come from
   each game's remaining players. Delete `readPairAudience`,
   `hasJoinedAudience` and the delegation to `readGroupMissedDayRoom`.
8. **Morning missed-day.** Pair-before-game locking and prior pair receipt
   hashes come from the pair games' own rosters (including the existing
   recently-settled lookback), not from "the room has exactly two contacts".
   Pair games in a mixed room are admitted by the authority.
9. **Stays exact, untouched:** `findExistingGameChat` / `exactChat`, chat
   bootstrap creation, `prepareGameChat`, `prepareGameChatInvite` /
   `bindGameInviteRoomTx`, the legacy non-multiplayer chat-tool branch.

## Risks and mitigations

1. Risk: a two-person game surfaces in, or funds, a bigger chat that merely
   contains both players. Mitigation: outside an exact pair room the game must
   be bound to that room, in the authority and in the funding SQL; tests.
2. Risk: Murph's text (who missed, stakes, result) is now read by bystanders.
   Mitigation: owner decision; photos and recap content never enter the chat.
3. Risk: a restriction appears between preparation and send. Mitigation: the
   authority is revalidated in the final transaction for pairs as for groups.
4. Risk: duplicate missed-day notices in a mixed room. Mitigation: design 8.
5. Risk: rollout. Web-only; an old instance still draining during deploy treats
   an expanded room as it does today (skips). That is today's behavior, so no
   regression and no coordination step.

## Tasks

Commit in three steps, each with its tests green:

1. Authority, room evidence, chat tool, funding, Board (design 1 to 4, 6).
2. Delivery, lifecycle and recap proof shape (design 5).
3. Evening and morning scheduled check-ins (design 7 and 8).

Tests to add or flip: bound pair plus member bystander and plus non-member
bystander (read, command, texted photo, notice, recap, funding with no paid
participant); link joiner in the room (authority and funding); ten players
plus a bystander through the real audience reader; unbound pair game stays
hidden in a larger room and does not fund it; a new pair game inherits the
pair's room that now has a bystander; blocked or suspended bystander still
silences; missing player still silences; bystander arriving between mutation
and refresh yields one effect and a successful response; restriction committed
after preparation stops pair append, recap seal and dispatch; pair rematch
notice with one seated creator; first Board enrollment succeeds in the pair's
bound room with a bystander and is refused in a larger room the game is not
bound to; independently eligible A/B and A/B/C games in one room at 8pm; earlier
pair missed-day receipt suppresses a later group claim with a bystander present.

## Decisions

- Owner 2026-11-10: bystanders are fine for two-person and group games; no
  newcomer announcement.
- Plan review (ReviewGPT, `audit-packages/plan-game-chat-open-room.md`), each
  checked against the code:
  1. Pair binder inherits a previous game's room. Accepted as a policy to
     state, not a defect: one primary room per pair is the binder's purpose,
     and bystanders no longer disqualify a room. The rule sentence now says so
     and a test pins it. Write order is unchanged.
  2. Funding is another owner of the old rule. Accepted (design 4).
  3. Room size borrowed the game roster limit. Accepted (design 2).
  4. Pair delivery must carry room evidence. Accepted (design 5), replacing
     the first draft's "pass the game's players downstream". The rollout
     coordination ask is rejected: old instances behave as today.
  5. Board enrollment grants health sharing. First accepted, then overruled
     by the owner on 2026-11-10 ("nah dont require this"): Board enrollment
     follows the same room rule as everything else (design 6).
  6. Evening eligibility inherits morning lore selection. Accepted (design 7).
     Morning keeps its one-fingerprint rule; rooms whose group games have
     different original audiences already get no morning batch today.
  7. Missed-day pair lock keyed on room size. Accepted (design 8).
  8. Whole-room equality after mutation. Accepted (design 3).

## Verification

- Commands to run: focused Vitest for `game-chat-membership`,
  `game-chat-tool`, `game-chat-access-postgres`, `game-chat-delivery`,
  `game-chat-delivery-authority`, `game-chat-lifecycle`,
  `game-groups-postgres`, `game-talk-postgres`, `game-board-postgres`,
  `game-evening-check-in`, `game-group-missed-check-in-postgres`,
  `game-service-postgres`, `game-chat-bootstrap-recovery-postgres`;
  `apps/web` typecheck.
- Expected outcomes: all green; `chat-membership.ts` net negative.

## Step 1 execution — 2026-11-10

- Implemented the shared pair/group authority, independent complete room
  evidence, per-game chat-tool projections, fresh post-mutation projection and
  bounded database-only funding. Removed the subset policy and addressed-seat
  requirement. `chat-membership.ts` is six lines smaller.
- Board scope conflict: this delegated task explicitly requires exact first
  enrollment, while Design 6 was changed during execution to allow bystanders.
  The implementation preserves the task's explicit exact-enrollment boundary;
  the newer plan decision remains above for the completion owner to reconcile.
- Design 5, 7 and 8 implementation is deferred. Their source files received
  only imports/calls of the renamed authority. Existing group notice behavior
  changes through that shared authority; no delivery proof shape or scheduling
  algorithm was changed. Recap tool unit tests now reach the second sealing
  attempt after fresh bystander evidence; pair recap/delivery proof remains
  step 2 work.
- Complete one-human evidence now reaches per-game missing-player rejection
  instead of throwing a malformed-roster error. Scheduled retry fixtures use
  duplicate handles to preserve their malformed-evidence coverage. This also
  means a missing-player notice can be superseded instead of retried.
- The modern `read_game` profile list comes only from returned games, with no
  profile list when no game is visible; legacy pair tools keep their existing
  profile behavior. Pair lore uses each visible game's players.
- Funding admission can count only resolved participant rows. Existing schema
  cannot distinguish an exact pair room from that pair plus unresolved handles
  without provider work or new stored state. The complete provider authority
  still withholds an unbound pair in an expanded room. This existing admission
  limitation is unchanged; the new expanded resolved-roster branch requires
  the game's binding and both fresh players. Exact alternate rooms retain one
  primary allowance beneficiary.
- Composed PostgreSQL proof covers registered/unregistered bystanders, actual
  audience reading, pair reads/lore/player lists, real command/photo bridges,
  one mutation and one photo import on replay, inherited pair rooms, ten-player
  rooms, link seats, actor rejection, restrictions and missing players. The
  existing unbound-pair scheduled-read test with an unresolved handle is
  unchanged. Funding tests cover the 32-participant bound and unpaid rooms.
- Product status: step 1 backend proof only; the whole feature remains Hold
  until steps 2 and 3 and the Board decision are complete. No prompts, runtime
  wire contract, migration or stored state changed. No live-model verification,
  public changelog, remote CI or final ReviewGPT was run for this local delegated
  intermediate commit; the completion owner retains those release gates.
- No Frog entry was created: the resolved failures were changed expectations
  and local test fixtures, not repository-actionable tooling friction.

### Step 1 verification

Used a session-owned loopback database, `murph_test_game_chat_open_room_step1`,
with all 281 migrations deployed. Final checks:

```sh
pnpm --dir apps/web test:prepared test/game-chat-membership.test.ts test/game-chat-tool.test.ts test/game-chat-lifecycle.test.ts test/game-chat-delivery.test.ts test/game-chat-delivery-authority.test.ts test/game-evening-check-in.test.ts
# 6 files passed; 174 tests passed, 1 existing gated test skipped, 0 failed.

DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/murph_test_game_chat_open_room_step1 MURPH_TEST_POSTGRES_CONCURRENCY=1 MURPH_VITEST_FILE_PARALLELISM=false pnpm --dir apps/web test:prepared test/game-chat-access-postgres.test.ts test/game-groups-postgres.test.ts test/game-board-postgres.test.ts test/game-service-postgres.test.ts test/game-group-missed-check-in-postgres.test.ts test/game-chat-bootstrap-recovery-postgres.test.ts
# 6 files passed; 398 tests passed, 0 failed or skipped.

pnpm --dir apps/web typecheck
# Passed; 0 type errors.

pnpm complexity:diff
# Passed: 9 changed source files; 0 hotspots above 20.

git diff --check
# Passed.
```

Initial runs exposed old-rule expectations and fixture omissions; final reruns
above are green. No requested suite was unavailable locally.
