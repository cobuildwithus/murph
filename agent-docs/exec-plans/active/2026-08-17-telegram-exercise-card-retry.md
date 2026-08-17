# Telegram exercise card retry guidance

Status: active
Created: 2026-08-17
Updated: 2026-08-17

## Goal

- Keep a multi-movement Telegram routine in one Rich Message.
- Preserve every named movement as its own exercise item, even when the routine
  groups movements into phases.
- Correct one rejected exercise-card call before using one image-free Rich
  Message fallback.

## Success criteria

- Prompt guidance maps every named movement to one card exercise item.
- Telegram guidance does not fall back to separate response-media messages.
- A validation rejection causes one bounded correction attempt using the
  returned field hints.
- Focused prompt tests, ReviewGPT prompt review, exact-head CI, and parent final
  review pass.

## Scope

- In scope: the exercise-card tool description, exercise catalog presentation
  guidance, focused prompt tests, and one public changelog item.
- Out of scope: card schemas, Telegram transport, media rendering, retries in
  runtime code, or changes to movement selection and safety.

## Constraints

- Reuse the current exercise routine card and generic Telegram Rich Message.
- Add no state, retry system, transport fallback, or dependency.
- Use synthetic examples only. Do not copy private screenshots or conversation
  wording into repository files.

## Tasks

1. [completed] Prove the current validation and media-fallback behavior.
2. [completed] Add the smallest prompt correction and focused regressions.
3. [completed] Run focused verification and inspect the final diff.
4. [in_progress] Push, open the PR, add the changelog item, and run specialist review.
5. [pending] Resolve findings, require green CI, close the plan, and prove
   current-base mergeability.

## Decisions

- Treat the observed same-turn rejection as card-argument validation. Telegram
  provider delivery happens after model completion, so it cannot explain a
  same-turn switch to gallery media.
- Allow one corrected retry only. If it still fails, use one complete generic
  Rich Message without images instead of separate image messages.
- Keep the measured-gap example inside the tool description. The shared skill
  points to that rule instead of repeating it.

## Verification

- Focused Assistant Engine prompt and skill-asset tests.
- Assistant Engine typecheck.
- Provider-input measurement for direct and group Telegram turns.
- Preliminary ReviewGPT product-experience, prompt, and coverage lenses.
- Exact-head required CI and current-base merge-tree proof.

The pinned real Codex App Server capture used identical synthetic direct and
group Telegram turns, `gpt-5.6-terra`, low reasoning, production code mode, and
`gpt-tokenizer` 3.4.0 `o200k_harmony`. It normalized generated item IDs,
temporary paths, and the repository path. The selected provider fields were
`include`, `input`, `instructions`, `parallel_tool_calls`, `text`,
`tool_choice`, and `tools` when present. Base and head were identical: direct
23,980 tokens and 110,833 bytes; group 20,553 tokens and 95,680 bytes. The
changed shared skill body and deferred exercise-card description are not part
of the first request. They become visible only after the matching skill or
tool is loaded.
