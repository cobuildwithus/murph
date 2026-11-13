# A prize both players win

Status: active (building; see "Owner decisions after review")
Created: 2026-11-12
Updated: 2026-11-12
Review: reviewed once by ReviewGPT (GPT-6 Pro, architecture preset, Mountain lane)
on 2026-11-12 against murph `9a429851d3`. Six findings, all checked against the
code and all accepted; the plan below is revised to match and each is recorded
in "Review findings" at the end. The revisions were not sent back for a second
round, and the reviewer did not have the iOS repository.

Code read at `origin/main`: murph `9a429851d3`, murph-ios `512b1d25` (build 103),
murph-cloud `faf2ad42`. Paths starting `apps/` or `packages/` are in murph; paths
starting `MurphCompanion/` are in murph-ios. No stored game carries the new
kind, so there is no data to migrate.

## Owner decisions after review

These override the text below wherever they differ; the sections are edited to
match.

- When Murph offers: only when the game is at least two thirds through,
  counted in scheduled days, both players have done every scheduled day so
  far, and at least one scheduled day is still ahead for both. This replaces
  "halfway, never before Day 3".
- Timing: the offer waits for morning. The receipt is held with the existing
  `morningAfter` rule in `private-kickoff.ts`: if it is between 9am and 9pm
  for both players it sends now; otherwise it sends at the next 9am, taking
  the later of the two players' times. The offer is judged again when it is
  built and again at dispatch, so a day missed while it is held means it is
  skipped and never sent.
- One dedicated message per qualifying game is accepted.

## Goal

When both players of a pair game are on track to finish, Murph says so once in
their group chat and offers a prize they both get if they both finish. One
player names it, the other says yes, Murph records it, and the app shows it as a
second ticket. If both do every day, both hold that prize and the game reads as
a win for both. If either misses a day, it lapses and the normal result stands.

## The shape in five lines

1. Data: a fifth stake kind, `both_get`, stored as a second entry in the game's
   existing `stakes` list, after the prize or dare. No schema change, no new
   column, no migration.
2. Settlement: a perfect game with a `both_get` stake issues two ordinary
   tickets, one each way. Without one, a perfect game still issues nothing. A
   tie that is not perfect is unchanged.
3. Trigger: the post (or counted day) that leaves both players with every
   scheduled day done at or past two thirds of the game reserves one chat
   notice for that game in the same transaction, held until morning. The
   notice's idempotency key is the game, so it can exist once. No timer, no
   sweep.
4. Agreement: the existing change path. Murph's `update_game propose` accepts a
   `both_get` stake; the other player's yes is the existing `approve`.
5. App: a second ticket, "If you both finish", and a both-win result. Older
   builds keep showing the one ticket they know.

## What exists today (verified)

- `stakes` is already a list on every terms version (`GameTermsVersion.stakes`,
  `apps/web/src/lib/game/contract.ts:20-48`); structure is stored in `game.terms`
  and words in the encrypted `termsWordsEncrypted` (`rules.ts:35-54`). Only
  validation holds it to one entry (`validNewStakes`, `rules.ts:507-511`).
- A stake change replaces the whole list
  (`change-words.ts:22-36`, `service.ts` `applyChangeTermsTx`).
- Settlement: `legacyPairStakeTickets` (`rules.ts:899-925`) skips every stake
  when the game is perfect or tied. `outcomeFor` returns `perfect`
  (`rules.ts:927-939`).
- Pair ticket code assumes one seat on each side: `ticketView`
  (`views.ts:204-234`) reads a two-seat side as "the other player left", and
  `redeem` (`service.ts:1605-1628`) looks up one debtor.
- Murph's mid-game messages: the 8pm room check-in
  (`evening-check-in.ts`) and the missed-day check-in. The check-in is sent only
  when a player still has not posted (`if (!batch.length) continue`, line 142),
  is dropped if someone posts before it sends (`isEveningBatchCurrentTx`), is
  behind `MURPH_GAME_EVENING_CHECK_IN_ENABLED`, and its policy is a strict
  schema shared with the runner (`packages/hosted-execution/src/game-group-missed.ts:34-51`).
- Plain game notices (kickoff, cancelled, change resolved) are reserved as a
  `hostedLinqDelivery` row keyed by event id inside the game's own transaction
  (`reserveGameChatLifecycleTx`, `chat-lifecycle-receipt.ts:42-62`) and sent by
  the minute cron that already runs (`drainGameChatLifecycle`, called from
  `apps/web/app/api/internal/hosted-onboarding/stripe/cron/route.ts`). They use
  the `require_send` policy, so the runner needs no new schema for one more.
