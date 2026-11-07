# Reply to their post: one note or voice note in a live 1v1 game

Status: completed
Created: 2026-11-04
Updated: 2026-11-04

## Build notes

- Reply pushes carry no title: `apple-push/send.ts` now allows a title-less alert, so the notification reads only "New voice note on your post." or "New note on your post.".
- View builds read replies only when they include a 1v1 game, so group-only and history reads keep their query budget.
- AVFoundation output at the app's settings (AAC mono, 24 kHz, 32 kbps; 1, 12 and 30 s) passes `inspectReplyAudio`; a physical-device recording is checked with the iOS release.

## Review outcome

ReviewGPT reviewed the plan against main `0a59be80`. Each finding, with
the decision (the body below already reflects it):

1. **P1, reply ownership.** Accepted. Dropped `GameReply.gameId` and the
   `GamePlayer` author FK, whose member key is nulled on account deletion
   (`retainDeparturesTx`) and would fail a required column. Now: unique
   `entryId` to `GameEntry` and `authorMemberId` to `GameProfile`, both
   cascading. The account-deletion branch is deleted.
2. **P1, post removal isn't a delete.** Accepted. `withdraw`, retake and
   `removeGamePostForReview` keep tombstones, so the cascade never fires.
   `deleteEntryReplyTx` runs inside those three transactions.
3. **P1, replay after delete.** Accepted. A content-free `GameEvent` receipt
   `game-reply:<replyId>` (actor, game, `payload.entryId`) makes a late
   retry of a deleted reply a no-op. It is separate from the per-post push
   claim. The note about the Terms gate running before replay is recorded.
4. **P1, one visibility authority.** Accepted, except the lock change.
   `replyReadAccess` serves hydration, audio, report validation and push
   revalidation. The audio route authorizes the object, not just the bearer.
   The "any report either way" rule is now stated as new and reply-only.
   Rejected: adding `lockGamePair` to `report()` and reply creation. A
   cross-game report and reply race leaves at most an unread row, because
   every read and the push recheck `replyReadAccess`. Changing the lock
   order of an existing safety path costs more than that.
5. **P1, reply reports.** Accepted. `entryId` stays null for reply reports,
   `@@unique([reporterMemberId, replyId])`, the stored report is recovered
   before the live reply is required, Ops removal dispatches to the reply
   delete, and the queue selects columns explicitly. The rollback statement
   now names this release as the floor once replies exist. Rejected: an
   "off" build or flag ahead of time; a forward fix covers it.
6. **P2, voice validation.** Accepted. `inspectReplyAudio` requires one
   `soun` track with one `mp4a` entry, samples in bounds, and takes
   `mdhd` as the stored duration. Its fixtures include real Apple AAC
   encoder output.

Also adopted from the review's retained parts: the 365-day sizing,
`oneLineWords` semantics (UTF-16 `length`), and extracting only the shared
delivery part of the post notifier. One point raised for the native side,
whether old apps tolerate a `game_reply` push: `CompanionWakeRelay.gameID`
ignores unknown values, so a tap just opens the app (see Push).

## Goal

In a live two-player game, either player can answer the other's post with one
short typed note or one voice note of up to 30 seconds. The note belongs to the
two players. Murph's AI never reads, transcribes, relays or receives it. The
receiver sees it on the sender's card on Home, never on a copy of their own
post. The founder approved the interaction in Paper ("Murph Game Show 2", page
"Reply to their post"); this plan settles how to build it with the least new
machinery.

## Success criteria

- One reply per post. In a 1v1 only the other player can reply to a post, so
  this is one row per entry, enforced by a unique key under races and retries.
- Every artifact kind (photo, words, reps, heart rate, route) can be replied to;
  excuses cannot. Prove it is unchanged and stays photo-only.
- Typed notes: 1 to 140 characters, the same limit and validator as a words
  post, through the same text filter. Voice: AAC in M4A, at most 30 seconds,
  at most 400 KB, no transcript anywhere.
- One push, ever, per post that gets a reply; content-free copy:
  "New voice note on your post." / "New note on your post."
