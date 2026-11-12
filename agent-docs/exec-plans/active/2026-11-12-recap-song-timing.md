# Recap lyrics, short premises and centered cover crops

Status: active
Created: 2026-11-12
Updated: 2026-11-12

## Goal

Recap songs use explicit lyrics and expose word timings for the native player.
New show premises contain at most 40 characters. Cover previews center on the
face position selected by Murph from the generated image.

## Success criteria

- The song page preserves title and lyrics and optionally adds exactly
  `lines: { words: { text: string, startMs: number, endMs: number }[] }[]`.
  There is one entry per lyric line, with the lyric's whitespace-separated words
  and punctuation preserved. Times are non-decreasing integer milliseconds.
- Explicit lyric generation passes the lyrics structurally to ElevenLabs and
  requests word timestamps; missing usable timing evidence is a tool failure.
- Old recaps remain readable, omit timing lines, and use the existing cover crop.
- Focused tests, relevant typechecks, candidate review, required final ReviewGPT
  and exact-head CI pass. Open a ready PR; do not merge or deploy.

## Scope

- In scope: existing song tool, provider adapter, bounded Worker egress,
  recap schemas/submission/projection, preview crop, code tests and changelog.
- Out of scope: all model-facing prose and prose tests, iOS, production data,
  recap regeneration, deployment and merging. New parameter descriptions use
  the exact placeholder `TODO(prompt)` for the owner to replace.

## Constraints

- No new dependencies, services, queues, provider passes or face detection.
- Synthetic public-safe data only. Preserve existing auth, media visibility,
  reference checks, encrypted persistence and generated-MP3 validation.
- All work stays on fix/recap-premise-lyrics; no stash or unrelated mutations.

## Evidence and owners

- `generate_song` accepts a prompt but no lyrics. `generateElevenLabsMusic`
  calls `music.compose` with prompt, forceInstrumental and musicLengthMs.
  `forceInstrumental: false` does not require vocals. No transcription or
  timestamp metadata reaches the recap. This proves a code-path failure mode,
  not the precise provider behavior of any particular historical recording.
- `assistantVoiceMemoMusicModelId` is `music_v2`. SDK 2.62.0 supports both
  v1 MusicPrompt sections and v2 CompositionPlan chunks. Use one v2 chunk
  containing the supplied lyrics joined by newlines and the existing prompt
  as its positive style; do not switch models or invent provider instructions.
- SDK `music.composeDetailed` already separates multipart JSON and audio,
  including camel-casing metadata. Its declared wrapper JSON type omits word
  timestamps, so validate the actual metadata rather than casting it blindly.
- Cloudflare currently admits only prompt-based `/v1/music`. Its existing
  validator and usage owner must also recognize the exact detailed request
  and derive billed duration from the bounded composition chunk.
- Accepted encrypted recap assets own provider timings for that song. The
  native projection derives lyric-word alignment; no second canonical story.
- Preview capability already reads the accepted envelope. Return the cover's
  optional scene.faceY alongside its authorized bytes and keep private headers.
