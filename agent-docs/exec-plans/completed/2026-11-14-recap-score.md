# Play one piece of music under the whole recap show

Status: completed
Created: 2026-11-14
Updated: 2026-11-14

## Goal

- A pair's recap show plays one continuous piece of music: an instrumental
  stretch under each story page that states the song's tune, then the same band
  sings the theme song on the song page. Today the story pages are silent and a
  separate twenty-second song starts cold on its own page.
- The singing starts the moment the song page appears.
- App versions already installed keep working with no change: silent story
  pages and a normal song on the song page.

## Success criteria

- One provider request makes the whole piece: one five-second instrumental
  chunk per story page, then a twenty-second sung chunk, at exactly the
  requested length.
- The show response tells a client when each page's music starts, and the song
  page's start is the moment of the first sung word.
- An older client that reads only the existing `song` page receives a playable
  MP3 of just the sung part, with lyric timings measured from its start.
- A show whose pages changed after the song was made is refused at
  `write_recap` with a problem the author can act on.
- Existing shows, and shows made by a runner that has not rolled yet, read and
  play exactly as before.

## Scope

- In scope: the recap song tool and its provider request, the Cloudflare
  egress filter for recap music, the Web upload check, the stored asset record,
  the asset route, the show presentation, the authoring guide, and their tests
  and contract doc. The iOS playback change is a separate pull request in the
  iOS repository against the contract defined here.
- Out of scope: group recaps, ordinary `generate_song` calls outside a recap,
  per-show tempo choice, music on the result page, any Android or Web player,
  and regenerating songs for shows already accepted.

## Evidence gathered before planning

Measured against the real provider on `music_v2_5`, one request at a time:

- Chunk durations are enforced: 24 of 24 takes came back within 40 ms of the
  requested total, across 4, 6, 7 and 9 music pages (40 to 65 seconds).
- Every lyric word was sung in order and timed in every take.
- The first sung word lands between 0 and 5.6 s after the sung chunk begins. It
  was within 1 s in 14 of 21 takes and within 2.5 s in 15 of 21. A direction to
  bring the singer in on the first beat helps and does not guarantee it.
- The provider's MP3 is constant bitrate: `mp3_48000_192`, 576-byte frames of
  24 ms, a 44-byte ID3 tag and no Xing header. Bytes taken from a frame
  boundary decode as a valid MP3 that is sample-identical to the original from
  45 ms after the cut.
- A stretch of music that is short for its lyric is fine: the sung part can be
  15 to 20 s.

Read from current code:

- The author writes a draft file (`{story, files}`) in the recap workspace
  before calling `generate_song`; `write_recap` takes only `{draftPath}`.
- Twenty seconds is fixed at the tool (`dynamic-tools.ts`), at the egress gate
  (`runner-egress-intercept.ts`), and in the Web upload check
  (`recap-media.ts`), which also caps audio at 1 MiB, about 43 s at this
  bitrate. The runner file, upload body, Worker stage and asset record caps are
  2 MiB or more.
- The egress parser admits exactly one chunk with exact keys.
- Word timings are held in the runner's memory beside the file hash, travel
  with the upload, are stored on the asset, and become the song page's `lines`
  at read time.
- A recap may forward six media requests in total; a show stores at most five
  assets. Failed forwards stay spent and nothing retries automatically.
- Writer, draft, story and asset schemas are strict. The client-facing show is
  not validated on the way out, and the native decoder ignores unknown fields.

## Design

One generated file, stored once as the existing `song` asset, read two ways.

Three times on the score's clock, kept distinct:

| Name | Meaning | Where it lives |
| --- | --- | --- |
| `T` | The whole piece's measured length | `score.media.durationMs` |
| `F` | The first sung word, from the provider's raw timings | The song page's `cueMs` |
| `C` | Where the older client's song begins: a frame boundary at or before `F - 200 ms` | Stored on the asset as `songStartMs` |

1. **Music pages have one owner.** A pure function beside `presentGameRecap`
   derives the ordered music pages from a story: the authored pages (the first
   is the cover) and then the superlative cards. The provider plan, the write
   check and the cue projection all call it.
