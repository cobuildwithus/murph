# Land the boundary hard-cut follow-ups for CLI device composition, hidden root entrypoints, inbox model routing, and assistant-runtime re-exports

Status: completed
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Land the four requested ownership/boundary follow-ups without widening beyond the named package seams, directly coupled docs/guardrails, and the proof needed to keep those seams mechanically enforced.

## Success criteria

- `@murphai/vault-usecases` no longer composes or exposes the CLI-only `devices` service group; CLI owns that seam directly.
- Root path aliases and hidden root barrels/fallbacks are removed for packages that intentionally do not export `"."`, and workspace-boundary guards fail when tsconfig/vitest paths drift beyond declared exports.
- The operator-facing CLI inbox model-routing surface moves into `packages/cli`, the dead public assistant-engine `./model-harness` / `./inbox-model-*` exports are removed, and any remaining assistant-engine inbox model-routing internals stay private to assistant automation until a lower shared owner exists.
- `@murphai/assistant-engine/assistant-runtime` stops re-exporting generic operator-config helpers and assistant-cli generic-helper callsites import the real owner package directly.
- Scoped verification and the required completion workflow audits run, with any unrelated blockers documented precisely.

## Scope

- `ARCHITECTURE.md`
- `tsconfig.base.json`
- `apps/cloudflare/vitest.shared.ts`
- `scripts/workspace-boundaries/{import-policy-rules.mjs,package-export-rules.mjs}`
- `packages/{assistant-cli,assistantd,assistant-engine,cli,operator-config,setup-cli,vault-usecases}/**`
- directly coupled focused tests and vitest configs only where required
- this plan and the coordination-ledger row for the lane

## Constraints

- Preserve unrelated dirty-tree work.
- Keep the diff narrow to the four requested seam cleanups; do not widen into broader assistant/runtime/device redesign.
- Do not weaken boundary rules to make the current tree pass.
- If a scoped commit would absorb unrelated dirty work, stop at a verified handoff and document the blocker precisely.

## Decisions

- `packages/vault-usecases` now exposes only `core`/`importers`/`query`; CLI owns the `devices` service-group type plus localhost control-plane/device-daemon composition and passes the device services directly into the device command surface.
- Packages that intentionally do not export `"."` no longer keep hidden root `main`/`types` fallbacks or root tsconfig/vitest aliases; workspace-boundary guards now fail any undeclared root alias for a workspace package that omits `"."`.
- The operator-facing CLI inbox model-routing files now live in `packages/cli`, while `@murphai/assistant-engine` drops the public `./inbox-model-contracts`, `./inbox-model-harness`, and `./model-harness` exports; assistant-engine keeps only private automation routing internals plus an internal assistant-namespace bridge for white-box tests and assistant-owned internals.
- `@murphai/assistant-engine/assistant-runtime` now re-exports only assistant-engine-owned helpers, and generic text/env/shared helper callsites import the lower `@murphai/operator-config/*` owner directly.

## Verification

- `pnpm typecheck`
  - fails for unrelated pre-existing `packages/query` errors (`browser-replica`, `wearables`, and `wearables-source-health-final.test.ts`), not for the boundary lane.
- `bash scripts/workspace-verify.sh test:diff ARCHITECTURE.md tsconfig.base.json apps/cloudflare/vitest.shared.ts scripts/workspace-boundaries/import-policy-rules.mjs scripts/workspace-boundaries/package-export-rules.mjs packages/assistant-cli packages/assistantd packages/assistant-engine packages/cli packages/operator-config packages/setup-cli packages/vault-usecases`
  - fails early on unrelated pre-existing `packages/device-syncd/src/providers/whoop.ts(253,22)` (`TS1354`).
- `pnpm --dir packages/assistant-cli exec vitest run test/assistant-daemon-client-owned-coverage.test.ts --config vitest.config.ts --no-coverage`
  - passed.
- `pnpm --dir packages/assistant-engine exec vitest run test/assistant-cli-tool-catalog.test.ts test/assistant-cli-tools-capabilities.test.ts --config vitest.config.ts --no-coverage`
  - passed.
- `env MURPH_PREPARED_CLI_RUNTIME_ARTIFACTS=1 pnpm exec vitest run --config packages/cli/vitest.workspace.ts packages/cli/test/device-knowledge-command-coverage.test.ts packages/cli/test/inbox-model-harness.test.ts packages/cli/test/inbox-model-route.test.ts packages/cli/test/assistant-core-facades.test.ts --no-coverage`
  - passed.
- `env MURPH_PREPARED_CLI_RUNTIME_ARTIFACTS=1 pnpm exec vitest run --config packages/cli/vitest.workspace.ts packages/cli/test/assistant-harness.test.ts packages/cli/test/assistant-provider.test.ts packages/cli/test/incur-smoke.test.ts --no-coverage`
  - passed.
- Required `coverage-write` audit worker attempt on `gpt-5.4-mini`
  - initial worker attempt was blocked by a Codex usage-limit error.
  - a later retry succeeded and added one narrow regression to `packages/cli/test/vault-cli-wiring.test.ts` proving that neutral `@murphai/vault-usecases` services stay device-free and that CLI-local helpers compose the `devices` group.
- `env MURPH_PREPARED_CLI_RUNTIME_ARTIFACTS=1 pnpm exec vitest run --config packages/cli/vitest.workspace.ts packages/cli/test/device-knowledge-command-coverage.test.ts packages/cli/test/inbox-model-harness.test.ts packages/cli/test/inbox-model-route.test.ts packages/cli/test/assistant-core-facades.test.ts packages/cli/test/assistant-harness.test.ts packages/cli/test/assistant-provider.test.ts packages/cli/test/incur-smoke.test.ts packages/cli/test/vault-cli-wiring.test.ts --no-coverage`
  - passed after the coverage-write regression landed.
- Required `task-finish-review` audit on `gpt-5.4` / `xhigh`
  - completed.
  - one medium finding was that the architecture text overstated the inbox-routing ownership transfer; the doc and this plan now reflect the safe landed state: CLI owns the operator-facing surface, while assistant-engine still retains private automation routing internals.
  - one high-severity overlapping provider finding remains in the touched review surface (`presetId: 'vercel-ai-gateway'` without a canonical gateway base URL can still split runtime normalization from execution behavior). That issue lives in the active assistant-provider hardening lane and was not introduced by the boundary-cut diff.
- `git diff --check -- ARCHITECTURE.md tsconfig.base.json apps/cloudflare/vitest.shared.ts scripts/workspace-boundaries/import-policy-rules.mjs scripts/workspace-boundaries/package-export-rules.mjs packages/assistant-cli packages/assistantd packages/assistant-engine packages/cli packages/operator-config packages/setup-cli packages/vault-usecases agent-docs/exec-plans/active/2026-04-23-boundary-hard-cut-followups.md`
  - passed for the exact lane file list.
Completed: 2026-04-23
