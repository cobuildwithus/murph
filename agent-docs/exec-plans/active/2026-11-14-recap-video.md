# Recap as one video in the group chat and the app's Share

Status: active
Created: 2026-11-14
Updated: 2026-11-15

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
- A prize's ticket carries the app's own drawing for it. The owner approved
  bringing the app's prize drawings and their catalog into this repository.
- Emoji are drawn with Noto Color Emoji, not refused.
- The punishment slip's typeface was left to this build: Zilla Slab Medium
  (see Decisions).
- No video with silent story pages. A recap that has only a song, from before
  shows had scores, gets no video.
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
  asset in the contract, audio included. The envelope allows five assets and
  drops all of them when it sees a sixth.
- Music (since #4989): a show's music is one piece, five seconds of band under
  each story page and then the sung song. It is stored once as the `song`
  asset; Web serves it whole as the `score` slot and from the song's start as
  the `song` slot. The show carries `score` and a `cueMs` on every page but
  the result; the song page's cue is its first sung word, so a late singer
  holds the page before it. Shows from before have a twenty-second song and
  no cues.
- Serving: `GET /api/game/v1/games/:id/recap-assets/:slot?generation=` checks
  the bearer, the generation and that every source the asset was made from is
  still permitted, then returns the whole decrypted object.
- Delivery: the recap wake is queue-only. The turn queues the accepted line
  plus link in the runner's outbox and returns; the outbox dispatches later. A
  recap turn is forced text-only (`textOnlyGameNotification`). The Linq sender
  splits a trailing link off and sends it as a second message under the
  `:link` identity, so the link gets its preview card. Web sends nothing.
  `video/mp4` is an allowed attachment type. Measured on 2026-11-15 through
  Linq: Messages re-encodes an MP4 attachment to fit 960 points (the 804 x 1748
  recap arrived as 440 x 960 HEVC) but passes a QuickTime movie through byte
  for byte at any size, so the accepted MP4 bytes are uploaded as
  `video/quicktime` named `recap.mov` (`RECAP_VIDEO_LINQ_ATTACHMENT`).
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
  values, colours and fonts follow the app's source; where the reference page
  and the app differ, the app wins (see Decisions). Seven font files are
  registered from the package under private family names, so a system font can
  never satisfy them: the app's own four, Zilla Slab Medium for the punishment
  slip, and Noto Color Emoji and Noto Sans for emoji and for Greek, Cyrillic
  and other Latin letters. All are SIL OFL, with their licence texts beside
  them.
- It runs as a child process with a hard timeout. A crash, a timeout or an
  oversized result is "no video", never a failed recap.
- It fails closed. Unknown page or block kinds, an outcome and stake that do
  not go together, a character none of its fonts cover or an alphabet it
  cannot set correctly, text that does not fit after the app's own shrink and
  wrap rules (where the app would cut it short with an ellipsis), a missing
  image the page has no fallback for, a show without a score: each is a typed
  refusal before any frame is encoded.
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
external to the runner bundle like `sharp`) and about 12 MB of fonts and
drawings in the package (Noto Color Emoji is 10.6 MB of that).

### 2. Where each input comes from

