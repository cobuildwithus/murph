# Group reply cadence

Status: active
Created: 2026-07-30
Updated: 2026-07-30

## Goal

- Make Murph respond to an interactive group-chat burst as one conversational
  beat: pause briefly before the first text reply, extend once when the room is
  still active, then send one considered text bubble.

## Success criteria

- Ordinary interactive group replies run `sleep 4` before the first text reply.
- A human message arriving during that pause triggers one final `sleep 6`;
  total cadence sleep never exceeds 10 seconds.
- Murph re-reads the current room beat after the pause, answers once rather
  than per accepted message, and does not recap the burst point by point.
- Urgent safety and genuinely time-sensitive coordination skip the pause.
- Human-owned or otherwise silent beats remain immediate no-replies rather than
  being delayed.
- Group replies use one ordinary text bubble and do not use the `---` splitter.
- Direct-message reply timing and multi-bubble guidance remain unchanged.
- Focused prompt tests, typecheck, direct prompt readback, preliminary
  ReviewGPT product-experience/prompt/coverage review, and exact-head CI pass.

## Scope

- In scope:
  - Group system-prompt cadence and reply-shape guidance.
  - The packaged `group-chat` skill's matching guidance.
  - Prompt regression tests and the durable group social-dynamics spec.
- Out of scope:
  - Runtime debounce or pre-provider delay.
  - New database state, queues, timers, schedulers, wake owners, typing
    subscriptions, or delivery-layer bubble enforcement.
  - Changes to direct-message cadence or delivery.

## Constraints

- Technical constraints:
  - Reuse the existing active-turn steering path; prompt sleep is pacing only.
  - Preserve current floor ownership, privacy, safety, and immediate-silence
    rules.
  - Keep scheduled group updates within their existing one-message contract.
- Product/process constraints:
  - Prompt-primary product-timing change uses the worktree/PR lane.
  - Run the preliminary ReviewGPT product-experience, prompt, and coverage
    lenses before parent final review.
  - Measure complete initial provider-input impact for direct and group Murph.

## Risks and mitigations

1. Risk: the cadence rule could delay a required urgent response.
   Mitigation: explicit safety and genuinely time-sensitive coordination
   exceptions.
2. Risk: new wording could conflict with immediate silence on human-owned beats.
   Mitigation: apply the pause only before a text reply and retain explicit
   immediate no-reply branches.
3. Risk: shared texting guidance could continue advertising multiple bubbles.
   Mitigation: make thread-context reply guidance group-aware while preserving
   the existing direct-channel text.
4. Risk: model compliance remains probabilistic.
   Mitigation: ship prompt-only as the requested smallest experiment and defer
   runtime machinery unless production evidence proves it necessary.

## Tasks

1. Update the system prompt and group-chat skill with matching cadence and
   one-bubble rules.
2. Update prompt regression tests and the durable group behavior spec.
3. Run focused tests, typecheck, prompt readback, and provider-input
   base-versus-head measurements.
4. Run the required preliminary ReviewGPT product-experience, prompt, and
   coverage lenses; resolve accepted findings.
5. Complete parent review, close the plan, commit/push, require green exact-head
   CI, and hand off the clean PR head.

## Decisions

- Use prompt-level shell sleep because the live-turn steering primitive already
  admits new messages and no new durable owner is needed.
- Use 4 seconds normally and one 6-second extension only when new human input
  arrives during the first pause.
- Keep this first implementation prompt-only; delivery behavior is unchanged.

## Verification

- Commands to run:
  - Focused assistant-engine prompt tests.
  - Assistant-engine typecheck or the narrowest truthful package verification.
  - `git diff --check` and direct assembled-prompt readback.
  - Complete base/head initial provider-input measurement for direct and group.
  - Exact-head GitHub Actions and PR-head preflight.
- Expected outcomes:
  - Group prompt contains the cadence and one-bubble contract without the old
    direct-ask no-wait conflict.
  - Direct prompt retains immediate reply and multi-bubble guidance.
  - All required checks and reviews pass with no unresolved actionable finding.

## Verification log

- Focused assistant-engine prompt and planning suite: 4 files, 170 tests passed.
- Assistant-engine typecheck: passed.
- Direct/group prompt readback: direct omits group cadence and retains texting
  bubbles; group contains `sleep 4`, one optional final `sleep 6`, the 10-second
  ceiling, and the one-bubble rule.
- Complete first-provider request capture with pinned real Codex App Server,
  `gpt-5.6-terra`, low reasoning, code mode, and `gpt-tokenizer` 3.4.0
  `o200k_harmony`:
  - Individual: 29,233 tokens / 134,110 bytes at base and head.
  - Group: 24,125 tokens / 110,266 bytes at base; 23,960 tokens / 109,552 bytes
    at head (`-165` tokens / `-714` bytes).
  - The delta is entirely assembled group instructions. Dynamic tools, schemas,
    Codex-generated guidance, and other provider-visible input are unchanged.
  - Transport-only model, stream, reasoning, service tier, storage, cache key,
    and client metadata were excluded identically; local paths were normalized.
    The temporary capture harness was removed.