2. **Request.** In a recap, `generate_song` takes `{draftPath, voice}`. The
   host reads the draft and builds the provider plan itself: one five-second
   instrumental chunk per music page, whose cue depends only on the page's
   kind and position, then one twenty-second sung chunk with the draft's
   lyrics. Every chunk carries the draft's song style and a fixed tempo of
   96 BPM in 4/4, at which a page is two bars. Instrumental chunks never carry
   the voice description.
3. **Bound to its draft.** The host keeps, beside the file's hash in the
   attempt-local source map that already holds the timings, a signature of what
   shaped the music: the ordered music-page kinds, the style and the lyrics.
   `write_recap` compares it with the final draft before uploading and refuses
   a mismatch with a problem that says to generate the song again or submit
   without one. Editing a page's words does not change the music and is
   allowed; adding the song's path to `files` and changing the chat line are
   allowed. The signature never leaves the host.
4. **Song start.** `F` is the first raw timed word at or after the sung
   chunk's start. `C` is the frame boundary at or before `F - 200 ms`; it may
   fall inside the last instrumental chunk, which keeps an on-the-beat first
   syllable whole for an older client. When `F` is more than 2.5 s after the
   sung chunk's start, the host tries one more take through the ordinary egress
   admission and keeps the first unless the second is valid and enters
   earlier. A refused, failed or invalid second take leaves the first take
   untouched; cancellation propagates. The saved file, timings and
   `songStartMs` always belong to the same take.
5. **Upload and storage.** The file is uploaded as the `song` slot with its
   raw timings and `songStartMs`. The asset record gains that one optional
   field. The Web check accepts either the existing twenty-second song, whose
   receipt is unchanged and carries no new field, or a piece whose decoded
   length is `5 s x music pages + 20 s` within 500 ms, for 1 to 9 pages, with
   `songStartMs` on a frame boundary of a constant-bitrate stream it can walk
   and no later than the first sung word. The audio cap becomes 2 MiB.
6. **Write check.** `write_recap` refuses a show whose music page count does
   not match the piece's length, and aligns lyrics against the timings rebased
   by `C`.
7. **Presentation.** For a stored song without `songStartMs`, nothing changes.
   With it:
   - the `song` page keeps its shape: its media URL is the `song` slot, its
     `durationMs` is `T - C`, and its `lines` are measured from `C`;
   - the show gains `score: { media }` (the `score` slot, `durationMs` `T`),
     and every music page gains `cueMs`: `5 s x index` for the story pages and
     `F` for the song page.
   A client playing the score lights lyrics at
   `scoreMs - (score.media.durationMs - song.media.durationMs)`. Page turns use
   `cueMs`; lyric timing uses the song's own origin.
8. **Serving.** The asset route serves the `score` slot as the whole stored
   file and the `song` slot as the stored bytes from the frame at `C`. Both go
   through the existing authorization and full-file hash check first. One
   shared helper walks MP3 frames for the upload check and the route.
9. **Egress.** The detailed-music parser admits either today's single chunk or
   a score plan: 1 to 9 instrumental chunks of exactly 5,000 ms followed by one
   sung chunk of exactly 20,000 ms, each with bounded style lists and
   `context_adherence: "high"`. The recap gate accepts a duration one of those
   two shapes produces. Usage is recorded for the total duration.
10. **Admission.** The Web deployment admission response gains a
    score-capable recap witness built from the same parsers the upload route
    uses, and the runtime's existing admission validator requires it. A runtime
    that makes scores cannot activate against a Web build that would refuse
    them. The response stays additive for runtimes already deployed.
11. **Guide.** The authoring guide describes the song as the show's music, asks
    for the song last, splits the band's sound (`style`) from the singer
    (`voice`, a tool argument), and says the tempo is fixed.

A newer client plays `score` under every page with a cue, turns a page when the
score reaches the next cue, seeks to a page's cue on a tap, and never fetches
the `song` slot. Without a ready score it behaves as today.

## Constraints

