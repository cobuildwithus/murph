# Coordination Ledger

Active coding work must register here before code changes begin.
Rows are active-work notices by default, not hard file locks.
Use `Notes` to mark a lane as exclusive when overlap is unsafe, such as a large refactor or delicate cross-cutting rewrite.

| Agent | Scope | Plan | Files | Symbols | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Codex | Verify OpenRouter gateway-driver compatibility and update runtime resolution if supported | `agent-docs/exec-plans/active/2026-04-13-openrouter-gateway-driver.md` | `packages/operator-config/**`, `packages/assistant-engine/**` | `resolveAssistantRuntimeTarget`, `resolveOpenAiCompatibleProviderOptions` | in_progress | Narrow runtime-target change; avoid unrelated provider refactors. |
| Codex | Add canonical nutrition tracking for foods and meals plus totals reads | `agent-docs/exec-plans/active/2026-04-13-nutrition-tracking.md` | `packages/contracts/**`, `packages/core/**`, `packages/query/**`, `packages/vault-usecases/**`, `packages/assistant-engine/**`, `packages/cli/**` | `foodUpsertPayloadSchema`, `foodFrontmatterSchema`, `eventSchema("meal")`, `upsertFood`, `addMeal`, `FoodQueryEntity`, `vault.meal.add` | in_progress | Nutrition lane only. Avoid unrelated active assistant-runtime/provider files already dirty in the worktree. |
