# Wearables Query Surfaces

## Goal

Land new normalized wearable read surfaces that make the assistant and CLI better at answering common “latest”, “trend”, and “what changed?” questions without dropping down to raw WHOOP/Oura/Garmin records.

## Success criteria

- `packages/query` exposes additive normalized wearable surfaces for:
  - latest bundle
  - metric latest
  - metric trend
  - drift explanation
- `packages/vault-usecases` owns the shared service/result seam above those query helpers.
- `packages/cli` exposes:
  - `wearables latest`
  - `wearables metric latest <metric>`
  - `wearables metric trend <metric>`
  - `wearables drift`
- `packages/assistant-engine` exposes matching direct wearable query tools and updates assistant guidance to prefer them before raw wearable reads.
- Metric alias resolution covers the requested common assistant-facing names without introducing a second alias registry outside the existing wearable metric catalog / query seam.
- Verification stays on truthful package coverage lanes plus the required completion-workflow audits.

## Scope

- `packages/query/src/{index.ts,wearables.ts}`
- `packages/query/src/wearables/**` only where directly needed for additive latest/trend/drift helpers or result types
- `packages/query/test/**` for focused wearable coverage
- `packages/vault-usecases/src/{query-runtime.ts,usecases/{integrated-services.ts,runtime.ts,types.ts}}`
- `packages/vault-usecases/test/**` only if required for the new wearable service methods
- `packages/cli/src/{commands/wearables.ts,vault-cli-command-manifest.ts,incur.generated.ts}`
- `packages/cli/config.schema.json` if command topology regeneration changes it
- focused `packages/cli/test/**` wearable coverage only
- `packages/assistant-engine/src/assistant-cli-tools/definitions/vault-query.ts`
- `packages/assistant-engine/src/assistant/system-prompt.ts`
- focused `packages/assistant-engine/test/**` only
- `packages/openclaw-plugin/skills/murph/SKILL.md`
- directly coupled README/help docs only if the new preferred read order would otherwise drift

## Constraints

- Keep this a read-layer and command-surface change only. No new persisted state.
- Follow the existing architecture: `packages/query` owns semantic wearable reads, `packages/vault-usecases` owns the shared command/runtime seam, and CLI/assistant layers stay thin.
- Reuse the existing wearable candidate-selection pipeline and metric catalog rather than inventing a second scoring or alias system.
- Keep day semantics on the current canonical seam:
  - prefer stored `dayKey`
  - otherwise use the existing timestamp-prefix fallback
  - do not introduce a new user-timezone conversion model in this patch
- Preserve unrelated dirty-tree edits, especially the active `apps/web` and Health Commons work already in flight.
- Use `gpt-5.4` with `high` reasoning for any subagents on this task.

## Planned shape

1. Add additive query result types for normalized latest/trend/drift outputs.
2. Build those results from the current wearable dataset and daily summary helpers:
   - reuse candidate dedupe and metric selection
   - compute compact comparison windows in query
   - carry provider, confidence, record ids, paths, and notes through the result
3. Extend the shared `vault-usecases` query/runtime/service seam with matching methods and typed results.
4. Expose the new commands in `packages/cli`, then regenerate CLI generated artifacts that depend on command topology.
5. Add direct assistant tool definitions for the new read surfaces and update prompt/docs so the assistant prefers them over raw wearable reads.
6. Add focused tests per owner:
   - query math/selection/alias coverage
   - usecase service wiring
   - CLI command/schema/help coverage
   - assistant tool wiring/prompt guidance

## Parallelization plan

- Worker A: `packages/query` + `packages/vault-usecases`
  - Owns new result types, alias resolution wiring, latest/trend/drift helpers, service methods, and focused tests.
- Worker B: `packages/cli`
  - Owns new command topology, manifest wiring, generated CLI artifacts, and focused CLI tests.
- Worker C: `packages/assistant-engine` + `packages/openclaw-plugin`
  - Owns direct tool definitions, prompt/skill guidance, and focused assistant tests.
- Main thread:
  - lock the exact result-shape decisions
  - register the plan/ledger
  - integrate worker diffs
  - run verification
  - run required completion audits
  - finish/commit if the task lands cleanly

## Verification

- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff packages/query/src packages/query/test packages/vault-usecases/src packages/vault-usecases/test packages/cli/src/commands/wearables.ts packages/cli/src/vault-cli-command-manifest.ts packages/cli/src/incur.generated.ts packages/cli/config.schema.json packages/cli/test packages/assistant-engine/src/assistant-cli-tools/definitions/vault-query.ts packages/assistant-engine/src/assistant/system-prompt.ts packages/assistant-engine/test packages/openclaw-plugin/skills/murph/SKILL.md`
- `pnpm test:smoke`
- If CLI artifact-sensitive surfaces change, include the package-shape lane required by the diff-aware verifier or run `pnpm --dir packages/cli verify` / `verify:coverage` if the diff lane cannot cover it truthfully.
- Required completion audits before handoff:
  - `coverage-write` on `gpt-5.4-mini` is repo-default, but the user has explicitly overridden subagent model choice for this task; use `gpt-5.4` with `high` reasoning for the required audit passes here unless repo policy blocks that at execution time
  - `task-finish-review`

## Notes

- The existing importer metric catalog already provides a real alias seam. Prefer extending that catalog or building a thin query-local normalization wrapper on top of it instead of introducing a second standalone alias table in CLI or assistant code.
- The clean default for `skin-temp` is likely `temperatureDeviation`, not absolute temperature, because current nightly wearable data often expresses “skin temp” as deviation rather than raw Celsius. Confirm in code before landing.
- If stronger user-timezone semantics are required beyond `dayKey` fidelity, split that into a separate importer/day-key correctness task instead of widening this patch.

## Execution notes

- Required audit passes ran on `gpt-5.4` with `high` reasoning per the user override.
- Focused verification passed:
  - `pnpm --dir packages/query exec vitest run test/wearables-normalized-surfaces.test.ts`
  - `pnpm --dir packages/vault-usecases exec vitest run test/wearables-query-services.test.ts test/runtime.test.ts`
  - `pnpm --dir packages/cli exec vitest run test/wearables-additive-commands.test.ts test/wearables-schema.test.ts`
  - `pnpm --dir packages/assistant-engine exec vitest run test/assistant-cli-tools-capabilities.test.ts test/system-prompt.test.ts --config vitest.config.ts --no-coverage`
  - `pnpm test:smoke`
  - `git diff --check -- <scoped wearables files>`
- `pnpm typecheck` is still blocked outside this slice by the pre-existing `packages/vault-usecases/dist` declaration drift (`test/health-cli-public-seams.test.ts`, `test/helpers-public-seams.test.ts`).
- `bash scripts/workspace-verify.sh test:diff ...` is still blocked outside this slice when `packages/assistant-cli` and `packages/inbox-services` try to consume the same incomplete `packages/vault-usecases/dist` declarations.
- `packages/cli verify-package-shape` only passes in the dirty tree when the unrelated active experiment-lane generated churn is included. Keep this landing scoped by committing only the wearables-generated additions in `config.schema.json` and `src/incur.generated.ts`.
Status: completed
Updated: 2026-04-22
Completed: 2026-04-22
