# Correct a settled game from the chat

Status: completed
Created: 2026-11-14
Updated: 2026-11-14
Review: reviewed once by ReviewGPT (GPT-6 Pro, architecture preset, Mountain
lane) on 2026-11-14 against murph `ebf2559721` plus this plan. Five findings:
three accepted and built, two rejected with reasons. Each is recorded in
"Review findings" at the end, and the sections above are edited to match. The
reviewer did not have the iOS repository.

Code read at `origin/main`: murph `ebf2559721`, murph-ios `a9557f6c` (build 106).
Paths starting `apps/` or `packages/` are in murph; paths starting
`MurphCompanion/` are in murph-ios.

## Goal

A player whose own day was missing when a two-player game ended can still have
it counted by telling Murph in the game's chat, for 7 days after the game ends.
The result, the records and the prize follow the corrected days. After 7 days
the game is final. Today the same request is refused with `GAME_NOT_LIVE` and
the result stays wrong.

## What exists today (verified)

- Murph's chat tools are `read_game` and `update_game`
  (`packages/hosted-execution/src/game-tools.ts`). `update_game` with
  `mark_complete`, `mark_incomplete` or `restore_day` becomes the
  `setDayCompletion` command (`apps/web/src/lib/game/service.ts`
  `runGameChatUpdate`, `setDayCompletion`).
- Who may do what while live (`rules.ts` `decideDayCompletion`,
  `assertCreditableDay`): only the speaker, only their own day, only in the chat
  bound to the game. `mark_complete` on a closed, scheduled day with no post, in
  a game that takes any kind of check-in, writes one words post in the player's
  own words (asked for once if not given). On a post marked not done it counts
  it again. `mark_incomplete` uncounts the speaker's own post. A photo or
  heart-rate game, a day off, an open day and a day whose post was taken down
  are refused. No proof is asked and the other player is not consulted.
- `GAME_NOT_LIVE` comes from `requireLivePlayer` (`status !== "live"`) and the
  `isGameDue` check in `decideDayCompletion`.
- Settlement (`service.ts` `settleLoaded`, `rules.ts` `decideSettle`) writes
  `game.result` (per-seat score and misses), `settledAt`, `status = settled`,
  one `game_ticket` row per owed prize, one `settled` event, and reserves the
  recap chat message. It sends no push and starts no rematch.
- Derived on every read from `game.result`, never stored: winner, tie or
  both-win (`outcomeFor`), each person's won/lost/tied record (`readGameHistory`),
  Murph's chat state.
- Stored: tickets (the prize line and the Prizes wallet). A ticket can be marked
  done by its holder (`redeem`), and expires 14 days after it was created.