- No new stored asset, slot count, retry loop, flag or configuration. One
  optional asset field, one optional show field and one optional page field.
- No server-side audio decoding or encoding beyond the duration decode that
  already runs at upload. The cut is byte arithmetic on a validated stream.
- The story schema does not change, so a stored show still reads on a Web
  build from before this change. An older Web reading an asset that carries
  `songStartMs` drops that asset and shows the story without a song; that is a
  read fallback only, and compatible Web stays in place while scores are made.
- Intended cost per recap rises from 20 s of music to at most 65 s, and to at
  most 130 s when the one improvement take runs: $0.05 becomes $0.16, at most
  $0.33. This is the recipe, not an enforced ceiling: the existing allowance of
  six media forwards per recap has no song-specific quota.

## Risks and mitigations

1. Risk: a runner emits a score before the Worker or Web accepts it.
   Mitigation: the runtime's deployment admission requires the Web witness
   before activation; the runtime deploy puts the Worker at 100% before the
   serving runner rolls. Every boundary keeps accepting the single
   twenty-second song.
2. Risk: the provider changes its MP3 framing and the cut lands off a frame.
   Mitigation: the upload check walks the whole stream and refuses anything
   that is not constant-size frames; the author then submits the show without
   a song, as it does for any failed song today.
3. Risk: a voice description leaks vocals into the instrumental pages.
   Mitigation: the singer is a separate argument that only the sung chunk gets,
   and instrumental chunks carry vocal negatives.
4. Risk: the first 45 ms after the cut is silence for an older client.
   Mitigation: the cut sits at least 200 ms before the first word, inside the
   last instrumental chunk when it has to.
5. Risk: pages the client drops (a card for a member no longer in the game)
   leave a gap. Mitigation: cues are per page, so the previous page holds
   through the missing page's stretch.
6. Risk: music now starts when the recap opens, with the audio session rules
   the song page uses today. Mitigation: unchanged rules; the owner decides
   separately whether the recap should respect the silent switch.

## Tasks

1. Contracts: the music-page function; `songStartMs` on the asset; `score`
   and `cueMs` in the presentation and its projection; fixtures and the
   contract doc, including the lyric clock definition.
2. MP3 frame helper beside the existing audio inspection, with tests on a
   real-shaped stream and on malformed ones.
3. Web: upload check, write check, asset route slots, presentation wiring.
4. Runner: score plan builder, `generate_song` reading the draft, song start
   and the one retry, upload metadata.
5. Cloudflare: egress parser and recap gate; the admission witness.
6. Guide and tool text; the real-model recap journey.
7. Real-provider proof of one whole show through the built path.
8. iOS playback, in its own repository.

## Decisions

- Rejected: two stored assets (score and song). It doubles upload and storage,
  takes a second slot from a five-asset show, and gives the author two files
  to manage for one piece of music.
- Rejected: asking the provider for the sung slice as a second request. It
  works, and it adds a provider call, provider-side storage of the song and a
  third egress shape for something byte arithmetic does exactly.
- Rejected: regenerating until the singer is on time. A sliding song start
  makes the product promise true for every take; a retry only shortens a long
  hold.
- Rejected: letting the author write a cue per page. Cues by page kind worked
  in every tested genre and add no prompt surface.
- Fixed tempo is a deliberate product limit for the first version.

## Plan review

Reviewed before implementation (ReviewGPT architecture, 2026-11-14). It kept
the one-file, two-view design. All four findings are accepted and folded into
the design above:

1. Accepted: one owner for the ordered music pages, and the score bound to its
   draft through the existing attempt-local source map. The signature covers
   page kinds, style and lyrics; a count-only check would have passed a page
   swap.
2. Accepted: the first-vocal cue and the legacy slice origin are different
   times. The stored field is the slice origin, the song page's cue is the
   first sung word, and the cut may dip into the last instrumental chunk so an
   on-the-beat entry is not clipped.
3. Accepted: deployment admission carries a score-capable witness, so the
   release order is enforced and not only intended.