| Input | Source at `write_recap` time |
| --- | --- |
| Pages | `presentGameRecap` run on the draft story, the same function the app's payload comes from |
| Scene JPEGs | The files `readGameRecapMedia` already returns, hash-checked against what the tools generated |
| Music | The score: the stored `song` asset whole, its length, and the song's own length (`T` and `T - C` in the recap contract). Page turns come from the pages' `cueMs` |
| Word timings | The song page's `lines`, on the song's own clock, as presented |
| Real photos, profile photos | Fetched again by reference id into a host-only directory; the task directory's copies are model-writable and are not trusted |
| Names, scores | `material.result` |
| Outcome and stake | New `game.poster` inside the material's untyped `game` object, built by Web from the same owner the app's last screen reads: outcome (won, or even with `everyDay`), stake (`prize`, `dare`, `both_win`, `none`, or `other` for a shape the last screen has no single drawing for, such as two tickets of one prize) with its title and who owes whom. The runner maps `dare` to the renderer's punishment and refuses `other`, a missing poster and a ticket owed other than loser to winner. The runner never derives a winner. The model's `game.json` never carries `poster` |
| Prize drawing | Chosen by the renderer from the prize's title with the app's own rule, from the app's catalog and drawings copied into the package. Web sends no icon: the server stores only the prize's words |
| Days given back | Entry ids whose player marked the post incomplete, read from the material's own `game.days` posts (`incomplete: true`): their prints carry the app's "Didn't finish" tag |

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
- One helper, `recapStorageObjects`, enumerates storage objects across scene
  and song assets and video parts. Acceptance verification, receipt retention
  and lookup use it, so there is one lifecycle loop. The slots are `scene-N`,
  `song`, `score` (the same stored file as `song`, served whole) and
  `video-N`. A part is served through the existing asset route and authorized
  through its parent video's source union.
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
its hash and length equal the identity Web returned. Web returns the identity
only to a request that asked for it (a write that brings a candidate, or a
recovery with `video: true`), because older runtimes refuse unknown result
fields.

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

The approved sample plays one piece of music: five seconds of instrumental
under each story page, landing on the song. That score is in the product
since #4989 (2026-11-15), so the video's soundtrack is the show's score and
its page timing is the show's own:

- The renderer takes the score's file, its whole length and the song's own
  length, and reads each page's start from its `cueMs`. Nothing assumes a
  five-second grid or a song at thirty seconds.
- The song page opens on its cue, the first sung word. The song's own clock
  (lyrics and scrubber) starts a little earlier, at the whole length less the
  song's length, as in the app's player. A singer who comes in late holds the
  last story page longer.
- A show without a score (a twenty-second song from before #4989, or a song
  whose score could not be had) gets no video: its story pages would play in
  silence, which the owner has rejected. The renderer refuses it, and the
  render step should not start for it.
- Without a song: no video.