- `both_get` (#4916 to #4918): when both players did every scheduled day,
  `decideSettle` issues the both-win prize as two tickets, one each way, and no
  prize or dare ticket.
- Recap: written once by a model turn after settlement from the result at that
  time and stored in `game.recapEncrypted`. It states the winner in words (chat
  line, story pages, song). Replacing it is an Ops-only regeneration that
  generates new pictures and a song.
- Rematch: a separate game created from the previous game's terms. Nothing in
  it reads the previous result.
- Money: stakes are player-typed text and money stakes are refused
  (`moderation.ts`). No code reads a result, winner or ticket and then charges,
  pays, refunds or grants credit. The group fund and sponsor refills are AI
  usage credit for a chat room. They key on the game's `status` and `settledAt`
  (`chat-access.ts` `GAME_CHAT_SETTLED_ACCESS_MS`, 7 days), never on the result.
  So a correction cannot move money as long as it leaves `status` and
  `settledAt` alone and adds no Murph turn of its own.
- iOS (builds 104 to 106): Home, the result card, past games, records, the
  Prizes wallet and the recap's score and prize pages all show the server's
  `result`, `record` and tickets, refetched on foreground. The day dots come
  from the day rows. Nothing on the device freezes a settled result. The app has
  no way to offer a correction itself. It ignores unknown push types.
- After settlement only two things can make the stored result differ from a
  fresh `decideSettle`: an Ops takedown of a post ("the settled result stays",
  `removeGamePostForReview`) and account deletion.

## Design

One rule changes: `decideDayCompletion` also accepts a settled two-player game
whose `settledAt` is less than 7 days old. Everything else about who can correct
what is the live rule, unchanged, including that a player can uncount their own
day (live games allow it, so the window does too). No new tool, operation, error
code, table, column or migration.

1. Rule (`rules.ts`). A settled game passes when it has two seats, both players
   are still in it, and the database clock is within the window of `settledAt`.
   The window is the existing 7 days the game chat stays open after the end:
   the constant moves to `rules.ts` and `chat-access.ts` imports it, so Murph
   can correct a game exactly as long as it can be reached in that chat. Outside
   the window the refusal is `GAME_NOT_LIVE: This game ended more than 7 days
   ago, so its result is final.` A group game (10 seats) keeps today's refusal.
   The days of a finished game are the days that had started when it ended: a
   pair that both finish early settles before its last calendar day, and a date
   after `settledAt` is refused like a day that has not started. Every day
   before that cutoff is closed, so no day of a finished game is "still open".
   A pair game that has ended by its clock but is still stored as live (the
   seconds between Murph's read and the write, or the opponent's last post in
   between) is settled first inside the same lock, by the existing
   `settleLoaded`, and then takes the correction as the finished game it is.
2. Write (`service.ts` `setDayCompletion`, under the existing game row lock).
   The day change is written exactly as today (a words post, or the
   `incomplete` flag). Then, only for a settled game, the result is settled
   again from the same `decideSettle`:
   - Guard: `decideSettle` on the state before the change must equal the stored
     result. If it does not (a takedown or a deleted account since the end), the
     correction is refused, so one player's correction can never lower the other
     player's score.
   - `game.result` is replaced. `status` and `settledAt` do not change.
   - Tickets are made to match the new decision by one helper that settlement
     also uses (at first settlement there are no tickets, so it creates all of
     them). Tickets are matched by stake and by who owes whom, counting
     duplicates (a legacy per-miss game owes one ticket per missed day). A
     ticket still owed is kept with its id and dates, a done one before an open
     one. A ticket no longer owed is left alone if it was already marked done;
     if it is open it is removed, with its id, stake, seats and created time
     kept in the audit event (owner decision, 2026-11-14). A newly owed ticket is created. Because a ticket can
     now disappear, `redeem` treats a ticket that is gone under the lock as the
     existing `TICKET_NOT_HELD` refusal instead of a server error.
   - Audit: the existing `day_credited` / `day_restored` /
     `day_marked_incomplete` event (actor, day, time) plus one new
     `result_corrected` event with the scores before and after and the tickets
     removed (id, stake, seats, created time) and added.
3. Chat message. The correction happens inside the turn where the player asked,
   so the one message is Murph's reply. When the outcome changed (who won, a
   tie, or both-win), Web returns the exact line in the existing optional
   `chatLine` field of the tool response, for example "Sam's check-in for
   Friday, November 6 now counts. Sam won 6–5." The result sentence is the one
   the recap fallback already uses. When the outcome did not change, nothing is
   added and Murph gives its usual one-line confirmation that the day counts.
   No push and no separate announcement.
4. What Murph is told (`packages/assistant-engine` `games.ts`). Today the
   runtime drops a finished game's days and sends the day-correction rule only
   while a game is live, so Murph could neither see which day was missed nor
   pick the finished game over a live rematch. Web already sends day statuses
   (`progress`, optional in the shared schema) for every game; it now sends them
   for a settled game only while that game can still be corrected. The runtime
   keeps the days of a finished game that carries them and sends the existing
   day-correction rule for it, with one sentence added: it works for 7 days
   after a game ends. No new field, so the deployed runtime's strict schema
   still parses every response. When a result carries `chatLine`, Murph replies
   with that line. Three details keep what Murph sees equal to what the write
   accepts: the days are listed as of the moment the game ended (so the
   calendar days after an early finish are not shown as missed); they are not
   sent when the stored result no longer matches the posts (the write would
   refuse); and a finished game that lists its days counts toward the existing
   several-games rule, so Murph asks which game when a date fits a live game
   and a finished one.

