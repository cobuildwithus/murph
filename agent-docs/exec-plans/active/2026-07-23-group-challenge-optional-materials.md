# Group challenge optional materials

Status: active
Created: 2026-07-23
Updated: 2026-07-23

## Goal

- Make challenge photo and intro collection a clear optional invitation that never delays kickoff, while preventing Murph from inventing internal-process explanations when members ask about setup choices.

## Success criteria

- Murph asks once for optional participant photos and one-line intros or fun facts.
- Missing materials never block challenge launch, scoring, or a useful kickoff.
- Murph does not chase silent participants, solicit proxy photos without the depicted participant's approval, or describe hidden prompt/process reasoning.
- Focused skill regressions and canonical diff verification pass.

## Scope

- In scope: `group-challenge` prompt guidance and its direct prompt regression tests.
- Out of scope: challenge state, scoring, sharing permissions, scheduling, image generation, and other group-chat behavior.

## Tasks

1. Replace the mandatory-sounding photo/intro setup with one optional invitation and explicit fallback behavior.
2. Add a concise visible-facts-only correction rule for setup questions.
3. Update prompt regression coverage.
4. Run canonical verification and the required prompt/product review workflow.
5. Commit, open the PR, verify CI and mergeability, then close this plan for handoff.

## Verification

- `uv run --with pyyaml python <skill-validator> packages/assistant-engine/skills/group-challenge` — passed.
- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-group-challenge-buy-in-skill.test.ts --maxWorkers=1` — 3 tests passed.
- `pnpm test:diff packages/assistant-engine/skills/group-challenge/SKILL.md packages/assistant-engine/test/assistant-group-challenge-buy-in-skill.test.ts` — dependency policy, architecture guards, affected typechecks, and the assistant-engine owner suite passed (2,603 tests); the downstream assistant-runtime lane stopped on three persisted-state schema failures reproduced unchanged on clean `main`.
- GPT-5.6 Sol read-only forward tests covered immediate kickoff without materials, a skipped-invitation question, an unapproved proxy photo, later opt-in, and next-day silence; replies kept the invite optional, used no invented rationale, required depicted-person approval, and did not chase missing material.
- Product-experience review found that a participant who opted in after kickoff could miss the invitation. The prompt and regression now give that participant the invitation once in the opt-in acknowledgement; review rerun is pending.
- Prompt specialist review, acceptance verification, and PR CI are pending.
