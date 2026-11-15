# Recap as one video in the group chat and the app's Share

Status: active
Created: 2026-11-14
Updated: 2026-11-14

## Goal

A finished pair game's recap show is also one vertical video, about 51 seconds
for the usual six story pages. Murph's recap message in the game's group chat
carries it together with the line and the "Watch the recap" link it sends
today, and the app's Share hands out the same file. A recap that cannot make a
correct video is sent exactly as it is today.

## Owner decisions (fixed, not reopened here)

- One video holding everything the recap shows, real photos included. This
  reverses "No song or scene is attached to chat".
- Every screen looks like the iOS app's recap page. No shorter cut, no
  film-rolls page, nothing tappable drawn, no play or full-screen button.
- Order: cover, each story page, each "Most likely to" card, the song page
  until the last sung word, then the last screen held to the end of the music.
- Story pages are 5 s in three beats: setup words at 0.12 s (rise 14 pt, fade
  0.42 s), picture at 0.95 s, payoff at 3 s. The cover is whole from frame one.
  "Most likely to" and the last screen stagger their pieces.
- The last screen is third person, because both players receive one file. Its
  footer is the address alone in the cover's label style, 64 pt above the
  bottom. Its prize ticket is 280 pt wide in its slot. It draws every stake the
  app's last screen does: prize, punishment slip, both-win prize, even game.
- The message keeps its link and gains the video. It does not replace the link.
- The cover is the title and the "starring" line. No label above the title:
  the recap's writer is told to leave the prize off the cover.
- A visual mistake found after launch is the failure to prevent (see the gate).
- Fixtures and proofs come from what production writes (the writer's guide in
  `recap-show-craft.ts`, the schemas, the contract fixtures), not from the
  app's built-in demo show. The demo and its screenshots are layout references
  only. Things in them that real recaps never contain: a cover label naming
  the prize, the demo's fixed sample names and photos, and a stat block (the
  writer's page kit has none, though the schema still allows one).

## What exists today (read on `origin/main` at 27407067e7)

- Generation: a Web cron queues one mailbox wake per settled game with
  `responsePolicy.kind = "require_game_recap"`. The runner's recap turn lets the
  model read material, generate scenes and one 20 s song, and call the file
  variant of `write_recap`. `executeRecapFileWrite`
  (`packages/assistant-engine/src/assistant-codex/dynamic-tools/games.ts`)
  uploads each chosen file, then sends `write_recap`. Tool handlers run in the
  runner's Node host, outside the model's sandbox.
- Storage: each file is one base64 JSON call to Web's group tool route, sealed
  by Web, staged to R2 by the Worker, content-addressed under
  `recap/<generation>/<sha256>.<jpg|mp3>`, with one `game_recap_asset` receipt.
  Acceptance seals the asset list into the recap envelope. Media is final at
  acceptance; there is no later write and no polling.