## What each derived surface does

| Surface | After a correction |
| --- | --- |
| Winner, tie, both-win | Updates (read from `game.result`). |
| Records | Update (derived on read). |
| Prize line and wallet | Update (tickets reconciled). A prize already marked done stays as history. |
| Day dots, streaks | Update (the day row gains a counting post or loses its flag). |
| Recap | Left as made. The app's own score and prize pages inside it follow the new result. Murph's written pages and song may name the old winner, so when a recap exists the chat line ends with "The recap was made before this change." No regeneration: it would spend on new media for every correction. |
| Rematch | Untouched, whether proposed or live. |
| Both-win offer | Never sent for a settled game (`isBothWinOfferDue` requires live). A correction that makes the game perfect issues the both-win prize the players already agreed. |
| Pushes | None. |
| Group fund, refills | Untouched (`status`, `settledAt` unchanged, no extra Murph turn). |

## Failure modes

- Both players correct at once: serialized by the game row lock; the second
  recomputes from the first's result.
- Repeat of the same correction: `already_complete`, no event, no ticket change.
- Rematch live: the correction names the settled game's id; the rematch is a
  different row.
- Prize marked done, then the result flips: the done ticket stays; a newly owed
  prize is created. Both are true history.
- A correction that lands while the first recap is still being written (minutes
  after the end) can produce a recap with the old result and no note. Accepted:
  rare, and Ops can regenerate.
- Count-mode game (any N days): a counted day past the target changes no score,
  so no message.
- Account deleted or a player left: the chat no longer matches the game's
  players and the request is refused as today.
- The write commits and its response is lost: the retry confirms the day
  (`already_complete`) without the result line. The result, record and prize
  are correct and visible in the app and in Murph's next read. Accepted.
- Murph sees the five most recently finished games of a chat, fewer when more
  than five games are open there, and the last 14 days of each. A correctable
  game or day outside that is still accepted by the write but Murph cannot see
  it. Accepted at current use (one or two games per pair).

## Deploy order and skew

- No migration, no Temporal change, no app change.
- Web deploys on merge. The deployed runtime already sends `mark_complete` for
  a settled game (the alert shows it), so corrections work at once. Until the
  Cloudflare runtime is deployed, Murph's reply confirms the day but may not
  say the result changed: the deployed runtime's strict response schema already
  has the optional `chatLine`, so the response parses, and the model sees the
  line as data beside the old one-line rule.
- Runtime deployed before Web, or Web rolled back: old Web sends days for every
  settled game, so Murph sees them and the rule for up to five finished games,
  tries, Web refuses with "This game has ended.", and Murph says so. Rows
  written by corrections (a late words post, a `result_corrected` event) are
  readable by old Web.
- App builds 104 to 106 show the corrected result on the next foreground fetch.

## What could be deleted instead

- The feature is the removal of one refusal for 7 days; no new surface is added
  to hold it.
- Not built: a new tool or operation, a review flow, a reopen-to-live state
  (it would re-run settlement, move `settledAt` and the billing window), a
  ticket "void" status (every reader and app build would need to know it), a
  result-changed push, recap regeneration.

## Tests

- `apps/web/test/game-rules.test.ts`: the live rules on a finished game, the
  window's two edges, group and changed-roster refusals, the early-finish
  cutoff, days listed as of the end, dev clock.