- Replies earn nothing: no points, streaks, score, completion credit, receipts,
  typing indicators or reminders. They never enter the recap, share cards,
  Murph's chat, `read_game`, model input or events with content.
- The author can delete their note at any time; the receiver isn't told.
  Report and block reach replies through the existing report and block paths.
- Deleting the post, the game or either account deletes the reply with it.
- Old apps keep working; the backend is live before the iOS build ships.

## Scope

In: `maxPlayers === 2` games with `status === "live"` and not due, replies to
the opponent's current visible non-excuse entry on any day of that game.
Reading, playing, deleting and reporting work after the game ends.

Out: groups, threads, replies to replies, editing, text plus voice together,
reactions, transcripts, receipts, an inbox or history screen, Murph's chat.

## Evidence that shaped the design

| Source | Consequence |
| --- | --- |
| `apps/web/prisma/schema.prisma` `GameEntry`: `textEncrypted`, `mediaKeys`, player FK `onDelete: Cascade` | Content lives on product rows, sealed per member, and goes with its player and game. A reply is the same shape: a small row with a cascade from its entry. |
| `game/crypto.ts` `sealGameText`, `sealGameMedia` (returns an envelope string) | Text and bytes already seal to strings bound to a row and owner. A voice note fits in a sealed column; no new store is needed. |
| `game/account-deletion.ts` `applyGameAccountDeletionTx`, `retainDeparturesTx` | Kept games delete the leaver's entries and null their seat's member key. Replies cascade from the entry and from the author's `GameProfile`, with no new deletion code. Games and entries have no time-based retention, so replies need none either. |
| `game/http/command-route.ts` `respondToGameCommand`, `BODY_LIMIT_BYTES = 64 KiB` | One write path for all game commands. A voice note is too big for 64 KiB, so this route takes a per-route limit. |
| `game/service.ts` challenge path (`gameChallengeKey`, `tx.gameEvent.findUnique({ where: { commandKey } })`) | One-per-target actions use a unique key inside the game lock; replay returns the earlier result. |
| `game/views.ts` `visibleEntryIds`, `entryView`; `rules.ts` `hasUnlockedDay`, `isGameDue` | Visibility, unlock and due state already decide what a player may see. Reply eligibility reuses them, not a parallel rule. |
| `game/post-notification.ts` claim + `deliverGamePostNotification`; `apple-push/send.ts` | Pushes are claimed by a unique `GameEvent.commandKey` in the write transaction and sent once after the response. Replies reuse both. |
| `game/moderation.ts` `moderateGameCommand`, `gameCommandTexts` | Words posts, talk-it-over notes and excuses share one local text filter. Typed replies join it. |
| `game/http/auth.ts` `NEEDS_CURRENT_TERMS` | New content writes require current Terms; removal and safety actions do not. |
| `game/report-review.ts` `snapshotTextEncrypted`, `snapshotMediaKeys` | Reports keep a copy of what was reported for human review. A reply report keeps a copy too. |
| `legal/privacy-policy.md` line 66 lists "audio" among information members provide; line 146 says excuse recordings are deleted on the phone | No current sentence becomes false. See Privacy below. |

## Backend design

### Storage: one table, audio inline

`GameReply` (`game_reply`), additive migration:

| Column | Notes |
| --- | --- |
| `id` | client UUID, PK |
| `entryId` | FK `GameEntry`, cascade, **unique** (one reply per post in a 1v1); the game comes through the entry |
| `authorMemberId` | the replier; FK `GameProfile`, cascade, indexed (the author's account owns the reply's lifetime) |
| `kind` | `text` or `voice` |
| `textEncrypted` | `sealGameText({table: "game_reply", rowId: id, field: "text", memberId: author})` |
| `audioEncrypted` | `sealGameMedia({bytes, key: "game_reply:" + id, ownerMemberId: author})` |
| `durationMs` | voice only, from the file, 1 to 30 500 |
| `levels` | voice only, `Int[]` of 32 values 0 to 100 for the drawn waveform |
| `createdAt` | DB clock |

SQL CHECK: text has `textEncrypted` only; voice has `audioEncrypted`,
`durationMs` and 32 `levels`.

