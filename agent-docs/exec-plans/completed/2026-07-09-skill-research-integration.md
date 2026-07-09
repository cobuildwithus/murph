# Skill Research Integration

## Goal

Integrate the 15 completed Murph skill-research outputs into the assistant-engine skill system and open a draft PR.

Success criteria:

- Each researched topic has a registered assistant skill file under `packages/assistant-engine/skills/**`.
- Existing overlapping skill boundaries stay crisp, especially `sleep-recovery-readiness`, `nutrition-strategy`, `running-cardio`, `physical-therapy`, and `stress-regulation`.
- Tests prove every registered skill has valid frontmatter and the new health-topic skills are registered with file references.
- The branch is committed, pushed, and opened as a draft PR.

## Scope

In scope:

- `packages/assistant-engine/src/assistant-skill-assets.ts`
- `packages/assistant-engine/skills/**/SKILL.md`
- `packages/assistant-engine/test/assistant-skill-assets.test.ts`
- Focused verification for assistant-engine skill assets.

Out of scope:

- Runtime state, vault schemas, hosted/web/cloudflare behavior, or new persistence.
- Rewriting the broader assistant system prompt beyond registering skill assets.
- Committing ignored ReviewGPT research artifacts.

## Design Notes

- Treat ReviewGPT outputs as source research, not files to paste wholesale.
- Keep each skill compact enough to load as an operating manual.
- Prefer routing/ownership boundaries over duplicate protocol catalogs.
- `recovery-modalities` becomes the registered owner for red/NIR light therapy, with the prior device seed data moved under that skill.

## Verification Plan

- Run focused assistant-engine skill asset tests.
- Run `pnpm typecheck`.
- Run a final diff/privacy scan before commit.
- After push, run the PR ReviewGPT loop unless blocked.

## State

Done:

- Read workflow, architecture, invariants, product, verification, and skill registry context.
- Created branch worktree from `origin/main`.
- Added 15 researched assistant skill files under `packages/assistant-engine/skills`.
- Registered the 15 skills in `ASSISTANT_SKILLS`.
- Moved red-light device seed data under `recovery-modalities` and removed the overlapping registered red-light skill.
- Added assistant skill asset tests for the researched skill registry, file references, and moved device seeds.
- Verification passed:
  - `pnpm --dir packages/assistant-engine test -- assistant-skill-assets.test.ts`
  - `pnpm --dir packages/operator-config build`
  - `pnpm --dir packages/assistant-engine typecheck`

Now:

- Commit the scoped diff with `scripts/finish-task`.

Next:

- Push branch and open draft PR.

Open Questions

- None.
Status: completed
Updated: 2026-07-09
Completed: 2026-07-09