- Size ceilings on that path: 2,800,000 base64 characters per upload, 4.5 MiB
  per Web request (the platform's limit), 3 MiB per staged object, 2 MiB per
  asset in the contract, 1 MiB for a song. The envelope allows five assets and
  drops all of them when it sees a sixth.
- Serving: `GET /api/game/v1/games/:id/recap-assets/:slot?generation=` checks
  the bearer, the generation and that every source the asset was made from is
  still permitted, then returns the whole decrypted object.
- Delivery: the recap wake is queue-only. The turn queues the accepted line
  plus link in the runner's outbox and returns; the outbox dispatches later. A
  recap turn is forced text-only (`textOnlyGameNotification`). The Linq sender
  splits a trailing link off and sends it as a second message under the
  `:link` identity, so the link gets its preview card. Web sends nothing.
  `video/mp4` is an allowed attachment type.
- Regeneration (`scripts/ops-game-recap`) queues a new generation, retires the
  other generations' assets at acceptance and sends a new message.
- A first-time failure seals a plain story without an envelope.
- The runner container has 2 vCPU, 6 GiB and Debian's ffmpeg. No fonts are
  installed. Nothing on the runner draws text with the brand fonts today.

## Design

### 1. Renderer: `packages/recap-video`

A self-contained package. Input: the show's pages in presentation shape, the
two players (name, optional profile photo), the canonical outcome and stake,
image files for scenes and real photos, and a soundtrack with its cue times.
Output: one MP4 (H.264 High, 804x1748, 30 fps, AAC) and a manifest of page
boundaries.

- Every frame is a pure function of time, as in the approved reference page:
  a timeline maps milliseconds to a page and its local time; each page is laid
  out once; a frame draws the page's pieces with opacity, rise and picture
  drift computed from local time by the reference's own formulas.
- Frames are drawn with a Skia canvas (`@napi-rs/canvas`, prebuilt, no install
  script) and piped as raw RGBA to ffmpeg, which only encodes and muxes. Layout
  values, colours and fonts are copied from the reference, which copied them
  from the app. The four font files are the app's own (all SIL OFL) and are
  registered from the package under private family names, so a system font can
  never satisfy them.
- It runs as a child process with a hard timeout. A crash, a timeout or an
  oversized result is "no video", never a failed recap.
- It fails closed. Unknown page or block kinds, a stake it has no drawing for,
  a character none of its fonts cover, text that does not fit after the app's
  own shrink and wrap rules, a missing image the page has no fallback for: each
  is a typed refusal before any frame is encoded.
- Encoding is constant quality under a byte budget: a VBV ceiling computed from
  the duration keeps the file under 8,000,000 bytes; a file over that is a
  refusal.

Rejected alternatives:

- Headless browser capture of the reference page: minutes per recap and a
  Chromium in the image. The owner ruled it out.
- Still images per piece with ffmpeg filters doing the motion: it measured
  cheapest in CPU, but the motion would be written a second time as filter
  expressions that cannot express it exactly (alpha fades are linear only,
  overlay positions are whole pixels, slow zooms jitter, 49 lyric words become
  49 timed overlays), and it still needs a text rasteriser for the stills.
- `sharp` text plus a hand-written JavaScript compositor: no new dependency,
  but a private blending and resampling engine and several times the frame cost.
- `satori` plus `resvg`: two dependencies, no variable-font support (the
  display face is variable), and it still needs a compositor.

The cost of the choice is one native dependency (about 35 MB in the image,
external to the runner bundle like `sharp`).

### 2. Where each input comes from

| Input | Source at `write_recap` time |
| --- | --- |
| Pages | `presentGameRecap` run on the draft story, the same function the app's payload comes from |
| Scene JPEGs, song MP3 | The files `readGameRecapMedia` already returns, hash-checked against what the tools generated |
| Word timings | The in-memory generation receipt, aligned with `alignSongLyrics` |
| Real photos, profile photos | Fetched again by reference id into a host-only directory; the task directory's copies are model-writable and are not trusted |
| Names, scores | `material.result` |
| Outcome and stake | New `game.poster` inside the material's untyped `game` object, built by Web from the same owner the app's last screen reads: outcome (won or even), stake kind, title, icon key, who owes whom, both-win. The runner never derives a winner |

`game.poster` rides in the untyped `game` field because the material schema is
strict: a new top-level field would make an old runner reject the material.

### 3. The stored file: one video, sealed in parts on the existing rails

The MP4 is one logical `video` in the envelope, stored as up to four opaque
parts of at most 2,000,000 bytes. Each part is sealed, staged, receipted and
tombstoned by the existing recap media path under
`recap/<generation>/<sha256>.mp4`.

- The optional envelope field `video` alone owns the whole-file hash and byte
  length, duration, dimensions, one deduplicated source-reference union, and
  the ordered part descriptors. Parts carry no media metadata of their own and
  are not added to `assets`, whose limit of five stays as it is.
- The source union is bounded for the shapes the renderer draws (two contact
  sheets of nine already need 18 sources; today's per-asset limit is 16). A
  show whose union exceeds the bound gets no video; lineage is never truncated.
- Upload checks a part's size and identity. Acceptance assembles the parts
  within the byte budget and validates the complete MP4 once (contiguity,
  declared hash, box walk), outside the database transaction.
- One helper enumerates storage objects across scene and song assets and video
  parts. Acceptance verification, receipt retention and lookup use it, so
  there is one lifecycle loop. A part is served through the existing asset
  route and authorized through its parent video's source union.
- The stored reader stays tolerant: malformed `video` metadata is dropped and
  the recap stays readable, as optional media already behaves.
- The app's payload gains optional `show.video` with the part URLs in order;
  the app downloads them and joins them.

No new route, table, migration, queue, crypto format or streaming path.

Rejected: one large object by presigned upload (the bytes would skip Web's
sealing, or need a new key-wrapping format and a streaming decrypt route); a
smaller video that fits one 2 MiB object (about 330 kbit/s for picture and
sound at this size, visibly soft).

### 4. The render step

Inside `executeRecapFileWrite`, after the scene and song uploads succeed and
before `write_recap`: build the input, run the renderer child, upload the
parts, and add `video` to the write. Any failure or refusal skips the video and
the write goes ahead unchanged. The caller's abort signal is carried through
rendering and upload: a renderer timeout means "continue without video"; a
cancelled turn stops the work and reaps the renderer and ffmpeg children.

Web's first acceptance wins, and a retried write returns the earlier
acceptance without looking at the new draft. So the write and recover results
gain the accepted generation and the accepted video's identity (whole-file
hash and length), or an explicit "no video". The runner's rendered file is a
disposable candidate with no authority of its own: it may be sent only when
its hash and length equal the identity Web returned.

The step runs only when the wake's response policy carries `video: true`, which
Web sets from `MURPH_GAME_RECAP_VIDEO_ENABLED` for pair shows.

### 5. Delivery

The recap goes out as it does today, in two sends: the line, then the link on
its own so it keeps its preview card. The video joins the first send, after
the line.

- Ownership: the recap turn only queues. The final MP4 is handed to the
  outbox, which owns it until attachment preparation resolves. Turn-local
  inputs are still removed when the turn ends.
- Representation: a narrow, host-owned recap attachment, authorized by the
  accepted identity. It does not ride the approved vault-file export path
  (which needs an approval and drops companion text), and the model cannot
  produce one.
- One decision, made once: before the first message request the outbox
  persists which form it will send, the line with a prepared attachment or
  the line alone, using its existing ownership-checked compare-and-set. Missing
  bytes or failed preparation select the line alone only while no message
  request has begun. After a request may have reached Linq, every retry
  replays the persisted form unchanged. An optional video can never
  terminalize an otherwise authorized recap message.
- Authorization: before the attachment is uploaded and again at the existing
  final dispatch boundary, one shared check (media visibility plus
  `recapReferencesCurrent`, bound to the accepted generation and hash) decides
  whether the video may still be sent. If only the video has lost eligibility,
  the line and link still go. If the generation is retired or its post witness
  is invalid, the whole recap is suppressed as today. No media is read or
  decrypted inside the provider-claim transaction.
- Idempotency: the message keys are unchanged. A regeneration is a new event,
  generation and message with its own video.
- Restart: after a container restart the local file is gone; recovery sends
  the line and link without a video. Accepted for the first version.
- A plain fallback recap has no show and gets no video.

### 6. Music

The approved sample plays a 50 s score: 5 s of instrumental under each story
page, landing on the 20 s song. That score is not in the product. Its state:
an experiment kit outside the repository, with the owner's pick ("one piece")
and measurements; the model switch it needs (Eleven Music v2.5) merged as
#4981; no branch, plan or PR for the score itself. Shipping it needs its own
plan: the Worker's music egress allows one chunk and Web requires exactly a
20 s song, the app must keep a 20 s song for its song page, the singer's entry
has to be checked and retried (three of nine measured takes came in 2.5 to
5.6 s late), and the app needs cue times to play it.

The renderer therefore takes a soundtrack, not a song:
`{ file, cuesMs, songStartMs, songMs }`.

- With a score: the score's file and cues. This is the approved video.
- Without a score: 5 s per story page in silence, then the song. Pictures and
  timing are identical; the first 30 s or so have no sound.
- Without a song: no video.

Order: slices 1 to 6 land with the song-only soundtrack and the flag off. The
score lands under its own plan and only adds a second soundtrack producer; no
video code changes. Whether the song-only video may be switched on before the
score exists is the owner's call (open question 1). The default in this plan
is no: the flag stays off until the score ships or the owner accepts a
song-only sample.

### 7. Deploy skew and rollback floors

Every reader ships a release before its writer, and three formats are durable
once written, so each has a rollback floor that the flag cannot undo:

- Envelope: `gameRecapEnvelopeSchema` is strict. Web that reads `video` (and
  drops a malformed one) ships first and is the floor once one is stored.
- Wake: the recap response policy is parsed with exact keys and is persisted
  in the mailbox and in saved pending state. A runner that accepts
  `video: true`, and can carry on without making a video, ships first and is
  the floor once a video-enabled wake is queued. Turning the flag off does not
  remove the field from queued work.
- Outbox: the recap attachment representation needs a reader release before
  any intent carries it, and that reader is the floor afterwards.
- Tool results: the strict response schema gains the accepted identity only
  after runners read it.
- Upload: an older Web or Worker rejects the new slot, type or key suffix. The
  runner treats that as "no stored video".
- App: `show.video` is optional and the shipped decoder ignores unknown fields.
- Order: contracts and Web readers, Worker, runner readers, then the writers
  (Web results and material, runner render and delivery), then the flag, then
  the app's Share.

### 8. Privacy and deletion

- The video shows real photos, names and members' quoted words to the same two
  players who can already open the recap. Stored parts are sealed and receipted
  like scenes, so regeneration, a post removed for everyone, account deletion,
  the 24 h unaccepted-upload expiry and `MURPH_GAME_RECAP_MEDIA_VISIBLE=false`
  cover them with no new code path.
- The copy in the chat cannot be recalled, as with any sent message. The
  product spec and the recap contract must say that the recap message now
  carries the video, real photos included.
- The public recap link and cover preview are unchanged and never serve video.
- The render inputs live outside the model's workspace and are removed when
  the turn ends. The finished file belongs to the outbox until its attachment
  is prepared or the line-alone form is chosen, then it is removed.

### 9. Cost and time

- Measured so far (prototype, Apple M4 Max, 1,531 frames at 804x1748): 2.6 ms
  per frame to draw; 5 to 15 s wall for draw plus encode depending on the x264
  preset; under 0.5 GB for the encoder and about 0.12 GB for the drawing
  process. Slice 1's script reports the real renderer's numbers.
- Unmeasured: the 2 vCPU container. Working guess 40 to 120 s. Measurement, in
  order: slice 1's script on a Linux x86-64 CI runner pinned to two cores;
  the same script inside the built runner image in slice 4; a trace of the
  first production run. The child's timeout is 180 s.
- Money: no provider call. One to two minutes of a container that is already
  running, and up to 8 MB of sealed storage per recap for as long as the recap
  is kept.

### 10. The visual gate (before the flag is ever on)

1. Page-by-page proof: frames from this renderer beside the app's screenshots
   and the approved reference's frames at the same times, for the cover, each
   story layout, "Most likely to", the song mid-lyric and the last screen. The
   only accepted differences are the agreed ones: nothing tappable, third
   person, the address footer, the larger ticket.
2. Every shape the contract and the app's decoder allow, one frame each: zero,
   one and two cards; a story page without a picture; a failed scene falling
   back to its photo and to words alone; a pair; a contact sheet; a stat; a
   kicker; a quote over 70 characters; long titles, names, prizes and dares;
   lyrics with and without word timings; a profile photo and an initial; each
   background; a missed-day print; no song; each of the four stakes.
3. A CI check on synthetic fixtures that renders those frames and compares
   their structure, plus a contact sheet written outside the repository for
   the owner's review before the delivery slice merges.
4. Fonts on Linux: a test that fails when any bundled family is missing or
   measures differently from recorded advances, run in CI and in the image
   smoke, so a silent fallback cannot change a line break.

### 11. Regeneration and the first production run

Regeneration needs nothing new: a regenerated show renders, stores and sends
its own video through the same step. The first production video is a
regeneration of a game the owner chooses, run by the owner's session after the
gate has passed. This plan records no member, game or chat identifier.

## What is deleted instead of added

- No Web-side send, second message, queue, poll, pending state, new table or
  new route.
- The sentences that forbid chat media for recaps, in the contract reference
  and the product spec.
- The reference kit's browser capture stays outside the repository.

## Slices (one PR each, in this order)

1. Renderer core: the package, a synthetic fixture in the writer's shape, the
   structure test, the measurement script. Not wired to anything.
2. Renderer completeness: every contract shape, the four stakes, the
   fail-closed refusals, the Linux font check, the CI frame check and the
   proof sheet.
3. Storage and readers on Web: the `video` envelope field and its tolerant
   reader, part upload, whole-file acceptance, the shared object enumerator,
   presentation and serving, the accepted identity in write and recover
   results, the shared eligibility check, the Worker's key pattern,
   `game.poster` in the material.
4. Runner readers: the wake's `video` field, the recap attachment
   representation in the outbox, the accepted identity in tool results. No
   behavior yet; this release is the runner's rollback floor.
5. Render in generation: the child-process step, the image dependency and
   smoke checks, cancellation. Stored, not sent.
6. Delivery: the outbox-owned attachment and its one decision, the dispatch
   authorization, the documentation and prompt changes, the changelog entry.
7. App Share (in the iOS repository): download the parts, hand the file to the
   share drawer. Android follows the same payload.

The score is a separate plan and can land before or after slice 6. Each slice
is taken to merge-ready by the completion workflow and reported with its head,
checks and review outcome; merging, deploying, production settings and any
send belong to the owner's session.

## Risks and mitigations

1. Risk: a page that looks wrong reaches a real chat.
   Mitigation: the gate in section 10; fail-closed refusals; the flag.
2. Risk: text the bundled fonts cannot draw (emoji, non-Latin names or quotes).
   Mitigation: refusal in the first version; see open question 3.
3. Risk: the container is slower than guessed and the turn runs long.
   Mitigation: hard timeout, measured in slices 1 and 4 before the flag.
4. Risk: a Web rollback below the envelope reader after videos are stored.
   Mitigation: stated rollback floor; the reader ships a release ahead.
5. Risk: the Linq attachment upload from the runner has a size limit below the
   file. Mitigation: verified in slice 5 against the egress path before the
   flag; the text-only degrade covers a failure.
6. Risk: the punishment slip's typeface (an Apple system font) is not ours to
   ship. Mitigation: open question 2; punishment games refuse until settled.

## Open questions for the owner

1. May the song-only video (silent story pages, then the song) be switched on
   before the score ships, or does the video wait for the score?
2. The punishment slip's typeface: bundle an open look-alike (first candidate
   Cutive, SIL OFL) checked against the app's slip, or license the original
   for server use?
