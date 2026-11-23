# Pair recap presentation v1

The `recap` field of `GET /api/game/v1/games/:id` uses the schemas in
`packages/contracts/src/recap-show.ts`. Use existing native bearer authentication;
there is no recap capability header. Groups and historical plain stories retain
their existing `pages`, `superlatives`, `scoreLine` and `chatLine` representation.
New pair shows have empty top-level `pages` and ordered `show.pages`.

Stable synthetic decoder fixtures live in `packages/contracts/fixtures/recap-show/`:
`full-show.json`, `full-show-video.json`, `score-show.json`, `failed-scene-no-song.json`, and `legacy.json`. IDs, names, words and URLs are synthetic.
`envelope.json` and `envelope-video.json` are the stored envelope without and
with a video; they are server fixtures, never sent to a client.

`show` contains `version: 1`, `generationId`, `treatment`, `acceptedAt` and `pages`. Page IDs are stable within a generation. Replace the
complete generation when its ID changes. Ignore unknown optional fields and skip
unknown page/block kinds without losing readable text or the canonical result.

Every page has `id`, `kind`, `background` and `blocks`. Backgrounds are `night`,
`paper`, `sage`, `sienna` and `slate`. Page kinds are:

- `cover` and `scene`: insert the generated image at zero-based `imageIndex`
  among `blocks`. Setup goes above, payoff below; copy is outside the picture.
- `print`: real pictures in `photo`, `photoPair` or `contactSheet` blocks, resolved
  by `entryIds` through the existing authorized game-entry projection. Show each
  whole, orientation-correct photo with contain sizing, never crop it.
- `text`: `headline`, `kicker`, `quote` or `stat` blocks. Quotes carry `who`, `text`
  and optional `date`; stats carry `statValue` and `text`.
- `superlative`: exactly one `card` with `memberId`, `title`, `line`. Render
  “Most likely to…” above the title. A pair has zero to two such pages.
