# Group challenge optional materials

Status: active
Created: 2026-07-23
Updated: 2026-07-23

## Goal

- Make the challenge photo and intro ask explicit and required for every confirmed participant while keeping the contributions optional and non-blocking.

## Success criteria

- Murph asks every confirmed participant once for an optional photo and one-line intro or fun fact, including people who opt in after kickoff.
- Murph does not skip the ask because setup is short, late, or already underway.
- Missing materials never block challenge launch, scoring, or a useful kickoff.
- Photos used for likeness are sent or approved by the depicted participant.
- Focused skill regressions and canonical diff verification pass.

## Scope

- In scope: `group-challenge` prompt guidance and its direct prompt regression tests.
- Out of scope: challenge state, scoring, sharing permissions, scheduling, image generation, and other group-chat behavior.

## Tasks

1. Replace the skippable photo/intro setup with one required ask per confirmed participant and explicit fallback behavior.
2. Keep missing materials from delaying kickoff, comics, dispatches, or close-out.
3. Update prompt regression coverage.
4. Run canonical verification and the required prompt/product review workflow.
5. Commit, open the PR, verify CI and mergeability, then close this plan for handoff.

## Verification

- `uv run --with pyyaml python <skill-validator> packages/assistant-engine/skills/group-challenge` — passed.
- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-group-challenge-buy-in-skill.test.ts --maxWorkers=1` — 3 tests passed.
- `pnpm test:diff packages/assistant-engine/skills/group-challenge/SKILL.md packages/assistant-engine/test/assistant-group-challenge-buy-in-skill.test.ts` — dependency policy, architecture guards, affected typechecks, and the assistant-engine owner suite passed (2,603 tests); the downstream assistant-runtime lane stopped on three persisted-state schema failures reproduced unchanged on clean `main`.
- GPT-5.6 Sol read-only forward tests covered immediate kickoff without materials, a skipped-invitation question, an unapproved proxy photo, later opt-in, and next-day silence; replies made the ask explicit while keeping contributions non-blocking and required depicted-person approval.
- Product-experience review found that a participant who opted in after kickoff could miss the invitation. The prompt and regression now give that participant the invitation once in the opt-in acknowledgement; review rerun is pending.
- Prompt specialist review, acceptance verification, and PR CI are pending.
