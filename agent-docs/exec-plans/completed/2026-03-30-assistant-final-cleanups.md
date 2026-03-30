# 2026-03-30 Assistant Final Cleanups

## Goal

- Land the remaining assistant runtime cleanup bundle from the supplied patch/notes while preserving newer in-tree fixes already present on top of the reviewed snapshot.

## Success Criteria

- Runtime budget corruption is quarantined, recreated, and logged instead of silently defaulting.
- Quarantine pruning removes matching payloads and old orphan `.invalid.*` payloads.
- Assistant session ids are validated at the schema/contract layer wherever persisted or parsed.
- Assistant storage resolvers centralize opaque-id-to-path resolution so session/turn/outbox/cron/provider recovery files reject traversal-like ids at the filesystem boundary too.
- `AssistantRuntimeStateService` no longer exposes raw vault escape hatches and delivery finalization plans are truly vault-bound through that service.
- `@murph/assistant-services` exposes the intended runtime/store seams, and `assistantd` depends on that package instead of directly on `murph`.
- Conversation-policy/service contract cleanup lands without regressing the newer effective-audience privacy behavior already in the tree.
- Focused assistant/assistantd/assistant-services verification passes; repo-wide blockers, if still unrelated, are recorded separately.

## Scope

- `packages/assistant-services/**`
- `packages/assistantd/{package.json,tsconfig.json,src/**,test/**}`
- `packages/cli/src/assistant/{conversation-policy,delivery-service,quarantine,runtime-budgets,runtime-state-service,service-contracts,turn-plan}.ts`
- `packages/cli/src/assistant/{cron/store,outbox,provider-turn-recovery,state-ids,transcript-distillation,turns}.ts`
- `packages/cli/src/assistant/store/{paths,persistence}.ts`
- `packages/cli/src/{assistant-cli-contracts.ts,assistant-runtime.ts}`
- targeted `packages/cli/test/{assistant-runtime,assistant-service,assistant-state}.test.ts`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`

## Risks / Notes

- Preserve already-landed fixes in the current tree, especially the daemon open-conversation contract coverage, transcript-distillation quarantine behavior, and effective-audience privacy gating.
- Active nearby lanes already touch `packages/assistant-runtime/**`, `packages/assistantd/**`, and some assistant provider/session seams; read live file state first, preserve overlapping edits in `store/persistence.ts` and `provider-turn-recovery.ts`, and avoid widening into unrelated provider/session refactors.
- The worktree is already dirty in unrelated hosted/query/workout areas; do not revert or reshape them.
Status: completed
Updated: 2026-03-30
Completed: 2026-03-30