- `song`: `song.title`, `song.lyrics` and ready audio media. It precedes the result
  and is omitted when generation fails. One playback owner stops on dismissal,
  background, interruptions or access loss. No song or scene file is attached to
  chat; with the video on, the recap message's first send carries the whole
  recap as one video (`show.video`'s file), real photos included, beside the
  line, and the link still goes alone.
- `result`: render the surrounding game response's canonical result and prize.
  `scoreLine` is optional copy, never a second score owner.

When word timings exist, `song` also has optional
`lines: { words: { text: string, startMs: number, endMs: number }[] }[]`.
There is exactly one entry per lyric line. Its words retain that line's spelling
and punctuation, split on whitespace; joining `text` with spaces reproduces the
line with collapsed whitespace. Case and punctuation normalization aligns sung
words in order, skips sung extras, and interpolates missing lyric words between
matched neighbors (audio start/end at the edges; in a score, the first sung word
instead of the audio's start). Times are non-decreasing integer
milliseconds from the start of the audio, bounded by its measured duration.
Historical songs without timings omit `lines`; existing fields remain unchanged.

In a recap, `generate_song` takes `{draftPath, voice}` and reads the final pages,
style and lyrics from the draft. Its music_v2_5 composition plan has one
five-second instrumental chunk per music page, followed by twenty seconds of
singing. Music pages are the authored pages (first is the cover), then the cards.
The host binds the generated audio hash to their ordered kinds, style and lyrics
in attempt-local memory. Changing that sequence, style or lyrics requires a new
song; text edits, same-kind page swaps and card swaps remain valid. The host keeps
raw provider timings with the hash, then uploads and stores them on the encrypted
song asset. Editable draft files
still select only `{slot,path}`. New authoring caps `treatment` at 40 characters,
gives the cover exactly one headline (its title) of at most 24 characters, and caps
every other headline at 48; transport, stored reads and accepted replay retain
historical longer treatments and headlines. The app sets only a cover's first
headline, stepping it down from 58 points to keep it to three lines.

A score adds optional `show.score: { media }` and `show.pages[].cueMs: number`.
All times are milliseconds. The score media has the same ready-media shape and
its `durationMs` is the full measured duration **T**. Authored pages and cards
have `cueMs = 5000 * index`. The song page has `cueMs = S`, where
`S = 5000 * music pages` is where the sung chunk begins, so every story page
keeps its five seconds and a singer who comes in late lengthens the song's own
opening instead. **F** is the first raw word with positive duration at or after
S; zero-length provider direction words and words before S are ignored, and a
score without F has no cues. A score stored before songs started by S (its C is
after S) keeps `cueMs = F`. The result has no cue.

The stored `song` asset alone gains optional `songStartMs: number`, **C**, the
latest frame boundary at or before both `F - 200` and S. It may precede the sung
chunk by up to 200 ms and one frame, and is never after the song page's cue.
Because a late singer's song page opens on the band, the host makes another
take while F is more than 1 s after S, at most three takes in all, and keeps
the earliest valid singer; a refused or failed retake ends the retakes and
never replaces an earlier take. This field is not exposed on the show. The
`score` URL slot serves the full stored MP3; the `song` slot serves its bytes
from C, after the same authorization and
full-file integrity check. Scene slots remain `scene-0` through `scene-6`.
There is no extra stored asset or editable `score` slot. Song media duration is
`T - C` and its lyric `lines` remain relative to C, so existing clients keep
playing the song and highlighting lyrics as before.

A client playing the score uses `cueMs` for page turns and tap-to-seek, and
lights lyrics using `scoreMs - (score.media.durationMs - song.media.durationMs)`.
It fetches only the `score` audio. For example, `score-show.json` has T=55008,
S=35000, F=35300 and C=34992: song duration is 20016, song cue is 35000, and its
first word begins at 308 on the song clock. Time fields are JSON numbers; frame-derived
values may be fractional milliseconds, while aligned lyric words use integer
milliseconds. Without ready score media, use the existing song-only behavior.
Historical songs without `songStartMs` have no score or cues and are unchanged.

Generated `media.status` is `ready` or `failed`. Media is final at acceptance. Ready media
has `url`, `mediaType` (`image/jpeg` or `audio/mpeg`) and optional `width`, `height`
or `durationMs`. A scene's `fallback` is `photo` with one authorized entry ID, or
`text` with none. Failure must preserve setup, payoff and the result.

`show.video` is optional: the whole recap as one MP4. It has `mediaType`
(`video/mp4`), `byteLength`, `durationMs`, `width`, `height` and one to four
ordered `parts`, each a `url` and a `byteLength`. Download every part with the
same bearer and join the bytes in order; the result is the file only when its
length equals `byteLength`. A part alone is not playable and is served as
`application/octet-stream`. The field is absent when the recap has no video or
the media visibility switch is off, and a part answers 404 once any source the
video shows is no longer permitted. Shipped decoders ignore the field.

Media URLs are relative to the API origin, require the same bearer, and bind a
specific generation. Fetch privately without shared caching; clear cached bytes
on logout, access loss or generation replacement. Stale, denied and unavailable
media use fallback. Shows finish media before acceptance. There is no pending variant, publication
deadline or polling hint; clients never poll for media completion.

The public `/recap/:gameId` page remains an app handoff. Its opaque `preview`
capability allows only the composed cover at `/recap/:gameId/cover/:token`, for
at most thirty days and subject to current authorization. It grants no private
API, transcript, source-photo or audio access. The media visibility switch hides
generated media and cover previews while retaining readable text.

An optional cover scene `faceY` in [0,1] records the players' face position as a
fraction of image height from the top. The preview centers its full-width
1200:630 band there, clamped to the image bounds. Missing hints retain the
top-62%-band attention crop. The field is author-supplied image inspection data;
the preview route runs no face detector.

Deploy compatible Web before Cloudflare Worker egress and the runner bundle.
Runtime admission requires a score upload and asset witness parsed by Web's
actual schemas before activation. Worker accepts legacy single chunks and scores;
new runners produce scores only. Legacy uploads receive receipts without
`songStartMs`. Keep compatible Web while scores are produced: an older strict
asset reader drops a score asset and retains the readable show without music.
Show write/replay/recovery responses omit the optional full-story echo, preserving
old strict runner decoders; the top-level canonical chat line remains. Keep the
compatible Web reader once new envelopes with timings or face hints are stored.

A stored envelope with `video` cannot be read by a Web release that predates
the field, so that reader stays deployed once a video is stored. Web returns the
accepted video's identity (`recapVideo`) only to a runtime whose request asked
for it, because older runtimes refuse unknown result fields.
A recap wake may carry `video: true` beside `show: true`, and a stored outbox
intent may carry `recapVideo`. A runtime that predates either refuses that wake
and quarantines that intent, so the runtime and the Worker that decodes wakes
ship before Web queues the first such wake.

The authoring preview tool is removed. Native layout and score playback belong
to the iOS owner; the additive contract preserves installed-client song playback.
A failed regeneration keeps the current generation. A first-time failure uses
the historical plain-story representation.
