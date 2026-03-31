# Align audit prompt output contracts

Status: completed
Created: 2026-03-31
Updated: 2026-03-31

## Goal

- Make the repo's audit prompt surfaces return normal textual review findings with recommended fixes instead of patch attachments or copy/paste-ready prompts for more agents.

## Success criteria

- `agent-docs/prompts/simplify.md` returns plain-text findings plus recommended fixes.
- `agent-docs/prompts/task-finish-review.md` returns plain-text findings plus recommended fixes.
- `agent-docs/prompts/frontend-quality-review.md` returns plain-text findings plus recommended fixes.
- The `review:gpt` simplify preset matches that contract instead of requesting a `.patch` attachment.
- Durable workflow/index docs stay truthful after the prompt contract change.

## Scope

- In scope:
- update the repo-owned audit prompt Markdown files to a plain-text review contract
- update the simplify review preset under `scripts/chatgpt-review-presets/`
- patch durable docs that describe the prompt behavior
- Out of scope:
- changes to non-audit review presets such as security, bad-code, or architecture
- broader completion-workflow redesign beyond the output contract

## Constraints

- Technical constraints:
- preserve the existing review-only / non-committing audit-agent boundary
- keep the change bounded to prompt/process docs and the one simplify preset that is currently out of sync
- Product/process constraints:
- keep durable docs truthful in the same change
- run the repo verification required for docs/process work that touches workflow-enforcement files or `scripts/**`

## Risks and mitigations

1. Risk: prompt surfaces drift again, leaving Codex audit prompts and `review:gpt` presets inconsistent.
   Mitigation: patch both the repo prompts and the simplify preset in the same turn, then read back the changed wording.
2. Risk: changing output shape removes information reviewers currently rely on.
   Mitigation: keep the same core fields (`severity`, `file:line`, `issue`, `impact`, `recommended fix`) and only change the delivery format.
3. Risk: docs/process verification is skipped even though the change touches workflow-enforcement surfaces.
   Mitigation: run the required repo-wide verification commands before handoff.

## Tasks

1. Patch the active audit prompt docs to request normal textual findings with recommended fixes.
2. Patch the simplify review preset so its output contract matches the repo prompts.
3. Update any durable workflow/index wording that would otherwise become stale.
4. Run required verification, read back the changed docs for consistency, and finish with a scoped commit.

## Decisions

- Use plain-text findings as the common output contract for repo-owned audit prompts.
- Keep audit agents review-only; only the response format changes.
- Leave unrelated patch-oriented review presets alone for now unless the user asks for broader normalization.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Expected outcomes:
- repo checks pass, or any failure is demonstrably unrelated to this docs/process change
- Outcomes:
- `pnpm typecheck` failed in `packages/cli/test/local-parallel-test.ts` because it imports `config/vitest-parallelism.ts` outside the package `rootDir`; this is an unrelated pre-existing failure from another active lane.
- `pnpm test` passed.
- `pnpm test:coverage` passed.
Completed: 2026-03-31
