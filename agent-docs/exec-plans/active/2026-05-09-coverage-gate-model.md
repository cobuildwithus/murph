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

- Pending.