4. Accepted: no remaining-budget precheck. The second take goes through the
   ordinary admission and can never replace a valid first take unless it is
   valid and earlier. The cost statement is a recipe, not a ceiling.

It also noted that the recap journey testkit serves a fixed twenty-second
fixture and fabricates the uploaded duration, so the whole-path proof must run
the real Web media validator and both served views.

## Verification

- Focused tests at each owner for both shapes, mixed versions, and refusal of
  malformed plans, streams and stale page counts.
- Song start cases: a first word exactly at the sung chunk's start, within
  45 ms, within 200 ms and much later, at chunk starts on and off the 24 ms
  frame grid. Each proves the cut is a real frame boundary with its preroll,
  the song cue equals the first sung word, and the full score and the cut
  light the same word at the same audio.
- Draft binding: refused for an added or removed page or card, a swap of two
  pages of different kinds, a kind change, and changed lyrics or style;
  allowed for a text edit, a swap of two pages of the same kind, a swap of the
  two cards, the song's own path, and the chat line. The music is made from
  page kinds in order, so only a change to that sequence changes the music.
- Second take: denial, provider failure, a malformed response and a later
  entry all keep the first take; an earlier valid one wins; cancellation
  propagates.
- Admission: a new runtime refuses a Web response without the witness; a
  deployed runtime still reads the extended response; an old runner's
  twenty-second upload gets an unchanged receipt.
- The real-model recap journey with synthetic providers, and one real-provider
  show through the real Web media validator and both served asset views: exact
  length, timings, a playable cut.
- Typechecks, boundary guards, complexity, docs drift; exact-head CI.

## Results

Tasks 1–6 are implemented. Tasks 7 (real-provider proof) and 8 (iOS) remain
with the parent. No commits, pushes, PRs, deployments or real media-provider
requests were made. No secret, Keychain item or `.env` file was read. The live
model journey used the existing Codex subscription through the normal harness,
with synthetic image and music providers.

The runner reads `{draftPath, voice}`, builds the fixed page cues, binds the
file to ordered music-page kinds/style/lyrics, and retains a valid first take
unless its single improvement take is valid and earlier. Signature checks run
before any selected file uploads. Raw first-word timing, frame origin and full
measured duration stay separate throughout upload, presentation and serving.
Web stores one asset, serves both authorized views after full-file integrity,
and preserves legacy twenty-second receipts. The Worker admits both shapes,
charges the total duration, and requires the additive Web score witness before
new-runtime activation. The guide, decoder fixture and contract reference are
updated.

Differences and implementation details:

- The asset route and `service.ts` already accept arbitrary slot names through
  their existing callbacks; their owners needed changes, those call sites did
  not. No new public package entrypoint, dependency or configuration was added.
- The header walker enforces constant bitrate, sample rate and Layer III while
  accepting frame padding. This follows the brief's header-driven requirement;
  the plan's risk paragraph says "constant-size frames", which is too narrow
  for valid padding. No design section was changed.
- `songStartMs` may be fractional milliseconds at sample rates such as 44.1 kHz.
  The stored duration remains the existing measured integer milliseconds;
  presented durations and cues are numbers, and aligned words remain integers.
- The existing provider timing schema rejected reversed intervals before the
  score owner could ignore them. Detailed music now drops empty/reversed
  provider annotations before applying that unchanged stored schema; a focused
  regression covers both forms.
- The obsolete runner file-song path and explicit single-chunk lyric builder
  were removed. Ordinary non-recap music generation retains its existing API.
- A separate lazy import for the score generator produced 28 static boot
  chunks. Importing it within the already-lazy dynamic-tools owner restores
  25/25 chunks, without raising a budget or entering the scoped CLI path.
- The scripted Linux failure fixture originally removed `story.song` before
  generation. It now keeps the song until the failed request, then removes it
  from the final draft, so it exercises the intended provider-failure path.