3. Emoji and non-Latin text: refuse the video, or bundle an open fallback
   (Noto) that will not match the phone's own emoji?
4. Minimum hold of the last screen when the song's last word lands near the
   end of the music (the sample holds 5.7 s; a song sung to its last second
   would leave under 2 s). This plan holds it at least 5 s by letting the
   picture outlast the music.

## Verification

- Slice 1: `pnpm --dir packages/recap-video typecheck`, `pnpm --dir
  packages/recap-video test`, and the measurement script's printed time and
  peak memory.
- Later slices: the focused package, Web, Worker and Postgres suites their
  changes touch, the hosted-local recap files journey, and the gate above.

## Decisions

### ReviewGPT plan review (2026-11-15, one round, before implementation)

Verdict: keep the renderer package and sealed storage; revise acceptance and
delivery before slices 3 to 6. Six findings, each checked against the code.

1. P1, accepted. Web returns the earlier acceptance on a retried write, so the
   runner could attach a file Web never accepted. Write and recover results now
   return the accepted generation and video identity; the local file is sent
   only on a match (section 4).
2. P1, accepted. The dispatch check covers the audience and the post witness
   but not media visibility or the sources a video shows. One shared
   eligibility check now runs before upload and at dispatch (section 5).
3. P1, accepted. The recap wake is queue-only, so a turn-owned file would be
   deleted before the outbox used it, and a blanket "fall back to text" could
   change a message Linq had already accepted. The outbox now owns the file
   and persists one decision before the first request; cancellation is carried
   through (sections 4 and 5).
