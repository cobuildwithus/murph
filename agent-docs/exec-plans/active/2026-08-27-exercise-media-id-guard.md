# Keep exercise catalog IDs private and deliver reviewed media

Status: active
Created: 2026-08-27
Updated: 2026-08-27

## Goal

- Keep exercise-catalog identifiers out of member-facing replies and make
  reviewed catalog images the default visual for just-in-time Linq/iMessage
  exercise instruction when useful catalog media exists.

## Success criteria

- A scheduled movement cue that teaches one exercise attaches the smallest
  useful returned catalog-media set on Linq/iMessage.
- A later request to see that exercise reuses returned catalog media instead of
  invoking image generation when useful media exists.
- Member-visible text names the exercise naturally and contains no catalog id,
  source token, path, or other routing identifier.
- Deterministic prompt/skill tests and one focused real-Codex journey prove the
  required and forbidden effects.

## Scope

- In scope: the shared exercise-catalog presentation contract, its deterministic
  tests, and a synthetic Linq/iMessage real-Codex journey.
- Out of scope: catalog content or image regeneration, delivery infrastructure,
  database changes, Telegram routine-card behavior, and production writes.

## Constraints

- Technical constraints: reuse `murph.attach_response_media`; preserve current
  catalog lookup and response-media owners; do not add state, a fallback queue,
  or a second delivery path.
- Product/process constraints: Product UX Patch; keep private production
  evidence out of repository artifacts; use worktree/PR, focused local proof,
  preliminary prompt/Product UX/coverage ReviewGPT, and the final gate only if
  the completed diff triggers it.

## Risks and mitigations

1. Risk: stronger image wording could attach media to setup-only or review
   turns where it adds noise.
   Mitigation: preserve the existing instructional-turn gate and strengthen
   only just-in-time teaching/cueing plus explicit image requests.
2. Risk: the assistant could copy catalog ids through alt text, source tokens,
   or prose while still attaching the right media.
   Mitigation: define ids/source tokens as tool-only routing data and assert
   their absence from the final reply while keeping exact source construction
   inside the media tool call.
3. Risk: the model could generate a slower substitute despite reviewed media.
   Mitigation: explicitly require returned catalog media first and assert zero
   `generate_image` calls in the live journey.

## Tasks

1. Encode the member-visible identifier and reviewed-media precedence rules in
   the shared exercise-catalog contract.
2. Add deterministic contract coverage.
3. Add and run one synthetic production-derived Linq/iMessage real-Codex
   journey covering both the scheduled cue and missing-image follow-up.
4. Run focused checks, inspect replies/diff, complete required ReviewGPT gates,
   commit, push, open the PR, and require exact-head CI.

## Decisions

- Keep this prompt-primary. Production evidence shows the model skipped an
  existing tool call; delivery and image generation themselves succeeded, so
  no delivery state machine or runtime fallback is warranted.
- Reuse catalog media before generated media. Reviewed catalog assets are
  faster, cheaper, and already carry movement-specific step/alt metadata.

## Verification

- Commands to run:
  - focused assistant skill/prompt Vitest for the shared contract
  - focused real-Codex journey with `pnpm test:assistant:live -- --test <name>`
  - `pnpm typecheck`
  - `git diff --check`
- Expected outcomes: every deterministic check passes; live tool assertions
  show exact catalog lookups and response-media attachment, zero image
  generation, and concise identifier-free member-visible replies.