- The post transaction already computes the state after the post for the push
  notification (`service.ts:1437-1443`).
- The runner validates game state and tool calls with strict enums of the four
  kinds (`packages/hosted-execution/src/game-tools.ts:18,27,82`), and Murph's
  tool allows one `prize` or `dare` in a change
  (`packages/assistant-engine/src/assistant-codex/dynamic-tools/games.ts:152`).
- The app reads `terms.stakes.first` everywhere
  (`MurphCompanion/Game/Live/GamePrototype+Server.swift:228,653`) and decodes an
  unknown kind as `.unknown` without failing (`GameWire.swift:36-45,839-848`).
  A waiting change is drawn from `change.stakes?.first`
  (`GameProtoChange.swift:725`).

## Design

### 1. Data: a fifth kind in the existing list

Add `both_get` to `GAME_STAKE_KINDS`. A pair game's stakes are one `prize` or
`dare`, optionally followed by one `both_get`. The server always stores the
prize or dare first, so every reader that takes the first entry (older app
builds, history, reports) is unchanged.

Why this and not a second stake field on the game: the list, its keys, its
encrypted words, versioning, moderation, the change path and tickets by
`stakeKey` already carry any number of stakes. A separate field would need its
own column or JSON slot, its own words, its own change shape and its own ticket
link. Why not a kind that replaces the prize: the owner wants both tickets on
the game at once.

Rules (`rules.ts`, `changes.ts`, `change-words.ts`):

- Create is unchanged: exactly one `prize` or `dare` (`validNewStakes`). Setup
  is out of scope.
- A change may name at most one prize-or-dare and at most one `both_get`
  (new `validChangedStakes`, replacing the `validNewStakes` call in
  `assertEditableWords`). Pair games only.
- A change replaces only the slot it names. One small pure function,
  `mergeStakeSlots(current, delta)`, keeps an unnamed slot's entry and key and
  puts the prize or dare first. It is called in the two places that already
  build the next version: `prepareGameChangeWords` (the next encrypted words)
  and `applyChangeTermsTx` (the next structural terms, under the game lock).
  This is what keeps a both-win prize when an older app build edits the prize
  with a one-entry list, and what lets Murph send only the both-win entry.
- The waiting change stays what it is today: the entries the player asked to
  change, with keys made once at proposal time. `readPendingGameChanges` is not
  touched.
- A game whose current stake is a legacy kind (`winner_gets`, `per_miss`) keeps
  today's whole-list replacement and cannot take a `both_get`.
- A new `both_get` entry is refused, at proposal and again at approval, when
  either player already has a closed missed day (the "still earnable" rule in
  section 3). The check runs in `assertEditableWords` on the requested entries
  only, so a prize edit on a game whose both-win prize has already lapsed is
  not refused. An ask that was fine when made and is approved after a miss
  expires through the existing refusal path.
- Not in the first version: removing a both-win prize. It can be reworded by a
  new ask. It costs nothing if they ignore it. Add removal only if someone asks.
- A rematch does not carry it: the app sends one stake, and create allows one.
  `readPairGameRematchNotice` ignores `both_get` when it compares the two games,
  so "same game" still reads as the same game.
- Moderation needs no change: every kind that is not a dare is checked as a
  prize (`moderation.ts:35`), so money is refused here too.

### 2. Settlement and tickets

In `legacyPairStakeTickets`: for a `both_get` stake, when nobody missed a day,
push two tickets with that stake key, seat 0 owed by seat 1 and seat 1 owed by
seat 0. Otherwise nothing. Other kinds are untouched, so a perfect game still
skips the prize or dare, and a tie that is not perfect issues nothing at all.

Two single-seat tickets rather than one ticket with both seats on each side:
every pair ticket path (view, wallet, mark done, 14-day expiry, blocks, account
deletion) works on them unchanged. One shared ticket would need a new branch in
each of those. The cost is that each player marks their own done, and Murph's
game state lists the prize once each way; one sentence in Murph's read rules
covers that.

`outcomeFor` and the stored result do not change. The outcome stays `perfect`;
"a win for both" is the app and Murph reading `perfect` plus a `both_get`
ticket.

### 3. Trigger, once per game

Two pure rules in `rules.ts`, both taking `now`, built from the existing
`completedEntry`, `isScheduledDay`, `dayIndexAt` and grace primitives:

- `isBothWinEarnable(state, now)`: neither player has a closed scheduled day
  without a completed entry, each judged on their own clock and with the
  existing grace hour. An any-N-days game has no missed day, so it is earnable
  until it ends.
- `isBothWinOfferDue(state, now)`: a live pair game on a set-days schedule,
  with a prize or dare and no `both_get` yet, that is earnable, where both
  players have completed at least two thirds of the game's scheduled days
  (completed scheduled days >= ceil(2 * total scheduled days / 3)), and at
  least one scheduled day is still ahead of `now` for both (not yet completed
  and not yet closed).

Reservation: one helper, `reserveBothWinOfferTx`, given the game state after a
day became complete. When the offer is due, the game has a bound chat and no
change is waiting, it calls `reserveGameChatLifecycleTx` with a new kind
`both_win` (event id `game-both-win:<gameId>`). `createMany` with
`skipDuplicates` on the event's idempotency key makes it once per game for
good, including after it is skipped. The receipt's `retryAfterAt` is the later
of the two players' `morningAfter(now, timeZone)`, so the minute cron leaves
it alone until then. It is called from the three places a day
becomes complete: `post`, and the credit and restore branches of
`setDayCompletion` (`service.ts`). A counted day still sends no push. If a
change is waiting or there is no chat, nothing is reserved and the next
completed day tries again.

Delivery, in `chat-lifecycle.ts`: add the template to `LIFECYCLE_TEMPLATES`, map
it in `processGameChatIntent`, live games only, bound chat only (never creates a
chat). One check, `isBothWinOfferCurrent` (offer still due and no change
waiting), runs in both places a notice is judged:

- when the notice is built (`lifecycleInstructions`): if it fails, the receipt
  is marked skipped, not retried;
- at final dispatch: `game-both-win:` is added to the event-family regex in
  `readGameProposalDeliveryPlayers` (`chat-delivery.ts:106`) and gets its own
  branch in `assertGameProposalDeliveryCurrentTx`
  (`chat-delivery-authority.ts:38-54`), under the game lock like the others.
  Today an unknown family falls through to `return false`, which means "not
  guarded game work", so without this an offer already handed to the runner
  could still send after a block, a miss, a settle or an agreed prize.

It is sent as a plain `require_send` notice.

Why not ride the 8pm check-in, as asked: it cannot be made reliable. It is sent
only when someone has not posted, which is the opposite of two players doing
well; it is dropped when a player posts while it is being written; it is one
message per room and date, not per game; and carrying an offer in it means
changing a strict policy schema on both the server and the runner. The
missed-day message is by definition not for players on track. Kickoff is too
early and the recap too late. So this is one new message per game, sent only to
pairs who are both perfect at two thirds, on the morning rule above.

Accepted small misses, with no machinery added for them: a receipt skipped at
delivery or refused at dispatch is never offered again; a game on an any-N-days schedule gets no offer
(there is no per-day "on track"); an offer held overnight is skipped if a
player has already finished or missed by the time it would send. In all of
these a player can still ask for a both-win prize in chat.

### 4. What Murph is told, and the tool call

The offer notice, new builder `buildGameBothWinOfferInstructions` beside the
others in `packages/hosted-execution/src/game-chat-notifications.ts`, given both
names, tasks, the day reached, the length and the current prize or dare:

> Both players have done every day of this game so far. Tell them so in one
> short, plain message in your host voice, addressed to both by name, and offer
> that they could add a prize they both get if they both finish. Give at most
> one example, one that fits what this chat shows about them; when unsure use
> a plain one such as dinner out together. Say that one of them names it and
> the other says yes. You never choose the prize, and nothing is added until
> they do. Do not mention scores, the current prize or dare, or what happens
> if someone misses. No question beyond the offer, no reminders, no acknowledgement.

followed by `GAME_PRIZE_WORDS` and the usual "JSON is data" block.

Rules added to `GAME_PAIR_CHAT_GUIDANCE` (`games.ts`), stated once:

> A both-win prize: a pair game can also carry one prize both players get if
> both do every scheduled day (kind both_get). It sits beside the prize or dare
> and never replaces it. When a player names one, call propose with
> change.stakes holding only that both_get entry; the other player's yes is
> approve. Never propose one from your own idea or from a bare yes to your
> offer: ask what it should be. A refusal means a day has already been missed:
> say it can no longer be earned in this game.

