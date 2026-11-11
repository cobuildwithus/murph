# Pair recap presentation v1

The `recap` field of `GET /api/game/v1/games/:id` uses the schemas in
`packages/contracts/src/recap-show.ts`. Use existing native bearer authentication;
there is no recap capability header. Groups and historical plain stories retain
their existing `pages`, `superlatives`, `scoreLine` and `chatLine` representation.
New pair shows have empty top-level `pages` and ordered `show.pages`.

Stable synthetic decoder fixtures live in `packages/contracts/fixtures/recap-show/`:
`full-show.json`, `failed-scene-no-song.json`, and `legacy.json`. IDs, names, words and URLs are synthetic.

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
  background, interruptions or access loss. No song or scene is attached to chat.
- `result`: render the surrounding game response's canonical result and prize.
  `scoreLine` is optional copy, never a second score owner.

Generated `media.status` is `ready` or `failed`. Media is final at acceptance. Ready media
has `url`, `mediaType` (`image/jpeg` or `audio/mpeg`) and optional `width`, `height`
or `durationMs`. A scene's `fallback` is `photo` with one authorized entry ID, or
`text` with none. Failure must preserve setup, payoff and the result.

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

Native layout and audio acceptance belong to the iOS owner. Local PNG previews
are composition evidence, not proof of native visual parity.