Why audio in Postgres, not R2 or Cloudflare Images: a 30 second note is
about 120 KB at the 32 kbps the app records (cap 400 KB). A game of the
longest allowed length (`GAME_MAX_LENGTH_DAYS = 365`) has at most 730 live
replies, one per visible post; metadata reads stay small because views never
select audio. Inline storage makes delete, post delete, game delete and
account delete plain row deletes, with no upload staging, orphan sweep, Worker
deletion fences, storage-path changes or signed-link signer. Readers select
columns explicitly; only the playback route and the report path select
`audioEncrypted`. A test asserts the view query never selects it. If replies
later grow beyond 1v1 or to longer audio, moving bytes to the existing
encrypted R2 envelope path is a contained change.

`add "game_reply"` to `GameSealTarget.table`. No content, digest or link enters
`GameEvent`, logs, telemetry or push payloads.

### Commands and routes

New command types in `contract.ts`, `command.ts`:

- `replyToPost {gameId, entryId, replyId, kind: "text", text}` or
  `{..., kind: "voice", audio (base64), levels}`. Unknown or mixed fields are
  rejected. Duration is read from the file, never the body.
- `deleteReply {gameId, replyId}`.

Routes (thin, same envelope as the other game writes):

- `POST /api/game/v1/games/[id]/entries/[entryId]/replies` through
  `respondToGameCommand` with a new `limitBytes` option of 600 KiB for this
  route only (400 KB base64 is about 534 KiB). Returns `{ok, game}`.
- `DELETE /api/game/v1/games/[id]/replies/[replyId]` through
  `respondToGameCommand({body: false})`.
- `GET /api/game/v1/games/[id]/replies/[replyId]/audio`: game bearer auth;
  returns the opened bytes as `audio/mp4` with `Cache-Control: private,
  no-store`, `X-Content-Type-Options: nosniff`. No signed links: the app
  downloads the small file with its normal bearer and plays it locally.

New `game/replies.ts`: pure `replyReadAccess` and `replyEligibility`, the
`GameReplyView` builder, and `deleteEntryReplyTx` (below).
New `game/reply-audio.ts`: `inspectReplyAudio(bytes)`. `service.ts` owns
orchestration in the existing locked command path.

### One access authority

`replyReadAccess(viewer, reply, context)` is the only read rule. It is used
by view hydration, the audio route, report subject validation and push
revalidation, so they cannot disagree. A reply is readable when:

- the viewer is one of the two players of the entry's game (the author, or
  the entry's owner);
- the parent entry is live (not withdrawn, not replaced, not removed) and in
  the viewer's `visibleEntryIds`, computed with the explicit hidden sets the
  views already pass;
- there is no `GameBlock` either way between the two; and
- there is no `GameReport` by either of them about the other, in any game
  (one metadata-only query by member pair). This is a new rule for replies
  only; it does not change what ordinary post, player-photo or recap reports
  do today (`readReportedBy` keeps its current meaning).

Bearer auth alone never authorizes a reply: the audio route looks up the
reply, its entry and game, then applies `replyReadAccess`, as
`serveGameMedia` authorizes each object. Game state (live or ended) does not
matter for reads. The author can always delete their own reply, readable or
not.

### Who may reply

`replyEligibility` is `replyReadAccess` from the replier's side plus:
`maxPlayers === 2`, `status === "live"`, `!isGameDue`, the target is owned
by the other player, `kind !== "excuse"`, and the slot is free (else
`409 REPLY_USED`). Under the game lock:

1. Replay first: a `GameEvent` with `commandKey: "game-reply:" + replyId`
   whose actor, game and `payload.entryId` match returns success unchanged,
   even if the reply was deleted since (no resurrection, no second push). A
   match on another actor, game or entry returns the generic conflict. A
   deliberate new reply after a delete uses a new UUID.
2. Otherwise check eligibility, then insert the reply and the receipt event
   (`type: "reply_accepted"`, payload `{entryId}` only, no content) in one
   transaction.

The HTTP Terms gate and command parsing and moderation run before the locked
step, as for every game command, so a replay after newer Terms returns
`TERMS_REQUIRED` like any other write; the app's existing Terms recovery
handles it.