Focused deterministic verification passed: contracts 22 tests, audio/provider
52, hosted execution 27, assistant engine 319, Web 15, and Cloudflare 265.
Coverage includes raw vocal entries on/off the frame grid, the 2.5-second retry
threshold, all second-take outcomes, all specified allowed/refused signature
edits, pre-upload refusal, malformed streams/plans, 1–9-page duration bounds,
unchanged old upload receipts, a frozen pre-score admission reader, both served
views and corruption before the cut. Both audio views use synthetic MP3 frames
built at test time; no new binary fixture is committed.

All six touched owners' typechecks pass, as do Web lint, workspace boundaries,
package cycles, source resolution, the scoped CLI import guard, complexity and
docs drift. The runner bundle passes at 72,133 entry bytes, 2,052,865 static
closure bytes and 25 static chunks, against unchanged budgets.

Earlier failed checks and their disposition:

- Initial engine/Cloudflare type errors and byte-array equality assertions were
  corrected. The requested-length provider fixture also needed its inferred
  ArrayBuffer type preserved for `Response`. The serving mock was missing settled-game status. A presentation
  fallback test now passes malformed stored assets through the real stored
  parser before presentation, matching production.
- The first Cloudflare and source-resolution commands selected the wrong
  Vitest project; the explicit owner configs pass.
- Complexity initially failed in upload inspection, presentation and admission.
  Local validation helpers and existing parsed invariants remove the excess.
- One CLI import probe overlapped the bundle's rebuild and saw missing generated
  artifacts. The sequential probe after assembly passes.
- The first live model run saved a valid show but called `generate_song` twice,
  failing the one-call assertion. The next run passed that same assertion with
  one song request. This is developer-local behavioral variability, not evidence
  that author-requested regeneration is impossible. The fixed guide and tool
  wording were preserved.

Remaining verification boundaries:

- The Linux sandbox journey was attempted and exited 1 because the Docker daemon
  was unavailable, before either scenario could run. The real-model synthetic
  journey and deterministic transport/serving tests are the available local
  evidence; they do not replace Linux sandbox proof.
- No real ElevenLabs/image proof, iOS decoder/playback run, deployment or
  exact-head CI was attempted. These remain with the parent; no PR or commit
  was created. Release review/changelog integration stays with that combined
  change.

Client contract: optional `show.score: { media }`, where ready media is
`{status:"ready", url:string, mediaType:"audio/mpeg", durationMs:number}`;
optional `show.pages[].cueMs:number`. All times are milliseconds. Authored pages
and cards use `5000 * index`, the song cue is raw first sung word F, and the
result has no cue. `score` serves the whole file of duration T. Existing `song`
serves the frame slice at C with duration T−C and C-relative integer word
`startMs`/`endMs`. `songStartMs:number` is stored/uploaded metadata, never a show
field. Scene URL slots remain `scene-0`…`scene-6`; the only stored audio slot is
`song`. A score client uses only the score URL and the lyric clock
`scoreMs - (score.media.durationMs - song.media.durationMs)`; without a ready
score it uses the existing song behavior. Example from `score-show.json`:
T=55008, C=35088, F=35300, song duration=19920, first lyric word starts at 212.

Final live-journey verdict: **Ready for this developer-local run** on
`gpt-6.1-sol`, local subscription with ambient configuration. It made three
synthetic image requests, one synthetic score request and one accepted write,
then queued exactly the accepted chat line/link with zero media attachments.
The inspected reply correctly announced the 5–3 result and laundry prize,
without internal implementation language. The added delivery assertion passed.
This is not isolated provider release evidence and does not erase the earlier
duplicate-song run noted above.

### Verification commands and real exit codes

Logs are sanitized text in `.tmp/recap-score/`. Names below identify the
corresponding `.log` files; repeated runs retain their original exit codes.
All verification runs set `MURPH_PRISMA_SKIP_ENV_FILES=1`; tests use two workers.

