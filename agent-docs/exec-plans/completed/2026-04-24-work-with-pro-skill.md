# Add repo-local work-with-pro skill profile guidance

Status: completed
Created: 2026-04-24
Updated: 2026-04-24

## Goal

- Add a repo-local `work-with-pro` skill under `.agents/skills` so future Murph "work with Pro" wake flows use the repo's Phlebas browser-profile wrapper instead of the raw `cobuild-review-gpt` default endpoint.

## Success criteria

- `.agents/skills/work-with-pro/SKILL.md` exists and has valid skill frontmatter.
- The skill tells agents to use the repo wrapper or explicit Phlebas browser endpoint for Murph `thread wake` / `thread export` / `thread download` operations.
- Git ignore rules allow the repo-local skill file to be tracked without unignoring unrelated `.agents/**` state.
- The scoped docs/tooling verification passes.
- A scoped commit lands the skill and this completed plan.

## Scope

- In scope: `.agents/skills/work-with-pro/SKILL.md`, the narrow `.gitignore` exception, this plan.
- Out of scope: changing `review:gpt` runtime behavior, changing browser profile scripts, modifying existing active Pro watchers, or editing the global user skill.

## Constraints

- Technical constraints: preserve the existing Phlebas default in `package.json` and `scripts/review-gpt-browser-profile.sh`; do not add package dependencies.
- Product/process constraints: keep the skill concise and avoid committing unrelated dirty-tree work.

## Risks and mitigations

1. Risk: duplicate `work-with-pro` skills create ambiguity.
   Mitigation: make the repo-local skill's description and body explicitly Murph-specific while preserving the general workflow shape.
2. Risk: the shared coordination ledger already has unrelated dirty edits.
   Mitigation: add a temporary exact plan row, let `scripts/finish-task` remove it, and commit only scoped paths.

## Tasks

1. Register the scoped plan and ledger row.
2. Add the repo-local skill and `.gitignore` exception.
3. Validate the skill and run scoped repo verification.
4. Finish the plan and create a scoped commit.

## Decisions

- Keep only `SKILL.md` for this repo-local skill, matching the existing project skills' lightweight shape.
- Prefer the wrapper command in examples because it prepares and targets the Phlebas managed browser profile.

## Verification

- Commands to run: skill quick validation, direct readback, `pnpm typecheck`, `git diff --check`.
- Expected outcomes: all pass.
Completed: 2026-04-24
