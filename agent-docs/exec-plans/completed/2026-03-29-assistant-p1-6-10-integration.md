# Assistant P1 6-10 Integration

Status: completed
Created: 2026-03-29
Updated: 2026-03-29

## Goal

Integrate the supplied assistant P1 6-10 additive patch onto the current repo snapshot so the newer tree gains the intended channel/provider splits, runtime journal plus quarantine seams, corruption reporting, and bounded runtime maintenance without regressing the newer provider/session/runtime refactors already landed here.

## Scope

- Compare the supplied patch against the current assistant/runtime-state tree and identify what behavior is already present versus still missing.
- Land the missing behavior across:
  - `packages/cli/src/assistant/channel-adapters.ts` plus new `assistant/channels/**`
  - `packages/cli/src/assistant/provider-registry.ts` plus new `assistant/providers/**`
  - runtime observability and resilience seams (`runtime-events`, `quarantine`, `runtime-cache`, `runtime-budget-policy`, `runtime-budgets`)
  - assistant persistence and recovery surfaces (`store`, `store/persistence`, `status`, `doctor`, `diagnostics`, `failover`, `provider-turn-recovery`, `cron/store`)
  - automation maintenance hooks and memory event emission
  - shared assistant runtime-state paths in `packages/runtime-state/src/assistant-state.ts`
- Add or update only the narrow tests and docs required to keep the landed behavior truthful.

## Constraints

- Preserve unrelated dirty work already present in the shared worktree.
- Preserve the current branch's newer provider/session seam shape when it already satisfies the patch intent.
- Keep existing import paths working by retaining compatibility wrappers where the patch expects them.
- Treat the supplied patch and notes as a behavioral guide, not an instruction to overwrite newer branch code wholesale.

## Risks

1. The patch overlaps files that were already heavily refactored in the current tree.
   Mitigation: compare live files and port missing behavior manually instead of forcing a full patch apply.
2. The new runtime quarantine and maintenance seams touch persisted local state.
   Mitigation: keep storage paths additive, preserve current readers where possible, and verify corruption/reporting flows directly in addition to scripted checks.
3. Repo-wide verification may still surface unrelated failures from other active lanes.
   Mitigation: run focused assistant/runtime checks while integrating, then run the required repo commands and separate unrelated blockers carefully if they appear.

## Verification Plan

- Focused assistant/runtime comparisons and targeted tests while integrating.
- At least one direct scenario check proving the new runtime/quarantine behavior or maintenance hook in addition to scripted tests.
- Required repo commands after integration:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
- Required completion-workflow audit passes via spawned subagents:
  - `simplify`
  - `task-finish-review`

## Working Notes

- `git apply --check -p2` already fails immediately on `packages/cli/src/assistant/provider-registry.ts`, so this must be a guided merge.
- The current tree already contains the completed assistant provider/session seam refactor, so any provider split must layer on top of that design instead of reintroducing the older shape from the patch snapshot.
- The supplied integration notes identify `channel-adapters.ts`, `provider-registry.ts`, `store.ts`, `store/persistence.ts`, `status.ts`, `doctor.ts`, `automation/run-loop.ts`, `packages/runtime-state/src/assistant-state.ts`, and `assistant-cli-contracts.ts` as the highest-risk overlap points; those should be reviewed first.
- Direct proof succeeded via `pnpm exec tsx --eval ...`: a malformed assistant status snapshot now returns `null`, is quarantined under the new assistant quarantine root, and is reflected in the runtime journal/quarantine summary.
- `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage` remain blocked by unrelated pre-existing dirty-tree failures in the health-registry lane plus separate pre-existing CLI and `packages/assistantd` errors; the assistant-specific `channels/helpers.ts` typing regression introduced by this integration was fixed locally.
- Required spawned audit delegation was attempted through the local `codex-workers` helper because first-class subagent tooling was unavailable in this environment, but the simplify worker stalled without producing a final result. That tooling block must be called out in handoff instead of pretending the required audit passes completed.
Completed: 2026-03-29