Cross-game race: a report in game A and a reply in game B can commit under
different game locks. That is accepted, not locked away: the reply is still
hidden by `replyReadAccess` at every read and at push delivery, so the only
effect is an unread row, which the author can delete and which goes with the
entry. No lock-order change to `report()`.

Text uses the words validator exactly (`oneLineWords` in `command.ts`: trim,
one line, 1 to 140 by JavaScript `text.length`, i.e. UTF-16 units, which the
app already mirrors in `GameWordsScreen`) and joins `gameCommandTexts` for
the shared filter.

Voice: `inspectReplyAudio` returns the stored descriptor `{durationMs}` or
rejects. Base64 decodes to at most 400 KB. A bounded ISO-BMFF walk (depth and
box-count caps, every size in bounds) requires: `ftyp` with an M4A/MP4
brand; exactly one `trak`, whose `mdia/hdlr` is `soun`; `stsd` with a single
`mp4a` entry; `mdhd` timescale > 0 and duration giving 1 ms to 30 500 ms
(the authoritative stored duration; the 0.5 s margin covers encoder priming
and padding on a 30.0 s recording); `stsz` with at least one sample; and an
`mdat` whose sample data (`stco`/`co64` offsets plus sizes) lies inside the
file. No video or other tracks, no fragments, no external data references.
Fixtures include real recordings from Apple's AAC encoder (`afconvert`
output, the same encoder as `AVAudioRecorder`) at 1 s, 12 s and 30 s, plus
header-only, video-only, non-AAC, truncated samples, bad sizes or
timescale, and a 31 s file. Sealing runs before the transaction, as posts
do.

Add `REPLY_USED` (409) to `GameErrorCode` and `GAME_ERROR_STATUS`. Add
`replyToPost` to `NEEDS_CURRENT_TERMS`; `deleteReply` and playback stay
available without new Terms, like other removal and safety actions.

### Delete

`deleteReply` checks authorship and hard-deletes the row, in any game state,
including after a block or report. A missing ID returns success. The receiver
isn't told. Because the slot frees, the author may reply again with a new
UUID; the push claim below is keyed per post, so a re-reply sends no second
push. The `game-reply:` receipt stays, so a late retry of the deleted reply
is a no-op.

Posts are never physically deleted by product actions (`withdraw` sets
`withdrawnAt`, a retake marks the old attempt `withdrawnReason: "retake"`,
`removeGamePostForReview` keeps a tombstone), so the entry cascade does not
cover them. `deleteEntryReplyTx(tx, entryId)` deletes the attached reply
inside those three existing locked transactions (`service.ts` `withdraw`,
the retake branch of `post` near line 1093, and `removeGamePostForReview`).
A retake does not carry the reply to the new attempt. The cascade still
covers physical entry and game deletes (account deletion of a whole game,
Ops app-review cleanup).

### GameView

`GameEntryView.reply?: GameReplyView` on any entry that has a visible reply,
where `GameReplyView = {id, kind: "text", text, createdAt, mine} | {id, kind:
"voice", durationMs, levels, createdAt, mine}`. `mine` is true on the
opponent's entry (the viewer wrote it) and false on the viewer's own entry
(the other player wrote it). The opponent's entries also carry
`canReply: boolean`, from `replyEligibility`. Old apps ignore both fields; a
new app against an old backend sees no `canReply` and shows no Reply.

Replies hydrate in the app-only view builder (`buildViewInputs`) wherever
pair `dayViews` already carry entries (Home and game detail), with one
set-based read by entry IDs per view batch that never selects
`audioEncrypted`, one pair-report read, and one batched `openGameTexts`.
Visibility is `replyReadAccess`. Replies stay out of the shared
`loadGames`/`RuleState`, `readGameChatState`, `readGameRecapMaterial`,
`read_game`, share exports and assistant tools. Negative tests guard those
boundaries.

### Push