- Primary external references: [detailed compose](https://elevenlabs.io/docs/api-reference/music/compose-detailed)
  and [v2 composition plans](https://elevenlabs.io/docs/eleven-api/guides/how-to/music/composition-plans).

## Risks and mitigations

1. Detailed metadata is untrusted and SDK buffering is unbounded by default.
   Keep the existing 16 MiB bound over declared and streamed response bytes,
   deadline, zero automatic retries, safe error categories and MP3 validation.
2. Missing/malformed timestamps or a song with no matching lyric words must
   not look like successful timed singing. Reject explicit-lyrics generation
   before saving when there is no usable evidence. Retain ordinary prompt-only
   chat/instrumental behavior because it remains a live supported path.
3. Lyrics/timestamps can differ in case, punctuation, omissions, or added words.
   Use bounded ordered sequence alignment, skip sung extras, interpolate
   unmatched lyric words between anchors (audio start/end at the edges), and
   clamp/round monotonically. Never replace displayed lyrics with transcription.
4. New producer fields fail old strict readers. Deploy Web first, then the
   Cloudflare runner (Worker egress plus container). New Web accepts old assets
   and old long premises; warm old containers continue prompt-only requests.
   New containers require the updated Worker before detailed generation.
   Keep the compatible Web reader after new envelopes are accepted; rolling
   back below it requires stopping new writers and handling incompatible data.
5. Model guidance is owner-controlled. Deterministic code proof can complete;
   new live prompt-routing acceptance remains pending owner-authored guidance.
   Do not author a live-test prompt to work around that boundary.

## Tasks

1. Run the explicitly requested architecture ReviewGPT on this plan before
   implementation; record each finding's evidence-based disposition below.
2. Add optional bounded `lyrics` to generate_song for file output, reject
   instrumental/conflicting or overlong single-chunk calls, and request
   composeDetailed with the existing music_v2/output format and timestamps.
3. Return `{ path }`; retain optional timestamps in the existing host receipt
   keyed by audio hash, validate and forward them on that asset during submission.
   Store them in the existing encrypted envelope and derive the exact song
   presentation shape with a pure tested alignment function.
4. Cap new treatment at 40, leave stored treatment permissive, add optional
   scene.faceY in [0,1], and vertically center/clamp the full-width 1200:630 crop.
   Missing faceY retains today's top-62%-band attention fallback.
5. Add focused request, alignment, schema/projection, submission, egress and
   crop tests; update the durable recap contract and index; add a changelog.
6. Run relevant checks, inspect privacy and the full diff, commit/push and open
   the PR as draft. Mark ready after proof; run final ReviewGPT concurrently
   with CI. Resolve accepted findings, close the plan, verify final-head CI and
   current-main mergeability, then hand off without merging.

## Decisions

- Extend existing owners rather than introducing a song pipeline or an image
  inference service. Keep music_v2 via its SDK-supported chunk plan.
- Keep optional timestamps in the existing host receipt and encrypted asset,
  avoiding editable timing copies, sidecars or a parallel metadata store.

## Product UX

- Effort: Patch. Outcome: explicit recap singing, matching highlight words,
  short premises and face-centered link previews.
- Reaches: new timed shows, historical untimed shows, partial/missing provider
  metadata, missing face hints, and edge-of-image face positions.
- Proof: provider-shaped response through tool receipt, draft, accepted asset
  and native projection; synthetic image crop pixels; legacy schema reads.
- Native rendering/playback and owner-authored guide acceptance belong to the
  app/guide owner. No claim that local mocks prove live singing quality.

## ReviewGPT plan disposition

Completed before implementation using GPT-6 Pro on the requested Apollo lane;
the sent model was verified and the response ended with REVIEW_COMPLETE.
Private review capture: `audit-packages/plan-recap-song-timing.md`.

1. Accepted: preserve timings in the existing host receipt keyed by MP3 hash.
   `hosted-tool-context.ts` already has `recapSources`; extend its metadata and
   the existing save/upload calls. Draft selections remain `{slot,path}`.
   The implementation tasks reflect this revision. No sidecar,
   additional runtime method or model-copied timestamp array is needed.
   Validate matching anchors again against final lyrics before acceptance.
2. Accepted: remove the unused full-story echo from show completion, replay and
   recovery responses. Consumers use the top-level canonical chatLine; plain
   recaps still need their story for lore. Omitting this optional field is
   accepted by old strict response decoders and prevents faceY deploy skew.
3. Accepted: use the historical show shape for transport and stored reads,
   deriving the 40-character writer schema from it. Existing replay must run
   before new-write validation. Old producers' overlong first writes receive
   validation errors; already accepted long stories remain readable/replayable.
4. Accepted: move aggregate response bounds before SDK multipart consumption,
   reuse the existing bounded reader, and delete the duplicate audio collector.
   Preserve error classification, deadline, cancellation and zero retries.

No material plan findings rejected. The SDK/runtime typing and parsing claims
will be verified with the installed SDK and provider-shaped synthetic responses.

## Verification

- Focused Vitest suites for operator-config ElevenLabs, assistant-engine song
  and recap submission, contracts recap projection/alignment, Web preview and
  Cloudflare egress; relevant package/app typechecks and doc/changelog checks.
- Run `pnpm complexity:diff`, inspect changed hotspots and the complete diff.
- Run existing applicable live assistant proof only if it can verify this
  change without adding/editing model-facing text or invoking real media.
  Otherwise explicitly report the owner-guidance acceptance boundary.
- Required exact-head GitHub CI owns broad verification; final ReviewGPT owns
  the external candidate review. No production providers or private data needed.

## Implementation evidence

- Existing music_v2 remains pinned. Explicit file lyrics produce one bounded
  composition chunk and request timestamps. The installed SDK's multipart
  parser is exercised with synthetic responses; validation and MP3 decode
  complete before any file is saved. HTTP diagnostics use the bounded fetch
  receipt because the SDK wrapper erases its original error class.
- Timings follow the existing audio-hash receipt through file selection,
  upload, encrypted acceptance and presentation. Deterministic tests cover
  two separate receipts, byte tampering, missing timing anchors, repeated
  words, interpolation, clamping, preserved punctuation and exact line shape.
- Preview pixel tests cover top/middle/bottom hint positions, clamping,
  landscape images and the historical attention fallback. Authorization,
  source-reference revocation and hash checks remain in the existing reader.
- PostgreSQL proof uses an isolated local test database and real encrypted
  persistence for zero/one/two superlative cards, canonical retries, song
  timings, face position and reference revocation. Its decoder boundary is
  mocked; separate real-byte media tests own MP3/duration validation.
- First provider input was captured with the pinned real Codex binary and a
  scripted loopback provider at base 9d0adef690 and the candidate. Individual:
  123473 -> 123473 UTF-8 bytes; group: 154033 -> 154033 bytes (both delta 0,
  0%). Shared dependencies/model catalog remain at candidate; prompt_cache_key
  is excluded. Exact GPT-6.1 Sol tokenizer is unavailable; no token estimate.
  These ordinary fixtures do not load the deferred song schema.
- No production audio was inspected or regenerated. Live singing quality,
  new model-guidance acceptance and native highlighting remain with the owner.
  Product UX: code proof Ready; end-to-end release Hold until owner-authored
  guidance replaces the one TODO(prompt) description and iOS playback is checked.
- Parent review removed a duplicate audio collector and redundant SDK error
  fallback parsing, isolated file-song handling and show validation, and kept
  timing validation lazy on the explicit-lyrics generation path.

## Candidate verification

- Contracts recap/alignment: 20 passed. Provider runtime: 38 passed.
- Assistant song/file/submission suites: 134 passed. Hosted contract suite:
  33 passed with MURPH_VERIFY_RECAP_SKEW=1 (six unrelated opt-in cases skipped).
  The original 9d0adef690 runner schema accepts the new small receipts and
  rejects a faceY story echo; new transport accepts long historical replay.
- Web media/preview/chat suites: 60 passed. Local PostgreSQL acceptance cases:
  3 passed (88 unrelated cases filtered), including encrypted timing projection.
- Cloudflare admission/interception suites: 222 passed.
- Contracts, operator-config, hosted-execution, assistant-engine, Web and
  Cloudflare typechecks passed. Documentation drift, changelog generation,
  diff whitespace and added-diff privacy checks passed.
- Complexity guard passed on all 13 source files. Existing host-context (57)
  and provider-fetch adapter (22) hotspots retain their prior debt; new ordered
  alignment peaks at 20 and its work is schema-bounded.
- Final external review and exact-head CI remain pending PR admission.