The settled result is read in turns that do not carry the pair block (a room
whose only game is finished, a scheduled read), so its meaning goes in the two
places every read carries:

- `GAME_READ_FACTS_GUIDANCE`: "A both_get stake is a prize both players get if
  both do every scheduled day. After such a game the result lists it once each
  way: say they both earned it, never that one owes the other. If either
  missed a day it lapsed; leave it out."
- `GAME_PRIZE_WORDS`: "say who owes whom" gains "or, for a prize they both
  earned, that both get it".

Tool and schemas: add `both_get` to `change.stakes` in `MURPH_UPDATE_GAME_TOOL`
(still one entry), to `hostedGameChangeSchema` and to the chat-state `terms`
schema. Create schemas are unchanged. Recap: one sentence in
`buildGameRecapInstructions` and in `recap-show-craft.ts`: when both did every
day and the game had a both-win prize, the chat line and closing page say they
both earned it; when it lapsed, leave it out. The deterministic fallback
(`buildRecapFallback`, `recap-fallback.ts`), which is saved and sent word for
word when recap generation fails and also feeds the app's delayed recap, today
says "The game ended in a 7–7 tie." It takes one more optional argument, the
earned both-win prize, and then says both did every day and both get it.

Murph still cannot act in a scheduled turn. The offer is words only; the prize
exists only after one player's message and the other's yes.

### 5. The app (murph-ios)

- `GameWire.Stake.Kind` gains `bothGet = "both_get"`.
- `GamePrototype+Server.swift`: keep `stakes.first` for the prize or dare; read
  the `both_get` entry into one new optional string on the game model. Wallet:
  show a held `both_get` ticket, drop the owed one.
- A second ticket under the existing one wherever the game's ticket shows
  (week drawer `GameProtoWeek.swift`, Home going row and Prizes
  `GameProtoPrizes.swift`).
- Result (`GameHomePageModel.swift:468-520`, `GameWinnings.swift:200`): a
  perfect game with a `both_get` ticket reads as a win for both.
- Waiting change (`GameProtoChange.swift:725`): pick the entry by kind and
  label a both-win ask as such.
- The app's own prize edit is unchanged; the server keeps the both-win prize.
- No setup screen changes.

What an older build (103 and earlier) shows once the server returns it:

- Live game: the one prize or dare ticket, as today. No second ticket.
- A waiting both-win ask: the same pill, "in the group chat". If they open the
  change sheet it reads as the prize changing to the both-win words. Murph's
  chat message words it correctly and the yes is given in chat.
- After a perfect game with a both-win prize: the result card still says
  "Perfect game. Nobody owes anything.", while Prizes shows the prize once as
  held and once as owed. Mark done works.
- Nothing fails to load: the unknown kind decodes as `.unknown`.

### 6. No group chat

Do nothing in the first version. The trigger requires a bound chat. Every game
that has started in production has one. Adding an app-side offer would mean an
approve button the app does not have.

## Deploy order

The new kind is durable state. `parseStoredTerms` and `parseStoredStake` reject
a kind they do not know, `readHome` hydrates a player's games together, and the
runner's state schema is strict, so one game with a `both_get` entry, even a
waiting ask, breaks Home and `read_game` on any Web or runner build that
predates the kind. Runner rollouts also run old and new generations side by
side for a while. So readers ship first, the writer second, the trigger last.

1. murph PR A, readers only. Every parser and schema accepts `both_get`
   (contract, stored terms, pending change, hosted state and change schemas),
   settlement, the slot merge, the final-send guard for `game-both-win:`, the
   read rules, `GAME_PRIZE_WORDS` and the recap fallback. Nothing can write the
   kind yet: the change validator still refuses it and Murph's tool does not
   offer it. Web deploys on merge; deploy the runner from main and confirm no
   older runner generation is still serving. This is the rollback floor for
   both Web and runner from here on.
2. murph-ios PR and a TestFlight build, any time after step 1. Not a hard
   dependency (older builds degrade as described above), but ship it before
   step 4 so the first offered game looks right.
3. murph PR B, the writer. The change validator accepts `both_get` with the
   earnable check, Murph's tool enum and the pair rules gain it. Web deploys on
   merge; deploy the runner. Changing the tool schema rotates each game chat's
   provider thread once (existing bounded replay); say so in the PR.
4. murph PR C, the trigger (the two rules, the reservation helper and its three
   call sites, the lifecycle kind, the offer builder). Merge only after the
   runner from step 3 is confirmed live. This ordering is the gate; there is no
   flag.

