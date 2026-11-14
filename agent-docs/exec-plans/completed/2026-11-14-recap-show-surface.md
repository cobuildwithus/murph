# Recap show: material in files, media tools that take only what varies

Status: completed
Created: 2026-11-14
Updated: 2026-11-14

## Goal

- A pair recap show never loses scenes because the model was shown a cut-down
  tool result or was pointed at a reference the recap rejects.
- The recap media surface has nothing the model can get wrong that the turn
  already knows.

## Evidence

- Production, 2026-11-14: four parallel `generate_image` calls in one recap were
  each refused within about 20 ms with "image references could not be loaded".
  Only the runner-side reference-list check rejects that fast. One scene and
  the song were made; the show shipped with one scene instead of five.
- `read_game` returned the craft guide, game, posts, reference list, chat and
  lore in one tool result. That run's result was 54 KB. Codex cuts the middle
  out of a tool result past the model's output limit (10,000 tokens, about
  40 KB). The same morning a 42 KB result lost almost nothing and every scene
  worked.
- A real `gpt-6.1-sol` transcript at production size shows the model receiving
  "Warning: truncated output (original token count: 19896)" for `read_game`,
  then re-reading the game into a variable to work around it, and looking up
  the `generate_image` description. In 19 local runs on the old surface the
  model always recovered that way before making scenes, so the refusal itself
  did not reproduce; the cut is reproduced every time at production size.
- The generic `generate_image` definition offered to recap turns says to pass
  `skill-assets/murph-character-sheet-v1.png` whenever Murph appears. Recap
  file output accepts only the recap's own references. Players' references had
  photo files in the task directory; Murph's did not, and it is last in the
  list.
- Tool arguments are not logged, so the exact rejected reference is inferred,
  not observed.

## Decisions

- What `read_game` returns never grows with the game. It writes `game.json`,
  `chat.jsonl` and `lore.md` into the recap task directory and returns the
  craft guide and their paths. A file can be read in parts; a cut tool result
  cannot be recovered. The trusted context still owns material in memory; the
  files confer no authority.
- Every reference has a photo file, Murph's included, and a scene names a
  reference by that path or by its id. One rule, no special case for Murph.
- The turn decides the mode. In a recap show media is a file with a fixed
  format, so the recap `generate_image` takes a prompt and references, and the
  recap `generate_song` takes a style and lyrics. The `output` argument is
  removed from the generic tools, parsers and executors; the executors switch on
  the owning flow's file runtime. The refusals that existed only to police that
  argument are deleted.
- An unknown reference is refused in `prepareRecapMedia`, before any request,
  naming it and stating that no media request was used. The six-request
  allowance counts only requests forwarded to a provider, so that statement is
  true and the allowance is unchanged.

## Scope

- In scope: `recap-workspace.ts`, `hosted-tool-context.ts`, the image and song
  tool definitions, parsers and executors in `packages/assistant-engine`, the
  craft and turn instruction in `packages/hosted-execution`, the synthetic
  recap testkit, tests, and `ARCHITECTURE.md`.
- Out of scope: the media allowance, failure classification and alerts, logging
  tool arguments, the draft and `write_recap` contract, group and plain recaps.

## Risks and mitigations

1. Risk: the model reads less of the material now that it is in files.
   Mitigation: the craft tells it to read all three to the end and to read a
   long file in parts. Six real-model runs at production size read the chat in
   full and the game file, and each saved a show.
2. Risk: a recap continuation paused across the runner deploy resumes with a
   changed tool set and is refused.
   Mitigation: deploy the runner when no recap generation is in flight.
3. Risk: a reference string reaches something outside the recap's list.
   Mitigation: `recapReferenceId` only ever returns an id present in the
   in-memory material, and `fetchRecapReference` keeps its own check.

## Verification

- Unit: the `read_game` result is byte-identical for a one-post and a
  four-hundred-post game and under the model's output limit; every readable
  reference including Murph has a file; a path and an id both resolve; a skill
  asset, a vault path, an entry id and an unknown id do not; the recap turn
  overrides model-sent format and length; the recap tools expose only the
  varying parameters.
- Real model, synthetic Web and media, production instructions:
  `pair recap show scene requests are accepted on the first try` in
  `assistant-codex-real-e2e.test.ts`. Six runs on `gpt-6.1-sol`: 18 scenes and
  6 songs requested, none refused, 6 shows saved, `read_game` 18.9 KB once per
  run (52.8 KB twice per run before).
- `pnpm build:workspace:incremental`, package typechecks, `pnpm test:diff`.
Completed: 2026-11-14