| Command | Log and exit code |
| --- | --- |
| `pnpm install --prefer-offline` | `install`: 0 |
| `pnpm build:workspace:incremental` | `workspace-build`: 0 |
| `pnpm --dir packages/health-commons generate` | `health-generate`: 0 |
| `env MURPH_PRISMA_SKIP_ENV_FILES=1 pnpm --dir apps/web prisma:generate` | `prisma-generate`: 0 |
| `pnpm --dir packages/contracts typecheck` | `contracts-check`: 0, `contracts-check-final`: 0 |
| `pnpm --dir packages/assistant-engine typecheck` | `engine-check`: 2, `engine-check-2`: 2, `engine-check-3`: 0, `engine-check-final`: 0, `engine-check-tests`: 0, `engine-check-delivery`: 0, `engine-check-complete`: 0 |
| `pnpm --dir packages/hosted-execution typecheck` | `owner-checks`: 0, `hosted-check-final`: 0 |
| `pnpm --dir apps/web typecheck:prepared` | `web-check`: 0, `web-check-final`: 0, `web-check-upload`: 0, `web-check-complete`: 0 |
| `pnpm --dir packages/assistant-engine exec vitest run test/recap-score.test.ts test/recap-media-files.test.ts test/recap-workspace.test.ts test/dynamic-tools-generate-image.test.ts` | `engine-focused`: 1 |
| `pnpm --dir packages/operator-config exec vitest run test/generated-audio.test.ts test/elevenlabs-runtime.test.ts test/elevenlabs-runtime-import.test.ts` | `audio-focused`: 0, `audio-final`: 0, `audio-fixtures-final`: 0 |
| `pnpm --dir apps/cloudflare typecheck` | `cloudflare-check`: 2, `cloudflare-check-final`: 0, `cloudflare-check-2`: 0 |
| `pnpm --dir apps/web exec vitest run test/game-recap-media.test.ts test/hosted-runtime-protocol-admission.test.ts` | `web-focused`: 0 |
| `pnpm --dir apps/web exec vitest run test/game-recap-score-serving.test.ts` | `web-serving`: 1 |
| `pnpm --dir apps/cloudflare exec vitest run --config vitest.config.ts test/runner-egress-elevenlabs.test.ts test/runner-egress-intercept.test.ts test/deploy-web-protocol.test.ts` | `cloudflare-focused`: 1 |
| `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/runner-egress-elevenlabs.test.ts apps/cloudflare/test/runner-egress-intercept.test.ts apps/cloudflare/test/deploy-web-protocol.test.ts` | `cloudflare-focused-2`: 0, `cloudflare-focused-final`: 0 |
| `pnpm --dir packages/assistant-engine exec vitest run test/recap-score.test.ts test/recap-media-files.test.ts test/assistant-codex-turn-planning.test.ts test/assistant-codex-voice-memo-dynamic-tools.test.ts test/assistant-codex-tool-input-contract.test.ts` | `engine-focused-2`: 0 |
| `pnpm exec vitest run --config packages/hosted-execution/vitest.config.ts packages/hosted-execution/test/game-chat-notifications.test.ts` | `contracts-hosted-tests`: 0 |
| `pnpm --dir apps/web exec vitest run test/game-recap-score-serving.test.ts test/game-recap-score-write.test.ts` | `web-score`: 0 |
| `pnpm --dir packages/contracts exec vitest run test/recap-show.test.ts test/song-timing.test.ts` | `contract-tests`: 0, `contracts-final`: 1, `contracts-final-2`: 0 |
| `pnpm verify:workspace-package-cycles` | `cycles`: 0 |
| `pnpm exec vitest run scripts/workspace-source-resolution.test.ts` | `source-resolution`: 1 |
| `pnpm verify:workspace-boundaries` | `boundary`: 0, `boundaries-final`: 0 |
| `pnpm --dir packages/cli exec vitest run test/vault-cli-import-surface-contract.test.ts` | `cli-import`: 0, `cli-import-final`: 1, `cli-import-final-2`: 0, `cli-import-complete`: 0 |
| `pnpm complexity:diff` | `complexity`: 1, `complexity-2`: 0, `complexity-final`: 0, `complexity-complete`: 0 |
| `pnpm docs:drift` | `docs`: 0, `docs-final`: 0, `docs-complete`: 0 |
| `pnpm --dir apps/web lint` | `web-lint`: 0, `web-lint-final`: 0 |
| `pnpm exec vitest run --config scripts/vitest.config.ts scripts/workspace-source-resolution.test.ts` | `source-resolution-2`: 0, `source-resolution-final`: 0 |
| `pnpm build:workspace:incremental` | `workspace-build-final`: 0 |
| `pnpm --dir packages/operator-config typecheck` | `audio-check`: 0, `audio-check-final`: 0, `audio-check-complete`: 2, `audio-check-complete-2`: 0 |
| `pnpm exec vitest run --config apps/cloudflare/vitest.e2e.config.ts apps/cloudflare/test/hosted-local-recap-files-e2e.test.ts` | `hosted-recap-journey`: 1 |
| `pnpm --dir apps/cloudflare runner:bundle` | `runner-bundle`: 1, `runner-bundle-2`: 0, `runner-bundle-final`: 0 |
| `pnpm test:assistant:live -- --test 'pair recap show scene requests are accepted on the first try'` | `live-recap`: 1, `live-recap-2`: 0, `live-recap-delivery`: 0 |
| `pnpm --dir packages/assistant-engine build` | `engine-build`: 0 |
| `pnpm --dir apps/web exec vitest run test/game-recap-media.test.ts test/game-recap-score-serving.test.ts test/game-recap-score-write.test.ts test/game-recap-score-upload.test.ts test/hosted-runtime-protocol-admission.test.ts` | `web-final`: 0 |
| `pnpm --dir packages/assistant-engine exec vitest run test/recap-score.test.ts test/recap-media-files.test.ts test/recap-workspace.test.ts test/assistant-game-tools.test.ts test/dynamic-tools-generate-image.test.ts test/assistant-codex-turn-planning.test.ts test/assistant-codex-voice-memo-dynamic-tools.test.ts test/assistant-codex-tool-input-contract.test.ts` | `engine-final`: 0 |
| `pnpm --dir apps/web exec vitest run test/game-recap-media.test.ts test/game-recap-score-write.test.ts` | `web-boundary-cases`: 0 |
| `git diff --check` | `diff-check`: 0 |
| `pnpm --dir packages/assistant-engine exec vitest run test/recap-score.test.ts test/recap-media-files.test.ts` | `engine-timing-final`: 0 |
| `pnpm --dir packages/operator-config exec vitest run test/elevenlabs-runtime.test.ts` | `audio-fixtures-typed`: 0 |

