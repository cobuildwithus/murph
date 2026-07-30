# Group reply cadence

Status: completed
Created: 2026-07-30
Updated: 2026-07-30

## Goal

- Make Murph respond to an interactive group-chat burst as one conversational
  beat: pause briefly before the first text reply, extend once when the room is
  still active, then send one considered text bubble.

## Success criteria

- Ordinary interactive group replies run `sleep 4` before the first text reply.
- Ordinary human input arriving during that pause triggers one final `sleep 6`
  only when the refreshed beat still warrants text; total cadence sleep never
  exceeds 10 seconds.
- Murph re-reads the current room beat after the pause, answers once rather
  than per accepted message, and does not recap the burst point by point.
- Urgent safety and genuinely time-sensitive coordination present initially
  skip the pause. If first admitted during the non-interruptible initial sleep,
  they skip the six-second extension and are answered when that sleep returns.
- Human-owned or otherwise silent beats initially recognized remain immediate
  no-replies; a refreshed beat that becomes human-owned takes no further sleep.
- Group replies use one ordinary text bubble and do not use the `---` splitter.
- Direct-message reply timing and multi-bubble guidance remain unchanged.
- Focused prompt tests, typecheck, direct prompt readback, preliminary
  ReviewGPT product-experience/prompt/coverage review, and exact-head CI pass.

## Scope

- In scope:
  - Group system-prompt cadence and reply-shape guidance.
  - The packaged `group-chat` and `hosted-low-usage` skills' matching guidance.
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
   Mitigation: initial urgency skips cadence; urgency admitted during the
   prompt-only shell sleep skips the extension and is delayed by at most the
   remainder of the first four-second pause.
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
  arrives during the first pause and the refreshed beat still warrants an
  ordinary text reply.
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

- Focused assistant-engine prompt, skill, planning, and opt-in test-definition
  suite after the latest `main` merge: 7 files, 191 tests passed and 16 opt-in
  real-model cases skipped.
- Assistant-engine typecheck: passed.
- Direct/group prompt readback: direct omits group cadence and retains texting
  bubbles; group contains `sleep 4`, one optional final `sleep 6`, the 10-second
  ceiling, and the one-bubble rule.
- Final complete first-provider request capture with pinned real Codex App Server,
  `gpt-5.6-terra`, low reasoning, code mode, and `gpt-tokenizer` 3.4.0
  `o200k_harmony`:
  - Individual: 23,841 tokens / 109,683 bytes at current base; 23,858 tokens /
    109,808 bytes at final head (`+17` tokens / `+125` bytes).
  - Group: 20,584 tokens / 94,072 bytes at current base; 20,509 tokens / 93,855
    bytes at final head (`-75` tokens / `-217` bytes).
  - Individual developer instructions change from 13,752 tokens / 67,466 bytes
    to 13,775 / 67,591 (`+23` tokens / `+125` bytes). Group instructions change
    from 10,574 / 51,966 to 10,507 / 51,752 (`-67` tokens / `-214` bytes).
  - Dynamic tools, schemas, Codex-generated guidance, and other provider-visible
    input are unchanged.
  - Transport-only model, stream, reasoning, service tier, storage, cache key,
    and client metadata were excluded identically; local paths were normalized.
    The temporary capture harness was removed.
- Preliminary ReviewGPT returned three findings:
  - Accepted the low-usage delimiter conflict and made group heads-ups use the
    same final paragraph in the one group bubble.
  - Kept the explicitly scoped prompt-only architecture instead of adding the
    proposed runtime wake/cancel owner; clarified that newly urgent input skips
    the extension and can wait only for the non-interruptible initial sleep.
  - Added representative cadence, refreshed-floor, urgency, and group
    low-usage cases to the existing real-model transcript evaluation rather
    than adding a synthetic runtime concurrency owner for a prompt-only change.
- The opt-in real-model evaluation command could not execute locally because
  its isolated harness requires `OPENAI_API_KEY`, which was not present. The
  default Vitest lane still compiles that file while skipping its 16 opt-in
  cases; focused prompt tests and exact-head CI remain the next-best proof.
- Merged current `origin/main` through ordinary Git history with no conflicts
  requiring manual resolution, then reran the focused suite and typecheck.
- `pnpm docs:drift`, `git diff --check`, prompt-scope readback, and the
  identifier/privacy scan passed.
- Parent final review found and removed a remaining group-shaped low-usage
  delimiter example, confirmed the direct cadence/multi-bubble path is
  unchanged, and found no remaining task-specific issue.
Completed: 2026-07-30