Rollback: any of B or C can roll back to A or later. Nothing rolls back behind
A once it has been live with B, because a waiting ask is already enough to
strand a game. Rolling C back leaves the guard from A in place for notices
already handed to the runner. Roll forward otherwise.

## Scheduled-work cost

None added. No Temporal Schedule, no new sweep, no new query in the minute cron
(it reads the receipts it already reads). Per offered game: one notification
wake of the room's runtime, about 8 Temporal actions at the measured rate, and
one model turn. The agreeing conversation is ordinary chat turns. murph-cloud
is not touched.

## Testing

Deterministic first (`pnpm test:diff`, focused files):

- `rules`: settlement table (perfect with and without `both_get`, one miss,
  non-perfect tie, any-N-days perfect, dare plus both-win); `isBothWinOfferDue`
  table (lengths 3, 4, 5, 7, 14; weekday schedules; a miss before and after
  two thirds; last day; already has one; any-N-days; group game; two time zones;
  the grace hour; the reviewer's case of days 1 to 4 done, a waiting change,
  a miss on day 5, then a post on day 6, which must not qualify).
- change rules: slot merge both ways, an older app's one-entry prize edit keeps
  the both-win prize, encrypted-word keys equal the accepted structural keys,
  a single-prize ask made before the deploy still applies, legacy games keep
  whole-list replacement, create and group games refuse `both_get`, money
  refused, a both-win ask refused after a miss and expired when approved after
  one, a prize edit allowed on a game whose both-win prize has lapsed.
- reservation: once across post, credit and restore (the four-day restore case
  from the review), not with a waiting change, not without a chat, a counted
  day still sends no push.
- delivery: sends once; publish the notice and then block, cancel, settle, add
  a waiting change, agree a both-win prize or create a closed miss before
  dispatch, on first dispatch and on retry, and nothing sends; never creates a
  chat.
- compatibility: extend `game-tools-compatibility.test.ts` with fixtures for a
  waiting both-win ask, accepted terms and settled tickets, read through Home
  and the room read, against the PR A build as the rollback target.
- read rules: a room whose only game is a settled both-win game, a settled pair
  beside a live group game, and a scheduled read all carry the both-win
  sentence. Recap fallback: fail generation and check the saved, replayed and
  sent line; keep the perfect-without and lapsed cases.
- views: prize or dare always first; tickets view for both players.
- runner schemas; the turn-planning fingerprint test.

Live journeys (`.agents/skills/verify-murph-assistant/SKILL.md`,
`pnpm test:assistant:live -- --test "<name>"`, six or more samples each, replies
read by a person):

1. The offer, built from the production builder: one message, both names, says
   "prize", at most one example, names no prize as decided, no tool call, none
   of the banned words, no em dash.
2. Agreeing: a player names a prize, Murph makes exactly one `propose` with only
   a `both_get` entry and asks the other; the other's yes makes one `approve`.
3. A bare "sure" to the offer: no `propose`, one question asking what it should be.
4. A player asks for one after a miss: the refusal comes back and Murph says
   once that it cannot be earned in this game.
5. "What did we win?" in a room whose only game is a settled both-win game:
   says both earned it, never that one owes the other.

Recap: add a perfect-with-both-win fixture to the recap eval harness (the
offline one used for recap prompt versions) and check the chat line and closing
page on six runs. iOS: unit tests for the mapping, a Game UI scenario for the
second ticket and the both-win result, design proof per the iOS repo.

## What can be deleted

- The `min(1).max(3)` four-kind stake list in `hostedGameChangeSchema` and the
  matching `list(value, "stakes", 3)` in `command.ts` tighten to the kinds and
  count a change can actually carry.
- Not in this change, but worth a separate small PR: if `per_miss` has no game
  in production, its settlement branch, enum entries and app case can go.
- The earlier design idea of a tie rule chosen at setup is superseded for the
  perfect case by this plan and needs no code.
- From the first draft of this plan, on review: the key-comparison layer that
  rebuilt "what was asked" from a full pending list, and the prompt-only rule
  against proposing after a miss.

## Size

- murph: three small PRs (readers, writer, trigger). About 180 to 220 lines of
  source across `contract.ts`, `rules.ts`, `changes.ts`, `change-words.ts`,
  `command.ts`, `service.ts`, `chat-lifecycle*.ts`, `chat-delivery.ts`,
  `chat-delivery-authority.ts`, `recap-fallback.ts`, `game-tools.ts`,
  `game-chat-notifications.ts`, `recap-show-craft.ts` and `games.ts`, plus
  about 450 lines of tests and five live journeys. Spec text in
  `agent-docs/product-specs/weekly-game.md` and the lifecycle paragraph in
  `agent-docs/operations/imessage-deliverability.md`.