In the reply transaction, claim `GameEvent {type: "reply_notification",
commandKey: "game-reply-push:" + entryId}`. If the claim already exists (a
re-reply after delete), skip it. After the response, deliver once. Extract
only the shared part of `post-notification.ts` (route lookup, session, token,
alert permission, suspension, send through `sendApplePush`, unregistered
token cleanup); reply claim keys and subject checks stay separate, because
post validation assumes the actor wrote the post and applies daily post
milestones. Body: "New voice note on your post." or "New note on your
post.", with no title if the sender supports a body-only alert, otherwise the
same title post pushes use. Data: `{gameId, notification: "game_reply"}`.
At send, the reply must still exist and pass `replyReadAccess` for the
recipient. Expires 24 hours after sending. No retries, no reminders; this is
the posts' contract.

Old apps: `CompanionWakeRelay.gameID` accepts only `"game_post"`, so a tap
on a reply push in an old build just opens the app. A player on an old build
can get the push without seeing the note until they update. Accepted: the
game ships to internal TestFlight testers, the window is one build, and
recording app capability per member is more machinery than that window is
worth. The new build accepts both values.

### Report and block

`GameReportAbout` gains `reply`, with a nullable `GameReport.replyId` FK
`SET NULL` and `@@unique([reporterMemberId, replyId])`, matching the
per-entry report identity. For `about: "reply"`, `entryId` stays null, so
the reporter's own post is never the reported content (and the recap's
reported-entry exclusion is untouched). The existing report route accepts
`{reportId, about: "reply", replyId, reason, note?, block?}`; the reported
member is the reply's author, and the reporter must be the entry owner with
`replyReadAccess`.

Replay: `report()` first recovers an already-stored report by this reporter
(same `reportId`, or same reporter and `replyId`) and reuses its snapshot and
alert identity, before requiring the reply to be visible or present. A retry
after an alert failure works even though the first report already hid the
reply, or the author deleted it.