### Files changed by owner

- **Documentation**: `ARCHITECTURE.md`, `agent-docs/exec-plans/active/2026-11-14-recap-score.md`, `agent-docs/index.md`, `agent-docs/references/recap-show-contract.md`.
- **apps/cloudflare**: `apps/cloudflare/src/runner-egress-elevenlabs.ts`, `apps/cloudflare/src/runner-egress-intercept.ts`, `apps/cloudflare/test/deploy-web-protocol.test.ts`, `apps/cloudflare/test/helpers/hosted-web-protocol.ts`, `apps/cloudflare/test/helpers/pre-score-web-admission.ts`, `apps/cloudflare/test/hosted-local-recap-files-e2e.test.ts`, `apps/cloudflare/test/runner-egress-elevenlabs.test.ts`, `apps/cloudflare/test/runner-egress-intercept.test.ts`.
- **apps/web**: `apps/web/src/lib/game/chat-tool.ts`, `apps/web/src/lib/game/recap-asset-access.ts`, `apps/web/src/lib/game/recap-media.ts`, `apps/web/src/lib/hosted-execution/runtime-protocol.ts`, `apps/web/test/game-recap-media.test.ts`, `apps/web/test/game-recap-score-serving.test.ts`, `apps/web/test/game-recap-score-upload.test.ts`, `apps/web/test/game-recap-score-write.test.ts`.
- **packages/assistant-engine**: `packages/assistant-engine/src/assistant-codex/dynamic-tools.ts`, `packages/assistant-engine/src/assistant-codex/dynamic-tools/games.ts`, `packages/assistant-engine/src/assistant-codex/dynamic-tools/generate-song.ts`, `packages/assistant-engine/src/assistant-codex/generate-voice-memo-tool.ts`, `packages/assistant-engine/src/assistant-codex/generated-media-file.ts`, `packages/assistant-engine/src/assistant-codex/recap-song.ts`, `packages/assistant-engine/src/assistant/hosted-tool-context.ts`, `packages/assistant-engine/src/assistant/recap-files.ts`, `packages/assistant-engine/src/recap-show-testkit.ts`, `packages/assistant-engine/test/assistant-codex-real-e2e.test.ts`, `packages/assistant-engine/test/assistant-codex-turn-planning.test.ts`, `packages/assistant-engine/test/assistant-game-tools.test.ts`, `packages/assistant-engine/test/dynamic-tools-generate-image.test.ts`, `packages/assistant-engine/test/recap-media-files.test.ts`, `packages/assistant-engine/test/recap-score.test.ts`.
- **packages/contracts**: `packages/contracts/fixtures/recap-show/score-show.json`, `packages/contracts/src/recap-show.ts`, `packages/contracts/test/recap-show.test.ts`.
- **packages/hosted-execution**: `packages/hosted-execution/src/game-tools.ts`, `packages/hosted-execution/src/parsers/runtime-protocol.ts`, `packages/hosted-execution/src/recap-show-craft.ts`, `packages/hosted-execution/src/runtime-control.ts`, `packages/hosted-execution/test/game-chat-notifications.test.ts`.
- **packages/operator-config**: `packages/operator-config/src/elevenlabs-runtime.ts`, `packages/operator-config/src/generated-audio.ts`, `packages/operator-config/test/elevenlabs-runtime.test.ts`, `packages/operator-config/test/generated-audio.test.ts`.