4. P2, accepted in part. Accepted: a narrow host-owned attachment
   representation instead of the vault-file export path. Rejected: collapsing
   the recap into one unsplit message. The sender already sends the link as
   its own message so it gets a preview card, the split and its partial
   failure are tested behavior, and the owner asked for the video in addition
   to the link. The plan's earlier "one message" wording described today's
   delivery wrongly and is corrected (section 5).
5. P2, accepted. One logical video with opaque parts, whole-file validation at
   acceptance, one object enumerator, a source bound that fits the renderable
   shapes, and a tolerant stored reader (section 3).
6. P2, accepted. Queued wakes and outbox intents are durable, so each gets a
   reader release and a stated rollback floor (section 7, slice 4).

The review did not see the renderer, the iOS source or the reference kit;
visual parity and container timing stay with the gate and the measurements.

### Owner decisions recorded after the review (no architecture change)

- Scope: carry the feature through every slice to merge-ready.
- Delivery: the video is sent in addition to the recap link.
- Last screen: the address-only footer, the 280 pt ticket slot, all four
  stakes in third person.
- Cover: no label above the title. Fixtures follow production's writer.
- The visual gate in section 10 is required before the flag is on.
- First production run: a regeneration of a game the owner chooses, started
  from the owner's session after the gate has passed.