- `apps/web/test/game-settled-correction-postgres.test.ts` (new): loss to tie
  to win with records, wallet, audit trail and recap note; no message when the
  outcome is unchanged; outside the window; own days only; both players at
  once; rematch live; both-win game; done ticket kept; ticket removed while
  being marked done (exact interleaving and a free race); duplicate legacy
  per-miss tickets; a due game settled once and then corrected; takedown guard.
- `apps/web/test/game-groups-postgres.test.ts`: a settled group game refuses
  both corrections inside the pair window.
- `packages/assistant-engine/test/assistant-game-tools.test.ts`: which rules a
  read carries, what Murph is shown of a finished game, the result-line rule.
- `packages/hosted-execution/test/game-tools-compatibility.test.ts`: the
  response parses with no new field, including against the runner deployed
  before this change (opt-in skew case).
- Live journeys (`verify-murph-assistant`): changed result, finished game
  beside a live rematch, past the window, and a date that fits two games.

## Decisions for the owner

Confirmed on 2026-11-14:

- Window length: 7 days, tied to how long the game chat stays open.
- A player can also uncount their own day after the end (same as live).
- The recap is left as made, with the one-sentence note.
- The one chat message is Murph's reply in the same turn, with server-written
  copy. No push.

- An open ticket that is no longer owed is removed, with its content kept in
  the correction's audit event. A ticket already marked done is never touched.

## Review findings

- Attempt 1 (2026-11-14, Mountain, GPT-6 Pro): the prompt was accepted and the
  model worked for about four minutes, then the thread showed "Connection
  interrupted. Waiting for the complete answer" and produced nothing more for
  over an hour while four later reviews on the same lane finished. No answer and
  no marker, so it does not count as a review. Its visible working notes named
  three gaps, each checked against the code and folded into the plan above
  before the second attempt: a date after an early finish (the `settledAt`
  cutoff), Murph not seeing a finished game's days or choosing it over a live
  rematch (the `progress` signal), and duplicate legacy per-miss tickets
  (matching by count).
- Attempt 2 (2026-11-14, Mountain, GPT-6 Pro, fresh conversation, about ten
  minutes): a complete review ending in the marker. It kept the core design
  (the existing command, the game row lock, `decideSettle`, the shared ticket
  writer, fixed `status` and `settledAt`, the result-consistency guard, no new
  tool or field) and recommended removing open tickets over a void status. Its
  five findings:
  1. Discovery: `readGameChatCandidateIds` returns at most five settled games,
     fewer when the chat has more than five open, so a sixth game finished in
     the same week is not shown to Murph. It proposed a historical cursor on
     `read_game`. **Rejected.** A pair needs six games to end in one chat inside
     one week to hit it; the fix is a new request argument with its own
     Web/runtime skew for a case current use does not reach. Recorded as a
     limit under "Failure modes".
  2. One definition of correctable games and days for the write and for what
     Murph sees. **Accepted**, three parts built: days are listed as of the end
     of the game; days are withheld when the result-consistency guard would
     refuse; a correctable finished game counts toward the existing
     several-games rule. Its fourth part, days older than the 14-day chat
     window in a long game, is recorded as a limit: the write accepts them.
  3. Ticket removal makes a concurrent `redeem` throw (`findUniqueOrThrow`
     under the lock) and surface as a server error. **Accepted**: a ticket gone
     under the lock is the existing `TICKET_NOT_HELD` refusal. Tests added for
     the race and for duplicate legacy per-miss tickets with done and open rows.
  4. A game that becomes due between Murph's read and the write is still stored
     as live and would be refused. **Accepted**: the correction settles a due
     pair game inside its lock with the existing `settleLoaded`, then applies
     the finished-game rule. One settlement, one recap reservation.
  5. Recover the result line after a lost response by making the correction
     event a keyed command receipt. **Rejected.** It adds an idempotency key,
     accepted-input plumbing into the game command and replay phrasing for a
     post-commit transport failure whose only loss is one sentence; the state
     is correct and visible. Recorded under "Failure modes".
Completed: 2026-11-14
