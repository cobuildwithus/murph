# Assistant runtime retention reductions

Status: in_progress
Created: 2026-04-20
Updated: 2026-04-20

## Goal

- Add the still-missing bounded retention for local assistant runtime residue in the owned assistant-engine write scope only.

## Success criteria

- Transcript persistence no longer retains more than the existing replay window required for provider bootstrap and native resume behavior.
- Terminal outbox intents are pruned by maintenance using bounded age/count rules without affecting active retry state.
- Cron run history no longer keeps response bodies indefinitely and old run metadata is pruned on bounded age/count rules while preserving recovery-useful fields.
- The change stays within the owned write scope and avoids `packages/assistant-engine/src/assistant/cron.ts` unless an unavoidable minimal seam appears.

## Scope

- `packages/assistant-engine/src/assistant/runtime-budgets.ts`
- `packages/assistant-engine/src/assistant/store/persistence.ts`
- `packages/assistant-engine/src/assistant/outbox/store.ts`
- `packages/assistant-engine/src/assistant/cron/store.ts`
- directly coupled `packages/assistant-engine/test/**` only if required
- `packages/operator-config/src/assistant-cli-contracts.ts` only if required

## Constraints

- Preserve overlapping dirty-tree edits and do not revert unrelated work.
- Prefer maintenance-based trimming and pruning over schema churn.
- Keep transcript retention aligned with the existing replay limits already used by provider turn execution.
- Avoid changing `packages/assistant-engine/src/assistant/cron.ts` unless there is no safe alternative.

## Verification

- planned: `pnpm typecheck`
- planned: `bash scripts/workspace-verify.sh test:diff packages/assistant-engine/src/assistant/runtime-budgets.ts packages/assistant-engine/src/assistant/store/persistence.ts packages/assistant-engine/src/assistant/outbox/store.ts packages/assistant-engine/src/assistant/cron/store.ts packages/assistant-engine/test`
- planned: focused Vitest for directly coupled assistant-engine coverage if the diff-aware lane is noisy or insufficient
- planned: `git diff --check`

## Notes

- The broad privacy/data-minimization audit row already covers this subsystem; this plan keeps the write lane narrow to the owned retention helpers and their direct tests.
