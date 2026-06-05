# Research supplements Computer Use guidance

Status: completed
Created: 2026-06-05
Updated: 2026-06-05

## Goal

- Update the `research-supplements` skill so brand workers may use Computer Use
  with Safari for read-only official-page label inspection when static fetches
  cannot access label evidence.

## Success criteria

- The skill names the allowed Safari/Computer Use actions and the disallowed
  risky actions.
- The database write boundary remains parent-owned and dry-run-first.
- Skill validation and repo fast-path verification pass.

## Scope

- In scope: `.agents/skills/research-supplements` instructions and supporting
  source-quality reference text.
- Out of scope: supplement DB writes, brand extraction runs, app/runtime code,
  and implementation of the one-table schema refactor.

## Constraints

- Technical constraints: keep guidance concise, official-source-first, and
  compatible with the existing `brand_site` import contract.
- Product/process constraints: do not expose secrets or local identifiers; keep
  workers read-only unless the parent explicitly authorizes DB writes.

## Risks and mitigations

1. Risk: Browser UI access could be misread as permission for account, purchase,
   form, or CAPTCHA actions.
   Mitigation: Make the permission explicitly read-only and forbid those risky
   actions in the skill.

## Tasks

1. Add Safari/Computer Use guidance to the skill workflow and subagent prompt.
2. Mirror source-quality expectations for UI/PDF/image label inspection.
3. Validate the skill and run required repo fast-path checks.

## Decisions

- Keep DB writes parent-owned. Subagents may use Safari for evidence collection
  but must still return normalized JSON and dry-run evidence only.

## Verification

- `git diff --check -- .agents/skills/research-supplements/SKILL.md .agents/skills/research-supplements/references/source-quality.md agent-docs/exec-plans/active/2026-06-05-research-supplements-computer-use.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md` passed.
- `/tmp/research-supplements-skill-validate/bin/python <CODEX_HOME>/skills/.system/skill-creator/scripts/quick_validate.py .agents/skills/research-supplements` passed.
- `pnpm typecheck` passed.
Completed: 2026-06-05