Evidence: text goes in `snapshotTextEncrypted` as today; voice goes in a new
nullable `GameReport.snapshotAudioEncrypted` (re-sealed under the reporter
with the report row's key). That reporter-owned copy is the existing evidence
lifetime: it outlives deletion of the live reply and of the author's account.
Ops: `readGameReportQueue` selects columns explicitly (never the audio), maps
`reply` as its own kind, and shows text inline and voice through a small
`GET /api/ops/game-reports/[reportId]/audio` behind existing ops auth.
`reviewGameReport` removal dispatches a reply report to the same locked
delete primitive the author uses; the post and its score and recap are
untouched. Report alerts, review and the 24-hour commitment are unchanged.

### Account deletion

No new branch in `applyGameAccountDeletionTx`. The author FK to
`GameProfile` deletes a leaver's replies on surviving posts; deleting the
leaver's entries cascades replies on their posts; whole-game deletes cascade
everything. This also holds on an older Web build, which never touches the
reply table. Add `game_reply` to the inventory in
`hosted-privacy/account-data-service.ts` and the deletion doc.

### Privacy

The Privacy Policy already lists audio among information members provide and
says nothing that replies would make false. A game bullet ("replies: a short
note or voice note you send on the other player's post; only that player can
see or play it, it is never turned into words or read by Murph's AI, and it is
deleted when you delete it, the post or your account") is still right to add.
But bumping the Privacy Policy version makes every game player agree again
before their next post (`launch.legal` in `legal/consent.ts`), so that edit
goes in its own PR for the founder to time. The iOS privacy manifest and App
Store label add Audio Data before App Store submission.
`agent-docs/product-specs/weekly-game.md` gets a Replies section.

## Deploy order and skew

1. Migration (additive table, two report columns) deploys before the code
   that reads it, through the normal Web deploy.
2. Web: commands, routes, view fields, push, report and deletion together.
   No Cloudflare Worker or runner change. Old apps ignore the new fields.
3. Smoke on a synthetic pair: text and voice reply, play, delete, re-reply
   without a second push, report, block hides it, account deletion removes it.
4. iOS build after Web is live.

Rollback: once the first reply or reply report exists, this release is the
rollback floor. An older Web build can't play, delete or review replies, and
its report queue would show a reply report as a post. To turn the feature
off, ship a forward fix that refuses `replyToPost` and returns
`canReply: false` while keeping reads, delete, playback and report review. No
feature flag is added.

## iOS design

Wire and client:

- `Live/GameWire.swift`: optional `Entry.reply` and `Entry.canReply`; unknown
  reply kinds decode to nil and hide only the note.
- `Live/GameAPIClient.swift`: `replyToPost`, `deleteReply`, `replyAudio`
  (downloads bytes with the bearer), report with `replyId`.
- `Live/LiveGameService.swift`: send in the background like posts. A pending
  reply is saved before the composer closes (protected file, backup excluded,
  one per entry, keyed by account and reply ID), retried with the same ID on
  failure and on next launch or foreground, cleared on success, on a definite
  refusal, on sign-out and when the server view shows the same reply ID.
  Reuse `GamePendingShotStore`'s file helpers rather than a second queue
  design. Failure shows the existing retry pill: "Your reply didn't send."

UI (new `Game/GamePostReply.swift`, built from `GameStyle` tokens):

- `GameReplyBar`: on the keyboard; surface capsule field "Reply to <first
  name>", sage caret; an ink circle with a mic that becomes Send when the
  field has text. Over 140 characters disables Send and says so.
- `GameReplyRecorderBar`: replaces the tab bar area while recording: ✕
  cancel, red dot and elapsed "0:07", live waveform, ink stop. Tap to start,
  tap to stop, auto-stop at 0:30. Stops cleanly on interruption or
  background.
- `GameReplyReviewBar`: trash, play and waveform and "0:12", ink send arrow.
  Playing is optional; Send is ready right away. Nothing autoplays.
- `GameReplySlip`: print paper, -1.2 degree tilt, soft shadow, DM Mono kicker
  ("LEO · ON YOUR POST" with ✕, or "YOUR REPLY · 8:03 AM"), Fraunces text or
  play, the 32 stored levels and the length.
- Audio sits behind a small `GameReplyAudio` protocol (permission, record,
  stop, cancel, play, levels) with an AVFoundation implementation and a fake
  for tests and `--proto`. AAC mono, 24 kHz, 32 kbps.

Home (`GameHomeCard.swift`, `Prototype/GameProtoHome.swift`):

- Photo: the tap reveal shows `[Reply] [Prove it]`, Reply first, same capsule
  style. Already replied: no Reply capsule; the sent slip shows with the
  reveal and hides with it.
- Words, reps, heart rate, route: a tap opens the reply bar directly, or shows
  the sent slip for the reveal time if already replied.
- Incoming: the oldest unclosed incoming reply shows as a slip on the
  sender's unlocked card on Home, never on the receiver's own post. A reply
  about an earlier day says "LEO · ON YOUR DAY 3 POST" (the target's day
  number). If the sender's card is locked, the note waits until it unlocks.
  ✕ closes it; closed reply IDs are kept on the phone only, per account and
  game, and survive the 3am rollover and restarts.
- Placement never covers a number: photo, words and heart rate sit about 60
  pt above the card's bottom; route sits on the map clear of distance, time
  and the Apple Maps label; reps sits below the count.
- Long press on a sent slip: Delete. Long press on an incoming slip: Report
  (existing report sheet with `about: "reply"`). Long press elsewhere on the
  card stays post Report.

Microphone: `INFOPLIST_KEY_NSMicrophoneUsageDescription` in `project.yml`:
"Murph uses the microphone only when you record a voice note to send on a
game post." Asked the first time the mic is tapped, never at launch. Denied:
the bar keeps typing and shows "Microphone access is off. You can type a
reply or turn it on in Settings." with Open Settings.
`PrivacyInfo.xcprivacy` adds `NSPrivacyCollectedDataTypeAudioData` (linked,
App Functionality, no tracking); `agent-docs/app-store-privacy.md` and the
submission packet record it.

Accessibility: labelled buttons and VoiceOver actions for Reply, Record, Stop,
Play, Send, Delete, Report and Close; the slip reads sender, day and length
once and never reads the waveform; Dynamic Type grows the slip without
covering numbers; light and dark keep the approved print-paper slip.

Prototype scenarios in `GamePrototypeScenarios.swift`: `replyPhotoActions`,
`replyTyping`, `replyRecording`, `replyReview`, `replySendFailed`,
`replySentText`, `replySentVoice`, `replyIncomingText`, `replyIncomingVoice`,
`replyEarlierDay`, `replyWords`, `replyReps`, `replyHeartRate`, `replyRoute`,
`replyMicDenied`.

## Tests

Backend unit: new `game-replies.test.ts` (eligibility and read-access tables
across kinds, game states, blocks and reports both ways, a third person with
a valid bearer, mismatched game/entry/reply IDs, replay receipts),
`game-reply-audio.test.ts` (the fixtures listed above), extend
`game-command.test.ts` (words parity), `game-moderation.test.ts`,
`game-views.test.ts` (fields, `mine`, hidden cases, no `audioEncrypted`
select), `game-routes.test.ts` (limits, auth, terms gating),
`game-post-notification.test.ts` (one claim per post, copy, no content,
suppressed when the reply is gone), `game-chat-tool.test.ts` and
`game-recap.test.ts` (replies absent).

Postgres: new `game-replies-postgres.test.ts`: two racing replies for one
post; create, delete, replay the original (not recreated); create, delete,
new reply, replay the original (new one untouched); cross-author,
cross-entry and cross-game ID reuse; reply removed by the public post
DELETE, a real retake and Ops removal (row and audio gone, audio route
404s, push suppressed); reply create racing post withdrawal under the game
lock; settled-game reads; migration CHECKs. Extend
`game-account-deletion-postgres.test.ts` (replies both ways; delete either
account in live and settled kept games and the whole game; survivor posts
and departed-seat history unchanged) and `game-report-block-postgres.test.ts`
(report a reply on your own post, Ops removes only the reply, post score
and recap unchanged; alert failure, author deletes the reply, same report
retried still works and its evidence plays through Ops auth).

iOS unit: new `GamePostReplyTests.swift` (composer states, 140 limit, 30 s
cap, permission timing, pending reply persistence and retry, closed memory
across rollover, earlier-day kicker), extend `GameWireTests`,
`GameAPIClientTests`, `GameServerMappingTests`. UI: `GamePostReplyUITests`
over the scenarios above. Screenshots against the Paper boards on a 17 Pro,
light and dark.

Must stay green: `game-challenge`, `game-media`, posting, score and recap
suites on the backend; Prove it, artifact, route and heart-rate suites on iOS.

## Files

Backend: `apps/web/prisma/schema.prisma` and a new migration;
`apps/web/src/lib/game/{contract,command,service,views,rules,crypto,moderation,post-notification,report-review}.ts`;
new `game/replies.ts` and `game/reply-audio.ts` with audio fixtures; `game/http/{auth,command-route}.ts`; three new route
files under `apps/web/app/api/game/v1/games/[id]/`; the existing report route
and one new ops route; `hosted-privacy/account-data-service.ts`; docs:
`ARCHITECTURE.md` game section, `agent-docs/product-specs/weekly-game.md`,
`docs/hosted-account-data-deletion-export.md`.

iOS: `Live/{GameWire,GameAPIClient,GameService,LiveGameService,GamePendingShots}.swift`;
`GameHomeCard.swift`, `GameProveIt.swift` (capsule lane), `GameSafety.swift`
(report a reply); new `GamePostReply.swift` and the audio controller;
`Prototype/{GameProtoHome,GamePrototypeScenarios,GamePrototype}.swift`;
`project.yml`; `PrivacyInfo.xcprivacy`; `agent-docs/{app-store-privacy,app-store-submission}.md`;
weekly-game spec.

## Open questions with recommendations

1. Name in the push? Recommend no, per the spec rule; revisit with the
   founder after testers use it.
2. Privacy Policy bullet now (everyone agrees again) or with the next legal
   update? Recommend a separate PR the founder times; nothing in the current
   policy becomes false.
3. Earlier-day note when the sender's card is locked: wait for unlock
   (recommended) rather than draw a slip over a locked card.
Completed: 2026-11-04