### Parent proof and review

Task 7, real provider (2026-11-14, one request, `music_v2_5`). The runner's
`executeGenerateRecapSongFile` read a six-music-page draft and made one piece:

| What | Result |
| --- | --- |
| Provider requests | 1, seven chunks; the second take was not needed |
| Length | 50,040 ms measured for 50,000 ms asked |
| First sung word `F` | 30,020 ms, 20 ms into the sung chunk |
| Slice origin `C` | 29,808 ms, frame 1,242 of 2,085: 212 ms before `F`, inside the last instrumental chunk |
| Lyric words | 33 of 33 timed; no words before the sung chunk |
| Egress parser | Admits the exact request as music, 50,000 ms, and forwards the same content |
| Web upload validator | Accepts; stores `durationMs` 50,040 and `songStartMs` 29,808 |
| Write check | Passes for the draft's pages; refuses the same asset with one page fewer |
| `score` view | Byte-identical to the upload (1,201,004 bytes) |
| `song` view | 485,568 bytes, 20,232 ms, decodes without warnings, sample-identical to the score from 50 ms after the cut |
| Presentation | Page cues 0 to 25,000 ms in steps of 5,000; song cue 30,020 ms; score 50,040 ms; song 20,232 ms; first lyric word at 212 ms |

The upload, write, serving and presentation rows ran Web's real functions
under the Web test harness with the provider's bytes; storage, authorization
lookups and encryption were the harness's fakes.

After rebasing onto current main with no conflicts, the parent reran the
suites: contracts 506, operator-config 466, hosted-execution 27,
assistant-engine 361, Cloudflare 265 and Web 9 tests, six typechecks, the
workspace-boundary, package-cycle, source-resolution and scoped-CLI import
guards, `complexity:diff`, `docs:drift`, the prepared test-runtime build and
the runner bundle, all exit 0.

Candidate review: the diff follows the reviewed design point for point. Two
things to carry forward. The provider makes an on-time singer about three
takes in four, so roughly one show in four spends a second music request. In
one of the live-model journeys the author called `generate_song` twice, which
the six-request allowance permits.

Product UX: Feature. With this change alone a pair sees no new screen: an app
that does not read `score` keeps silent story pages and plays the sung part on
the song page, now starting on the singing with no intro. The score is heard
once an app build plays it. A show whose song fails is still submitted without
one. Ready for the server side; the app's playback is proven in its own
repository.
Completed: 2026-11-14
