# Land the downloaded assistant provider continuity production fix in the narrow assistant-engine continuity slice

Status: completed
Created: 2026-04-22
Updated: 2026-04-22

## Goal

- Land the downloaded assistant-provider continuity fix in the narrow assistant-engine continuity slice without widening into unrelated assistant, web, or Health Commons work.

## Success criteria

- The assistant continuity path preserves provider-native resume instead of letting onboarding/bootstrap overlays clobber it.
- Flat-prompt Codex resume turns send only the current user turn, while fresh bootstrap/fallback turns still include the needed bootstrap context.
- OpenAI-compatible provider-state usage matches native-resume availability, including zero-data-retention behavior.
- Focused assistant-engine verification and required audit passes complete, or any unrelated blockers are documented precisely.

## Scope

- In scope:
- `packages/assistant-engine/src/assistant/{provider-turn-runner,providers/{helpers,openai-compatible,registry,codex-cli},turn-plan}.ts`
- focused regression coverage under `packages/assistant-engine/test/**`
- Out of scope:
- unrelated assistant-engine refactors beyond the downloaded patch intent
- active `apps/web`, `packages/health-commons`, and hosted-runtime work already in the tree

## Constraints

- Technical constraints:
- Preserve existing overlapping dirty-tree edits outside the target files.
- Keep the implementation aligned with the downloaded patch intent, manually merging where the patch no longer applies cleanly to HEAD.
- Product/process constraints:
- Run the repo-required package verification lane plus required completion-workflow audit passes.
- Use `scripts/finish-task` for the scoped commit because this lane is plan-bearing.

## Risks and mitigations

1. Risk: The downloaded patch is stale against the current branch and can reintroduce older code structure if replayed blindly.
   Mitigation: Merge only the still-applicable behavioral changes into current HEAD and cover them with focused regression tests.
2. Risk: Verification or audits could be confused by unrelated active work elsewhere in the tree.
   Mitigation: Keep the write scope limited to the assistant continuity files and use scoped verification/commit paths only.

## Tasks

1. Manually merge the still-applicable assistant continuity changes from the downloaded patch into the current assistant-engine source.
2. Add focused regression coverage for provider continuity, flat-prompt resume behavior, and OpenAI-compatible provider-state gating.
3. Run the scoped verification lane and required completion-workflow audit passes.
4. Finish the task with a scoped commit and note any unrelated blockers if they appear.

## Decisions

- Treat the downloaded patch as behavioral intent, not as an apply-clean authority, because part of the earlier onboarding fix is already present on this branch.
- Keep the current HEAD naming and test layout where possible, but land the artifact's continuity semantics fully, including the provider-state/ZDR gating and the flat-prompt resume/fallback split.
- Close the final review's low-severity proof gap locally instead of spawning another audit pass.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test:diff packages/assistant-engine/src/assistant/provider-turn-runner.ts packages/assistant-engine/src/assistant/providers/helpers.ts packages/assistant-engine/src/assistant/providers/openai-compatible.ts packages/assistant-engine/src/assistant/providers/registry.ts packages/assistant-engine/src/assistant/providers/codex-cli.ts packages/assistant-engine/src/assistant/turn-plan.ts packages/assistant-engine/test/provider-continuity.test.ts packages/assistant-engine/test/onboarding-injection.test.ts`
- `pnpm --dir packages/assistant-engine exec vitest run test/provider-execution.test.ts --config vitest.config.ts --no-coverage`
- `pnpm test:diff packages/assistant-engine/src/assistant/provider-turn-runner.ts packages/assistant-engine/src/assistant/providers/helpers.ts packages/assistant-engine/src/assistant/providers/openai-compatible.ts packages/assistant-engine/src/assistant/providers/registry.ts packages/assistant-engine/src/assistant/providers/codex-cli.ts packages/assistant-engine/src/assistant/turn-plan.ts packages/assistant-engine/test/provider-continuity.test.ts packages/assistant-engine/test/onboarding-injection.test.ts packages/assistant-engine/test/provider-execution.test.ts packages/assistant-engine/test/provider-turn-runner.test.ts packages/cli/test/assistant-provider.test.ts`
- Expected outcomes:
- The assistant-engine continuity slice passes with no regressions introduced by this patch landing.
- Actual outcomes:
- `pnpm typecheck` passed.
- The initial scoped `pnpm test:diff ...` run passed after updating stale CLI expectations to the new continuity contract.
- Required `coverage-write` audit found no worthwhile additional proof to add.
- Required final review found one low-severity stale-resume fallback proof gap in `packages/assistant-engine/test/provider-execution.test.ts`; that test was extended and the focused Vitest rerun plus the full scoped `pnpm test:diff ...` rerun both passed.
Completed: 2026-04-22
