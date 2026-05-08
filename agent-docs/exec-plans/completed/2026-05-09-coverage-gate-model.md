# Coverage Gate Model Update

## Goal

Update the repo workflow docs so the required `coverage-write` coverage/proof gate uses `gpt-5.5` with medium reasoning instead of the previous mini-model.

## Constraints

- Docs/process-only durable workflow rule change.
- Keep the change limited to live workflow docs and the worker prompt.
- Preserve historical completed execution-plan snapshots.
- Do not touch app/package runtime behavior.

## Plan

1. Update live workflow references for `coverage-write` model choice.
2. Read back the edited docs and search for stale live references.
3. Run required docs/process verification.
4. Close this plan with the scoped commit path if the worktree allows it.

## Verification

- Passed: `git diff --check -- agent-docs/operations/agent-workflow-routing.md agent-docs/operations/completion-workflow.md agent-docs/prompts/coverage-write.md agent-docs/exec-plans/active/2026-05-09-coverage-gate-model.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- Passed: `bash scripts/workspace-verify.sh test:diff agent-docs/operations/agent-workflow-routing.md agent-docs/operations/completion-workflow.md agent-docs/prompts/coverage-write.md agent-docs/exec-plans/active/2026-05-09-coverage-gate-model.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- Passed: `pnpm typecheck`
- Passed: live workflow/prompt stale-reference search for the previous mini-model coverage-write requirement.
Status: completed
Updated: 2026-05-09
Completed: 2026-05-09