- murph-ios: one PR, about 150 to 200 lines of source in six files, plus tests
  and design proof, and one TestFlight build.
- murph-cloud: nothing.

## Proposed words

Murph's offer (the notice is model-written; this is the target):

> Ava and Bea, you've both done every day so far. Want to add a prize you both
> get if you both finish, like dinner out together? One of you name it, the
> other says yes, and I'll put it on the game.

Murph's confirmation after the yes: "Done. Dinner out if you both finish."

The ticket, live: kicker "IF YOU BOTH FINISH", title the prize in their words.
Result when both finish: headline "You both win.", line "You both did every
day.", ticket line "You both get". In Prizes: "You both earned".

## Product decisions I would change

1. Not riding an existing message. One dedicated message per qualifying game,
   sent on the morning rule after the second player posts on the first
   qualifying day (section 3).
2. Two more conditions on the trigger: a scheduled day still ahead, and a
   set-days schedule. And one new refusal: a both-win prize cannot be added
   once either player has missed a day.
3. "Both hold the shared prize" is two tickets, one each way. Each player marks
   their own done.
4. No removal in the first version, only rewording.
5. Either player can ask for a both-win prize at any time the prize can change,
   not only after Murph's offer. This falls out of reusing the change path.
6. No chat: do nothing.

## Open risks

- Resolved by the owner: a late-night second post no longer sends at night;
  the receipt is held with `morningAfter`. A post before 9pm still sends at
  once, because that is where the existing rule draws the line.
- The offer depends on the model following the notice. The live journeys are
  the check.

## Review findings

ReviewGPT, GPT-6 Pro (model verified in the run log), architecture preset,
Mountain lane, one round, about ten minutes, completion marker present, the
repository snapshot attached. Raw response:
`audit-packages/plan-both-win-prize.md` in this worktree (ignored by git). Each
finding was checked against the code before it was accepted.

1. **P1. Readers before writers, and a rollback floor. Accepted.** The first
   draft said Web and runner could deploy in either order and Web could roll
   back freely. Checked: `parseStoredTerms` (`rules.ts:996`) and
   `parseStoredStake` (`changes.ts`) throw on an unknown kind, `readHome`
   hydrates games together, the runner schemas are strict, and
   `hostedRunnerImageMatches` (`apps/cloudflare/src/hosted-runner-release.ts:42`)
   lets two runner generations serve at once. A waiting ask is enough to strand
   a game. The deploy order is now readers, app, writer, trigger, with PR A as
   the floor.
2. **P1. The offer must pass the final-send guard. Accepted.** Checked:
   `chat-delivery.ts:106` lists event families in a regex and
   `chat-delivery-authority.ts:38-54` ends in `return false` for a family it
   does not know. The offer now has one current-offer check used when the
   notice is built and again at dispatch, and the guard ships in PR A.
3. **P2. Keep the waiting change as the asked-for entries. Accepted.** Simpler
   than the first draft: no change to `readPendingGameChanges`, one merge
   function used at preparation and at apply, legacy kinds keep replacement.
4. **P2. Eligibility must look at the clock and be enforced by the server.
   Accepted.** The reviewer's example (days 1 to 4 done, a waiting change, a
   miss on day 5, a post on day 6) did qualify under the first draft's rule.
   Both rules now take `now`, and a new both-win entry is refused at proposal
   and approval after a miss. This replaced the prompt-only rule.
5. **P2. Counted and restored days also complete a day. Accepted.** Checked:
   `setDayCompletion` (`service.ts:1570`) credits and restores without calling
   `post`. The reservation is one helper with three call sites.
6. **P2. The both-win meaning must reach every reader after settlement.
   Accepted.** Checked: `gameReadGuidance` (`games.ts:359-372`) adds the pair
   block only for open games, and `buildRecapFallback` writes "ended in a tie"
   from scores alone and is sent word for word. The meaning moved to the read
   facts and `GAME_PRIZE_WORDS`, and the fallback takes the earned prize.

The reviewer also said to keep: the existing stake list, two single-seat
tickets, the lifecycle queue with one event per game, the existing approval
transaction and the stored `perfect` outcome.
