# Wearables Query Alignment

Status: completed
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Evaluate the supplied senior wearable-query patch transcript against the current repo and land the architecture-consistent gaps that still matter for assistant and CLI wearable reads.

## Success criteria

- `packages/query` keeps owning semantic wearable reads, but `summarizeWearableLatest` now behaves like a same-local-day joined latest bundle instead of mixing freshest-per-family summaries.
- Metric latest/trend helpers capture fallback-derived daily points where the current metric can legitimately come from sleep-window or activity-session aggregates.
- Any CLI / `vault-usecases` / assistant-tool changes stay thin and only expand where the query-layer semantic improvement actually needs a surfaced option or contract update.
- Focused tests prove the new daily-join and fallback/trend behavior without widening into unrelated wearable architecture churn.

## Scope

- In scope:
- `packages/query/src/{wearables.ts,index.ts}`
- `packages/query/src/wearables/**` only where directly needed for the semantic alignment
- focused `packages/query/test/**`
- directly coupled `packages/vault-usecases/src/usecases/{integrated-services,runtime,types}.ts` only if the query result shape or filter contract changes
- directly coupled `packages/cli/src/commands/wearables.ts`, `packages/assistant-engine/src/assistant-cli-tools/definitions/vault-query.ts`, and focused tests only if an option/contract addition is justified
- Out of scope:
- a second wearable alias registry outside the existing metric catalog / query seam
- new persisted state, importer re-normalization, or timezone-model rewrites
- unrelated active experiment or device-sync work already present in the tree

## Constraints

- Preserve unrelated dirty-tree edits, especially the active experiment lane touching `packages/assistant-engine`, `packages/cli`, `packages/query`, and `packages/vault-usecases`.
- Keep the architecture from the earlier wearable-surfaces landing:
  - `packages/query` owns semantics
  - `packages/vault-usecases` owns the shared runtime/service seam
  - CLI and assistant surfaces stay thin
- Port behavior from the supplied patch only where it still fits current HEAD. Do not blindly replay stale result-shape changes if the repo has already converged on a better or broader contract.
- Use `gpt-5.4` with `high` reasoning for any subagents on this task.

## Evaluation focus

1. Confirm the concrete behavior differences between the supplied patch and current HEAD.
2. Prefer improvements that fix real semantic gaps:
   - same-day latest joining
   - fallback-aware metric point generation
   - optional compare/filter seams only if they still add value on top of the current contract
3. Reject or defer broad contract churn when current HEAD already exposes equivalent or better behavior.

## Parallelization plan

- Main thread:
  - own the execution plan and ledger
  - patch `packages/query` semantics locally
  - integrate any justified CLI/assistant/usecase changes
  - run verification, required audits, and commit
- Subagent A:
  - audit the supplied transcript against current `packages/query` behavior and identify missing semantic improvements worth landing now
- Subagent B:
  - audit current `packages/vault-usecases`, CLI, and assistant-tool seams for any still-missing option/contract changes needed to expose those query improvements cleanly

## Verification

- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff packages/query/src/wearables.ts packages/query/test/wearables-normalized-surfaces.test.ts packages/vault-usecases/src/usecases/integrated-services.ts packages/vault-usecases/src/usecases/runtime.ts packages/vault-usecases/src/usecases/types.ts packages/vault-usecases/test/wearables-query-services.test.ts packages/vault-usecases/test/runtime.test.ts packages/cli/src/commands/wearables.ts packages/cli/test/wearables-additive-commands.test.ts packages/assistant-engine/src/assistant-cli-tools/definitions/vault-query.ts packages/assistant-engine/test/assistant-cli-tools-capabilities.test.ts`
- `pnpm test:smoke`
- required completion audits before handoff:
- `coverage-write`
- `task-finish-review`

## Open questions

- Whether the supplied patch's `compare` mode and broader schema/result-shape changes still justify a live contract expansion, or whether the high-value landing is the semantic fix set only.
- Whether any fallback-aware metric point logic already exists elsewhere in current HEAD and just needs tighter coverage instead of new implementation.

## Decisions

- Keep this landing query-only. Current `vault-usecases`, CLI, and assistant-tool seams already cover the worthwhile patch intent, and those files are overlapping dirty surfaces in the active experiment lane.
- Reject the transcript's broader result-envelope churn (`schema`, `timezone`, `dateSemantics`, trend `compare`, drift `metrics` rename) for this slice.
- Defer the broader surfaced `windowDays` ceiling increase even though it is a plausible future improvement; it would widen into overlapping dirty wrapper layers without changing the core semantic win.
- Preserve canonical `sessionMinutes` behavior for sleep-backed callers, but route activity-flavored aliases such as `duration`, `session-minutes`, and `workout-minutes` to the activity summary kind so workout-duration asks do not return overnight sleep by default.

## Execution notes

- Landed:
  - joined latest-day semantics in `summarizeWearableLatest`
  - mismatch notes when another family is fresher than the joined latest day
  - query-local activity aliases for `sessionMinutes` / `sessionCount` style asks without breaking canonical `sessionMinutes`
  - focused regressions for staggered family freshness plus fallback/aggregate-backed metric surfaces
- Required audits:
  - `coverage-write` found no additional test gaps after the focused regressions
  - `task-finish-review` found one medium issue in the first `sessionMinutes` routing change; fixed by switching from a hard-coded metric default to alias-specific activity routing and rerunning the affected checks
- Verification outcomes:
  - `pnpm --dir packages/query exec vitest run test/wearables-normalized-surfaces.test.ts` passed
  - `pnpm typecheck` passed
  - `pnpm test:smoke` passed
  - `git diff --check -- packages/query/src/wearables.ts packages/query/test/wearables-normalized-surfaces.test.ts agent-docs/exec-plans/active/2026-04-23-wearables-query-alignment.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md` passed
  - `bash scripts/workspace-verify.sh test:diff packages/query/src/wearables.ts packages/query/test/wearables-normalized-surfaces.test.ts` failed twice for the same unrelated pre-existing query test: `packages/query/test/overview-vault-source-coverage.test.ts`, where overlapping experiment-shape work now adds null `analysisPlan` / `assistantSupport` / `onboarding` / `outcome` / `outcomeRef` / `protocolRef` / `runPlan` fields to overview summaries
Completed: 2026-04-23
