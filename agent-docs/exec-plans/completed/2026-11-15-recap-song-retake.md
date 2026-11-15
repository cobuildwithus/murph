# Retake a recap song whose singer comes in late

Status: completed
Created: 2026-11-15
Updated: 2026-11-15

## Goal

- In a pair recap, the singing starts at the song page's opening, or within
  about a second of it. Since murph #5012 the song page opens on the planned
  start of the singing, so a late singer plays as band alone at the top of the
  song page. Both production recaps made on 2026-11-15 opened that way, about
  five seconds (two bars) of band before the first word.

## Success criteria

- A song call whose first sung word is more than 1 s after the planned start
  makes another take, at most three takes in all, stops at the first take
  within 1 s, and keeps the take whose singer is earliest.
- Every take passes the existing checks (length, a first sung word inside the
  file, a frame cut, lyric alignment) before it can be kept. A refused, failed
  or invalid retake never replaces a valid earlier take, and ends the retakes.
- Cancellation propagates at any take and saves nothing.
- The recap's media allowance leaves room for four scenes and three takes, and
  the writer's guide states the new budget.

## Scope

- In scope: the recap song tool, the Worker's in-memory recap media counter,
  the writer's guide, the contract and owner docs, the changelog item, tests.
- Out of scope: the score plan itself (measured below, unchanged), the egress
  parser and pricing (unchanged: every take is the same admitted request and is
  priced by its own duration), a per-kind media quota, a dollar ceiling, the
  first take's failure handling (the writer still decides whether to call again).

## Design

- `executeGenerateRecapSongFile` restores the per-take closure that existed
  before #5012 and loops: while fewer than three takes are made and the kept
  take's singer is more than 1,000 ms after the planned start, make another
  take; keep it only when its singer is earlier; on any retake error rethrow if
  aborted, otherwise stop retaking. The saved file, its timings and its
  `songStartMs` always come from one take.
- `RunnerContainer.consumeRecapMediaRequest` allows seven forwards per recap
  event instead of six: the guide's four scenes plus three takes.
- The guide says: seven media requests in total, keep three for the song,
  which may make up to three takes on its own, at most four for scenes.

## Budgets

- Media requests: the counter is the only hard bound and counts any mix of
  image and music forwards, failed forwards included. It rises from 6 to 7.
  With four scenes made first (the guide asks for the song last), the song
  call can now make its two retakes; before this change it could not retake.
  A writer that regenerates the song after a three-take call is refused at the
  counter and submits the show without a song, as the guide already says.
- Music egress and pricing: unchanged. The Worker admits each take as it
  admitted the one take (a 25 to 65 s score), records usage per request, and
  Web prices music at $0.15 per generated minute.
- Cost per song call: one take is 25 to 65 s of music, $0.06 to $0.16. Three
  takes are at most 195 s, $0.49 (65 s scores), against $0.16 before. The
  per-recap worst case is now seven forwards of any kind instead of six; at
  the guide's split it is four scenes plus at most $0.49 of music.
- Time: measured take latency is 5.1 to 11.0 s (mean 7.6 s, 20 takes; 5.1 to
  5.8 s at 4 pages, 6.6 to 8.2 s at 7, 7.8 to 11.0 s at 9). A three-take call is about 30 s at the measured worst; each take is
  still bounded by the existing five-minute music timeout, so the hard ceiling
  is 15 minutes, against 5 before. A recap turn has no separate deadline
  (`resolveCodexAttemptAbortSignal` exempts recap shows) and Codex sets no
  dynamic-tool timeout, so nothing new can time out. The app's ten-minute
  recap wait is unchanged; typical recaps finish in about five minutes.
- Expected takes per call: about 1.4 at the measured 33 % late rate; with
  independent takes, a call ends late about 4 % of the time (0.33 cubed).

## Measurements

