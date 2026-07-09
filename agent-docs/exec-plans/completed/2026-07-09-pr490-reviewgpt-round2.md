# PR 490 ReviewGPT Round 2

## Goal

Resolve the accepted ReviewGPT round-2 routing-boundary finding for PR 490 without weakening the restored red-light therapy skill.

Success criteria:

- `sleep-recovery-readiness` owns acute train/modify/rest, deload, recovery-block, and safety escalation decisions only.
- `sleep-improvement`, `circadian-rhythm`, `hrv-resting-heart-rate`, and `energy-fatigue` remain the focused owners for sleep mechanics, clock timing, wearable HRV/RHR interpretation, and persistent fatigue.
- `nutrition-strategy` owns meal structure, protein, fueling, hydration, under-fueling, and food-system execution only.
- `body-composition` and `gut-digestion` remain the focused owners for fat-loss/muscle-gain/recomp and digestive symptom strategy.
- `red-light-therapy` stays registered with `SKILL.md` and `device-seeds.json`.
- Tests guard the ownership boundaries, and ReviewGPT is rerun against the pushed PR head.

## Scope

In scope:

- `packages/assistant-engine/src/assistant-skill-assets.ts`
- `packages/assistant-engine/src/assistant/system-prompt.ts`
- `packages/assistant-engine/skills/sleep-recovery-readiness/SKILL.md`
- `packages/assistant-engine/skills/nutrition-strategy/SKILL.md`
- Focused assistant-engine tests covering these prompt and skill boundaries.

Out of scope:

- New skills, persistence, runtime state, routing machinery, Health Commons content, or red-light therapy changes.
- Committing ignored `audit-packages/` ReviewGPT artifacts.

## State

Done:

- ReviewGPT round 2 completed with `REVIEW_COMPLETE`.
- Accepted finding: the old umbrella sleep/recovery and nutrition skills still advertised ownership that overlaps the newly focused health-topic skills.
- Confirmed `red-light-therapy` is registered and has its `device-seeds.json` after the round-1 fix.
- Narrowed `sleep-recovery-readiness` to acute readiness, deload/recovery-block, and safety escalation decisions.
- Narrowed `nutrition-strategy` to meal structure, protein, fueling, hydration, under-fueling, and food-system execution.
- Updated prompt routing hints and tests to preserve focused ownership for sleep mechanics, circadian timing, HRV/RHR interpretation, persistent fatigue, body composition, and digestion.
- Added regression coverage that `red-light-therapy` remains registered with `device-seeds.json`.
- Verification passed:
  - `pnpm --dir packages/assistant-engine test -- assistant-skill-assets.test.ts assistant-sleep-recovery-readiness-skill.test.ts assistant-nutrition-strategy-skill.test.ts model-behavior.test.ts`
  - `pnpm --dir packages/assistant-engine typecheck`
  - `git diff --check`

Now:

- Finish the scoped plan commit and push it.

Next:

- Run PR preflight and ReviewGPT round 3 against the pushed PR head.
Status: completed
Updated: 2026-07-09
Completed: 2026-07-09
Completed: 2026-07-09