The flag no longer waits on the score. It waits on the gate in section 10 and
on the delivery slice.

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
- Protocol admission: the storage slice (#4990) adds a `recapVideo` witness
  to Web's protocol admission that the Worker deploy asserts. A runtime built
  from a main that includes #4990 therefore needs that Web live first.
- Order: contracts and Web readers (with the `recapVideo` witness), Worker,
  runner readers, then the writers (Web results and material, runner render
  and delivery), then the flag, then the app's Share.

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

Measured with the package's own script (`pnpm --dir packages/recap-video
measure`) on the synthetic show: 1,531 frames at 804x1748, a 51.0 s video,
x264 `medium`.

| Where | Wall | Drawing process | ffmpeg | File |
| --- | ---: | --- | --- | ---: |
| Linux container at 2 CPUs and 6 GiB, the runner base's recipe (Node 24.22.1 on Debian bookworm, ffmpeg 5.1.9), arm64, on an Apple M4 Max | 19.9 s | 6.7 CPU-s, 271 MB peak | 32.9 CPU-s, 777 MB peak | 3.06 MB |
| The same container, x264 `veryfast` | 15.9 s | 6.6 CPU-s, 271 MB peak | 25.0 CPU-s, 574 MB peak | 2.58 MB |
| The hosted runner's real base image (linux/amd64) at 2 CPUs and 6 GiB, emulated on the same Mac | 39.4 s | 13.8 CPU-s, 339 MB peak | 64.8 CPU-s, 957 MB peak | 3.06 MB |
| The real child (`child.js`) in the runner base image at 2 CPUs and 6 GiB on a GitHub-hosted x86-64 runner (the runner-image lane on PR #4994) | 44.7 s | not reported | 555 MB peak | 3.18 MB |
| macOS, 16 threads, Apple M4 Max | 5.0 s | 5.4 CPU-s, 343 MB peak | 17.9 CPU-s, 767 MB peak | 3.05 MB |

- The two-CPU arm64 number is the nearest measurement to production that
  this machine can make: the same operating system, Node and ffmpeg builds as
  the runner, limited to the runner's CPUs and memory, on a different
  processor family. The emulated amd64 run proves the image, not its speed.
- Unmeasured: production's x86-64 vCPUs. The first measurement there is the
  runner image smoke in slice 5, then a trace of the first production run.
  The child's timeout stays 180 s.
- Peak memory is ffmpeg's (x264 lookahead at this frame size), not the
  drawing process's: under 1 GiB in every run, inside the container's 6 GiB
  beside the runner's own processes. The emulated run also passed the
  package's 93 tests, encode included, as the image's own user with no
  network.
- Money: no provider call. Well under a minute of a container that is already
  running, and up to 8 MB of sealed storage per recap for as long as the
  recap is kept.

### 10. The visual gate (before the flag is ever on)

1. Page-by-page proof: frames from this renderer beside the app's screenshots
   and the approved reference's frames at the same times, for the cover, each
   story layout, "Most likely to", the song mid-lyric and the last screen. The
   only accepted differences are the agreed ones: nothing tappable, third
   person, the address footer, the larger ticket.
   Done in slice 2 for every page kind and every stake (contact sheets written
   outside the repository, with a list of what each frame was compared with).
2. Every shape the contract and the app's decoder allow, one frame each: zero,
   one and two cards; a story page without a picture; a failed scene falling
   back to its photo and to words alone; a pair; a contact sheet; a stat; a
   kicker; a quote over 70 characters; long titles, names, prizes and dares;
   lyrics with and without word timings; a profile photo and an initial; each
   background; a missed-day print; no song; each of the four stakes.
   Done in slice 2: `packages/recap-video/test/shapes.ts` lists them.
3. A CI check on synthetic fixtures that renders those frames and compares
   their structure, plus a contact sheet written outside the repository for
   the owner's review before the delivery slice merges.
   Done in slice 2: `test/shapes.test.ts` draws every shape and compares each
   page's laid-out pieces with what was recorded when the frames were checked
   by eye; `test/contract.test.ts` draws the recap contract's own show with a
   score; `pnpm --dir packages/recap-video proof <directory>` writes the frames
   and sheets.
4. Fonts on Linux: a test that fails when any bundled family is missing or
   measures differently from recorded advances, run in CI and in the image
   smoke, so a silent fallback cannot change a line break.
   Done in slice 2 for CI: the advances test runs in the package lane, and
   `.github/workflows/recap-video-runner-image.yml` runs the whole suite,
   encode included, inside the pinned runner base image. The runner bundle's
   own smoke gains it in slice 5, when the bundle gains the package.

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
2. Renderer completeness: every contract shape, the four stakes, the app's
   prize drawings, emoji, the score as the soundtrack, the fail-closed
   refusals, the Linux font check, the CI frame check, the runner image lane
   and the proof sheets.
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
2. Risk: text the bundled fonts cannot draw. Emoji, Greek and Cyrillic are
   drawn. Mitigation for the rest (Arabic, Hebrew, Chinese, Japanese, Korean,
   Thai, the Indic scripts): refusal, because lines are broken at spaces and
   set left to right.
3. Risk: the container is slower than guessed and the turn runs long.
   Mitigation: hard timeout, measured in slices 1 and 4 before the flag.
4. Risk: a Web rollback below the envelope reader after videos are stored.
   Mitigation: stated rollback floor; the reader ships a release ahead.
5. Risk: the Linq attachment upload from the runner has a size limit below the
   file. Mitigation: verified in slice 5 against the egress path before the
   flag; the text-only degrade covers a failure.
6. Risk: the punishment slip's typeface (an Apple system font) is not ours to
   ship. Mitigation: an open face at the size where its words are as wide as
   the app's, so dares break onto the same lines (see Decisions).
7. Risk: the copy of the app's prize catalog and drawings drifts from the
   app's. Mitigation: the copy is made only by
   `packages/recap-video/scripts/sync-stake-art.ts` from an app checkout, it
   records the app commit and a digest of every drawing, and a test pins the
   port's answers to the app's own code's answers for the catalog and several
   hundred other prizes. Nothing yet fails in the app's repository when its
   catalog changes: until a check there exists, whoever changes the app's
   catalog reruns the sync here.

## Open questions for the owner

1. Minimum hold of the last screen when the song's last word lands near the
   end of the music (the sample holds 5.7 s; a song sung to its last second
   would leave under 2 s). This plan holds it at least 5 s by letting the
   picture outlast the music.
2. Whose seat the video takes. The app is drawn from the viewer's seat: the
   viewer's face is left of the score, the other player is named first on the
   cover ("starring Ava and Leo" on Leo's phone), and the viewer's initial is
   on sage, the other's on sienna. Both players receive one file, so the
   video needs one rule. Built: the winner's seat (winner left of the score
   and on sage, named last on the cover), which is what the approved sample
   showed; an even game goes by name. The alternative is alphabetical
   everywhere. Say if the built rule is wrong.
3. Long prizes on the ticket. Beside its drawing the app gives a prize one
   line and shrinks it to three fifths of its size; a longer prize is cut
   short with an ellipsis on the phone ("Pick of the Restaur..."; seen by
   running the app's ticket layout on a Mac, not on a phone). The video
   refuses those games rather than draw an ellipsis. Options: keep refusing;
   drop the drawing for long prizes so the words get two lines; or fix the
   app's ticket first and follow it.
4. Contact sheets with a short last row. The app sets four, five, seven or
   eight posts with the last row's prints much larger than the rows above
   (again from the app's layout code run on a Mac). The video draws what the
   app draws. Say if the app should change; the video follows it.

Settled since the first version of this plan: the song-only video (no video
without a score), the slip's typeface, and emoji.

## Verification

- Slices 1 and 2: `pnpm --dir packages/recap-video typecheck`, `pnpm --dir
  packages/recap-video test`, the measurement script's printed time and peak
  memory, `pnpm --dir packages/recap-video proof <directory>` for the frames
  and contact sheets, and the runner image lane for the encode.
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

### Codex deep review of slice 1 (2026-11-15, read-only, before landing)

Fifteen findings on the renderer package, each checked against the code, the
approved reference page and the iOS source. Eleven accepted and fixed with a
test; four rejected with evidence.

1. High, accepted. A lyric line long enough to wrap past the lyrics card was
   clipped for the whole song. The card shows the line being sung on two rows,
   as the app does; a longer line is refused.
2. High, accepted. Pictures were decoded with no bound. A picture's size is
   now read from its header first: only a JPEG or PNG of at most 4,096 pixels
   a side is decoded, a show's pictures are capped at 120 megapixels in all,
   and each file is decoded once (the cover was decoded three times).
3. High, accepted. A cover with a second headline, a quote or a stat, and a
   card, song or result page with blocks, dropped that content silently. Each
   is now a refusal, as is a second song or result page.
4. Medium, accepted. Word timings and the soundtrack's numbers were trusted.
   Times that are not finite, not in order, or end before they start are
   refused.
5. Medium, accepted in the smallest form. The app draws the timed words'
   text, and the server builds those from the lyrics, so they cannot differ
   on the product path. The renderer now refuses a show where they do, in
   the same check as finding 4.
6. Medium, accepted in part. Accepted: the last screen starts on a frame and
   the video ends on one, so its five-second minimum is 150 frames, not 149.
   Rejected: dropping the second the picture outlasts the music. The approved
   sample has it (51.03 s for a 50.04 s score).
7. Medium, accepted. A frame that failed to draw returned while ffmpeg was
   still running, and a failed or oversized encode left its file. Every
   failure now stops ffmpeg, waits for it and removes the file.
8. Medium, accepted. Page, block, text and lyric counts are checked against
   the recap contract's own maxima before any layout or decoding.
9. Medium, accepted. A score too wide for its row is refused. (Slice 2 adds
   the app's shrink rule for two-digit scores.)
10. Medium, rejected. The review read the reference page, which gives the
    setup beat to the first block only. The app is the authority:
    `GameRecapShowStory` gives every block before the picture the setup beat
    and every block after it the payoff beat, which is what the renderer does.
11. Medium, rejected. A label on the cover is drawn because the app draws
    one when a show has it. The owner's ruling is about what real recaps
    contain (the writer gives none), not a request to hide one.
12. Medium, accepted. A wide prize icon is fitted inside its place on the
    ticket instead of being sized by height alone.
13. Low, rejected. The ticket is 256 pt wide inside a 280 pt slot, as the
    app's `GameBigTicket` is (12 pt of padding each side inside
    `frame(maxWidth: 280)`); the app's screenshot measures the same.
14. Low, accepted. The fonts' OFL texts ship beside the font files.
15. Low, accepted. The measurement script removes its fixture files whether
    or not the video is kept.

The review found nothing in determinism, the workspace wiring or the native
dependency (exact pin, lockfile integrity for the Linux x64 and arm64 gnu and
musl builds, no install script, supply-chain settings unchanged).

### Slice 2 findings and choices (2026-11-15)

Checked against the app's source, its screenshots, and the app's own layout
code run under SwiftUI on a Mac where a screenshot did not exist:

1. The display face. The reference page drew Fraunces at the font file's
   default axes; the app pins optical size 36, SOFT 100 and WONK 1. The
   renderer now pins the same. Advances moved about 1.5 percent and agree
   with the app's text engine to half a point ("Leo wins." 189.2 against
   189.5). The line breaks of the approved pages did not change.
2. Italics. The app slants its upright face by a fifth. The canvas's own
   synthetic italic slants by a quarter, so the renderer slants the text
   itself and leaves emoji beside it upright.
3. Line heights. The app's text is 37 pt to a line at 30 pt with 5 pt between
   lines; the reference used 41 pt boxes. Headlines, quotes, the card's line,
   the score and the last screen's title now use the app's numbers.
4. Avatars. The app's initial is DM Sans Bold at three eighths of the circle
   on the player's color; the reference drew it lighter and larger on sage for
   both players.
5. The ticket. The prize is offered half the print's height, which is one
   line, and the drawing takes what is left; the kicker is at 0.8 opacity.
   The line under the prize names both players in the video, so it may shrink
   to three quarters before the ticket is refused: this is the video's own
   rule, since the app's line names one.
6. Words alone. On a page without a picture each block follows the one before
   by 0.9 s, as in the app.
7. Even games keep the app's words ("You both win.", "Dead even.", "Nobody
   owes anything."): they are already true for both players.
8. Punishment slip typeface: Zilla Slab Medium at 1.106 times the app's
   sizes. Five open faces were compared with American Typewriter on 35 dares
   and 4 names. At that size its words are within one percent of the app's
   widths with the smallest spread of the five, all 35 dares break onto the
   same lines (two- and three-line dares checked against the app's own text
   engine), its weight is the closest, and its licence is SIL OFL 1.1 with no
   reserved name. Its letters stand 0.95 as tall as the app's. Cutive matched
   breaks only 16 percent smaller and is thinner; Special Elite is worn where
   the app's slip is clean; Kameron is lighter; Arvo is squarer.
9. Emoji and other alphabets: Noto Color Emoji and Noto Sans are bundled.
   Drawn: emoji (sequences and skin tones included), Latin with its accents,
   Greek, Cyrillic. Refused: Arabic and Hebrew (right to left), Chinese,
   Japanese, Korean and Thai (no spaces to break lines at), the Indic scripts,
   and direction-control characters.
10. Prize drawings: the server stores only a prize's words, so the renderer
    picks the drawing from the title with the app's rule, ported and pinned
    by a parity test (see risk 7).
11. Still refused, on purpose: a page with two pictures (the app draws the
    first and drops the second); a cover with anything but its title and
    label; a contact sheet holding a day given back (its tag is wider than
    the small prints); a prize too long for one line at three fifths size
    beside its drawing; a song title past two lines at four fifths size; a
    treatment too long for one line under the song's title; a dare past three
    ruled lines; a stat too long for one line at two fifths size.
12. Not established: the app's ticket can print "x2" when a week is worth
    more than one ticket. The video's input has no count. Slice 3's
    `game.poster` must say whether a live game can produce one, and a count
    above one must be a refusal until it is drawn.

### Codex deep review of slice 2 (2026-11-15, read-only, before landing)

Seven findings on the slice 2 diff. Six accepted and fixed with a test; one
rejected with evidence.

1. High, accepted. A dare short enough for one line skipped the check that
   its letters can be drawn. Every dare is checked now.
2. Medium, accepted. On a very narrow photo the "Didn't finish" tag hung off
   the print. A photo too small for its tag is refused.
3. Medium, accepted. A stake's title had no length limit before the drawing
   picker read it. It has the limit every other text has.
4. Medium, rejected. The review asked for equal cues to be accepted because
   the app's player accepts them. The contract gives every page its own cue
   (`5000 * index`, then the first sung word), and two pages on one cue would
   leave one of them no frame at all: a page silently left out. Refused.
5. Medium, accepted. A stake with no words drew a ticket with no prize. It is
   refused.
6. Medium, accepted. The marks that join emoji were allowed anywhere, so a
   block holding only one drew nothing. They are drawn only after an emoji;
   elsewhere the text is refused (this also refuses keycap emoji such as a
   digit in a box, which no bundled face sets correctly).
7. Low, accepted. An emoji inside a word left the whole word upright in an
   italic line. Only the emoji stands upright now.

Clean by the review: the song's clock and the last screen's timing against
the contract fixture, the shrink loop, the score row, ticket and slip
arithmetic, contact sheet rows, the drawing picker, the catalog's contents,
the workflow, and the tests (none vacuous).

### Slice 5 choices: render in generation (2026-11-15)

1. The child is the renderer package's own `child.js` (request file in, one
   JSON line out). The runner resolves it beside the installed package's index
   and never imports the renderer, so `@napi-rs/canvas` and the fonts stay out
   of the runner process and the runner bundle; `@murphai/assistant-engine`
   depends on the package so the bundle installs it.
2. The child runs in a new process group with a 512 MB heap and an
   environment of `PATH`, `HOME` and `LANG` only. One 180 s budget covers the
   photo fetches, the render and the part uploads. The runner kills the group
   at the deadline and on a cancelled turn, and again after any exit; the child
   removes its own directory and kills its group when the runner's pipe closes
   or its deadline passes, so an orphaned render cannot outlive its runner.
3. Inputs, the request and the output go to a fresh render directory under the
   runner's home (`.murph-recap-video/`), never under a temporary directory or
   the vault, which the model's permission profile can write. Files are 0600;
   the directory is removed on every path except the finished file, which the
   caller disposes of after the write; each render sweeps directories older
   than twice the budget.
4. One render per runner process at a time; a second concurrent recap gets no
   video ("busy") rather than a second encoder's memory.
5. The render runs after the scene and song uploads (Web measures the song,
   and `presentGameRecap` needs the assets) and before the write. A write the
   model must correct renders again; accepted, since refusals are rare and the
   step is bounded.
6. A post whose photo is no longer in the material is drawn as the app draws
   it, a "missed" print; a photo that cannot be fetched again is no video.
7. Slice 2's finding 12 (a ticket worth more than one): Web's poster gives two
   tickets of one prize as `other`, so the runner refuses it.
8. With the flag off nothing changes: the wake has no `video`, the write
   request has no `video` key, and the model's input is identical because
   `poster` is removed from `game.json` (tested byte for byte).
9. Rollback floor: this slice adds none for durable data. Web writes
   `video: true` only with the flag on, and the runtime that reads it (#4991)
   ignores it; the runner sends a candidate only after Web accepted its parts,
   which an older Web refuses. One condition: with the flag on, Web puts
   `game.poster` in the material, and only this runtime keeps it out of the
   model's `game.json`, so turn the flag off before rolling the runtime below
   this slice.
10. Review (ReviewGPT round 1 and the Codex deep review, both on 6bd8ebf271).
    Accepted and fixed with tests: the render directory was under the
    model-writable temporary directory, so a planted link could make ffmpeg
    overwrite a canonical file (ReviewGPT, high); a setup error before the
    child (directory, request file, package resolution) failed the recap write
    (Codex 1); an orphaned child left its inputs behind (Codex 2); a turn
    cancelled during an upload could still write (Codex 3); the deadline left
    out fetches and uploads (Codex 4); the rollback note above (Codex 5); a
    ready scene's unused fallback photo was fetched and could cost the video
    (Codex 6). The native permission smoke does not yet run a render beside a
    hostile model command; the unit tests prove the directory is never under a
    temporary directory or the vault, and the profile grants the model neither
    the runner's home nor anything outside the vault and the temporary
    directories.

### Slice 6 choices: delivery (2026-11-15)

1. The turn records the accepted video only when this runner holds Web's
   exact bytes; the candidate moves to a path named by the identity under the
   runner's home, so a retried turn on the same runner finds it through the
   recovery's identity. A recovery anywhere else sends the line and link.
2. The outbox intent's `recapVideo` is bounded (identity, file path, `form`,
   `attachmentId`; strict, dropped when malformed), set only on a text-only
   Linq intent, and never added or replaced by a replayed create.
3. The decision is the hosted Linq sender's, persisted through the outbox like
   the app-card text fallback, before the message's first request: line with
   the prepared attachment, or line alone. It only moves toward the line alone.
   The attachment is uploaded through an authority-only provider boundary, so
   no dispatch fence is claimed for it.
4. Eligibility, one shared check (`isRecapVideoCurrent` through
   `readRecapVideoDeliveryCurrent`, bound to the delivery key's game), runs
   before the upload and before every send, through the existing egress
   engagement route as an authority-only call carrying `recapVideo`. It runs
   outside the claim's transaction, as the plan requires, and immediately
   before the claim rather than inside it: the claim runs as the message's
   request leaves, when its body (with the attachment) is already built. The
   window between the check and the claim is one Web round trip. The claim's
   own recap witness check still suppresses a retired generation entirely.
5. A video Web no longer allows is dropped for good even after an ambiguous
   attempt, so a retry never newly delivers it; Linq's idempotency key returns
   the earlier message if it had been accepted.
6. The model's tool description still says the host sends the line and link
   "with no chat media". Changing it would change every recap turn's input for
   a flag that is off; the model cannot attach or affect the video.
7. Rollback floor: the outbox reader of #4991 reads every intent this slice
   writes (it accepts the bounded shape) and sends its text alone. A runtime
   below #4991 quarantines such an intent, so #4991 stays the floor.
8. Review (ReviewGPT round 1 and the Codex deep review, both on 7b7ad7b299).
   Accepted and fixed with tests: the intent named the file, and the model's
   shell can edit an intent, so the host could be made to read or delete any
   file (both, high): the intent now carries the identity only and the sender
   derives the path; eligibility could go stale during the upload and during
   the client's own retries (both, high): Web is asked again after the upload
   and before each request that carries the attachment; Linq refusing the
   message with its attachment terminalized the recap (Codex, high): the
   decision becomes the line alone and the attempt is retried; an
   authority-only answer's delivery block was ignored before the upload
   (Codex, medium). Rejected: keeping a saved attachment after an ambiguous
   attempt once Web says no (Codex, medium). Choice 5 above is deliberate:
   Linq replays an accepted key's original response, so dropping the video
   cannot send it twice, and never newly delivering a withdrawn photo
   outranks the stored form matching an attempt Linq may have taken; the
   delivery record holds Linq's message ids either way.

### Owner decisions recorded after the review (no architecture change)

- Scope: carry the feature through every slice to merge-ready.
- Delivery: the video is sent in addition to the recap link.
- Last screen: the address-only footer, the 280 pt ticket slot, all four
  stakes in third person.
- Cover: no label above the title. Fixtures follow production's writer.
- The visual gate in section 10 is required before the flag is on.
- First production run: a regeneration of a game the owner chooses, started
  from the owner's session after the gate has passed.
