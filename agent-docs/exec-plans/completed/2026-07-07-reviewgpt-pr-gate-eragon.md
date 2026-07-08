# ReviewGPT PR Gate Eragon

## Goal

- Change the PR-lane completion review gate back from local Codex deep review to `pnpm review:gpt pr-review` on the Eragon managed browser profile.
- Keep the guarded PR ZIP/repomix attachment flow, pushed-head preflight, local finding triage, reproduction-before-fix rule, and zero-accepted-findings loop.

## Scope

- `scripts/review-gpt.config.sh`
- `agent-docs/operations/completion-workflow.md`
- `agent-docs/operations/pr-reviewgpt-loop.md`
- `agent-docs/operations/agent-workflow-routing.md`
- `agent-docs/index.md`

## Constraints

- Preserve unrelated working-tree edits.
- Do not update historical completed-plan snapshots.
- Do not write local user identifiers, home paths, secrets, or raw ChatGPT/browser state into tracked files.

## Verification

- Direct readback and syntax checks for touched docs/scripts.
- `pnpm typecheck` under the low-risk repo-internal workflow/tooling path.

## State

- Done: updated ReviewGPT config to default to Eragon, replaced the old PR-lane local review gate with the ReviewGPT PR loop docs, and updated the workflow router/index.
- Done: `bash -n` passed for touched shell scripts; `pnpm review:gpt pr-review --dry-run` resolved Eragon on port `9448`; `pnpm typecheck` passed.
- Note: `pnpm docs:gardening` failed on four pre-existing unindexed docs unrelated to this rename.
- Next: close this plan with a scoped commit.
Status: completed
Updated: 2026-07-07
Completed: 2026-07-07
