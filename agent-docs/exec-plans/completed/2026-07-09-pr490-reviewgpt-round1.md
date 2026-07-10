# PR 490 ReviewGPT Round 1

## Goal

Resolve the accepted ReviewGPT round-1 findings for PR 490 without adding runtime machinery.

Success criteria:

- The 15 researched health-topic skills remain registered assistant-engine package assets.
- The skill files are compact operating manuals rather than raw research dumps.
- `recovery-modalities` fully preserves the old red-light dose math, device matching, manufacturer-claim labeling, safety, Health Commons, and experiment handoff contract.
- Tests guard against source-marker/citation debris and prove the red-light owner still contains the dose contract.
- The fix commit is pushed and ReviewGPT is rerun.

## Scope

In scope:

- `packages/assistant-engine/skills/**/SKILL.md`
- `packages/assistant-engine/test/assistant-skill-assets.test.ts`
- `agent-docs/exec-plans/**`

Out of scope:

- New runtime state, prompt branches, persistence, Health Commons content, or web feature copy.
- Committing ignored `audit-packages/` ReviewGPT artifacts.

## State

Done:

- ReviewGPT round 1 completed with `REVIEW_COMPLETE`.
- Accepted findings:
  - Red-light device-dose behavior was weakened when ownership moved to `recovery-modalities`.
  - New skill files were raw research dumps instead of compact operating manuals.
- Restored `red-light-therapy` as a registered skill with its `SKILL.md` and `device-seeds.json`.
- Changed `recovery-modalities` to hand off red/NIR dose and device questions to `red-light-therapy`.
- Collapsed the 15 researched skill files into compact operating manuals.
- Added tests for the researched skill shape, red-light registration, PBM handoff, and red-light dose/device contract.
- Verification passed:
  - `pnpm --dir packages/assistant-engine test -- assistant-skill-assets.test.ts`
  - `pnpm --dir packages/assistant-engine typecheck`
  - `git diff --check`

Now:

- Commit and push the ReviewGPT round-1 fix.

Next:

- Rerun ReviewGPT against the pushed PR head.
Status: completed
Updated: 2026-07-09
Completed: 2026-07-09