Real ElevenLabs `music_v2_5` takes, one request at a time, through the real
song tool (`executeGenerateRecapSongFile`) with a fetch wrapper that timed and
parsed each take and refused any request past its run's take limit. Four
synthetic shows of 4, 7, 7 and 9 music pages. 20 generations in total.

1. Current plan against one variant, interleaved over two rounds, one take per
   run (a late take's retake was refused by the wrapper, so this also ran the
   real refused-retake path: the late take was kept).
   - Current plan, 8 takes, singer lateness in ms: 620, 1240, 40, 280, 20, 20,
     4980, 120. More than 1 s late: 2 of 8.
   - Variant (the sung chunk without the negated positive style "no
     instrumental intro"), 8 takes: 20, 5280, 320, 1220, 2480, 600, 600, 20.
     More than 1 s late: 3 of 8. Not better; not adopted.
2. Real retake path, up to three takes per run (budget ran out after two runs):
   - 9 pages: 5480, then 600; kept the 600 ms take; 19.9 s for the call.
   - 7 pages: 4980, then 20; kept the 20 ms take; 15.0 s for the call.

All 20 takes returned HTTP 200 and passed every check the song tool makes
(length, frame cut, lyric alignment), with no sung word before the planned
start. Late entries land near half-bar multiples at 96 BPM (1.2, 2.5, and 5.0
to 5.5 s), so the provider sometimes plays one to two bars of band at the top
of the sung chunk. The current plan was more than 1 s late in 4 of its 12
takes here (the two retake runs used shows that had been late before), and in
3 of 9 takes of the same plan measured on 2026-11-14: 7 of 21, about 33 %.

No provider documentation or prior measurement gave strong evidence for a
different plan; the ElevenLabs composition plan guide shows section tags
followed directly by lyrics, which the plan already does. Only the one variant
above was tried.

## Risks and mitigations

1. Risk: takes are not independent for some drafts, so a draft that is late
   once is late three times. Mitigation: the earliest take is still kept, and
   the outcome is no worse than today's single take. Both real retakes above
   came in on time on the first retake.
2. Risk: a slow provider makes three takes slow. Mitigation: a failed or timed
   out retake ends the retakes; the measured worst take is 11 s.
3. Risk: deploy skew between the Worker counter and the runner. Mitigation:
   the Worker (with the counter) rolls before the runner. A new runner against
   an old counter of six can retake once after four scenes; the second retake
   is refused and the earlier take kept. An old runner never uses the seventh.

## Tasks

1. Retake loop and tests in the song tool.
2. Counter, guide, contract and owner docs, changelog.
3. Real-provider measurement and the real-model recap journey.

## Decisions

- Threshold 1,000 ms, as the owner asked: a singer within a second reads as on
  the page's opening. The cut keeps its 200 ms preroll.
- Stop on a failed retake rather than continue: a refusal will repeat, and a
  provider failure or timeout should not cost two more requests or ten more
  minutes.
- The first take's failure still returns to the writer, which can call again
  within its budget; retakes only improve a valid take.
- Seven, not eight: one more forward than today is enough for three takes
  after four scenes and keeps the worst case closest to today's.

## Verification

- `pnpm --dir packages/assistant-engine exec vitest run test/recap-score.test.ts test/recap-media-files.test.ts test/assistant-game-tools.test.ts --no-coverage`
- `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts --no-coverage apps/cloudflare/test/runner-supervised-invocation.test.ts apps/cloudflare/test/runner-egress-intercept.test.ts apps/cloudflare/test/runner-egress-elevenlabs.test.ts`
- `pnpm --dir packages/hosted-execution exec vitest run test/game-chat-notifications.test.ts --no-coverage`
- Changelog generate and page test; typechecks for the engine, hosted
  execution, Cloudflare and Web; `pnpm complexity:diff`; `pnpm docs:drift`.
- `pnpm test:assistant:live -- --test "pair recap show scene requests are accepted on the first try"`
- Red check: the retake tests fail against the base song tool.
Completed: 2026-11-15
