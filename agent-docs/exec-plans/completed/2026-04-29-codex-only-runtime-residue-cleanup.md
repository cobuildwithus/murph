# Codex-Only Runtime Residue Cleanup

## Goal

Remove stale assistant runtime/provider surfaces that only remain from the pre-Codex-only execution model.

## Scope

- Remove OpenAI-compatible provider target/config/setup residue where it is no longer needed for current Codex CLI execution.
- Remove dead provider failover/cooldown route state now that execution is Codex-only.
- Remove low-risk no-op capability/model-discovery seams where they only support deleted providers.
- Preserve `murph model` for now.
- Preserve hosted Vercel AI Gateway configuration.
- Preserve Codex app-server and local E2E support.

## Constraints

- Do not touch unrelated active hosted/runtime rows unless a direct compile fix requires it.
- Preserve unrelated dirty work in the current checkout.
- Keep historical completed-plan snapshots untouched.

## Verification Plan

- Prefer focused package checks while iterating.
- Required final verification: `pnpm typecheck` plus coverage-bearing focused checks for touched package owners, or record unrelated blockers.
- Run required completion audit passes before handoff.

## Progress

- Removed Codex-only stale runtime/provider surfaces: OpenAI-compatible setup/presets, failover/cooldown route state, model discovery/request-format capability seams, hosted ZDR env/config residue, and assistant per-turn provider/OSS flags.
- Preserved `murph model`, Codex OSS model setup, hosted Vercel AI Gateway model provider config, and Codex app-server E2E/local shim support.
- Tightened hosted usage attribution to Codex CLI plus Vercel AI Gateway, and narrowed runtime-state hosted member AI credential detection to `VERCEL_AI_API_KEY`.
- Kept unsupported persisted assistant targets fail-closed with a generic Codex App Server error.
- Updated generated CLI artifacts with `pnpm --dir packages/cli gen:config-schema`.

## Verification

- `pnpm typecheck` passed.
- `pnpm --dir packages/operator-config build` passed.
- `pnpm --dir packages/operator-config test:coverage` passed.
- `pnpm --dir packages/assistant-engine build` passed.
- `pnpm --dir packages/assistant-engine typecheck` passed.
- `pnpm --dir packages/assistant-engine exec vitest run test/provider-seams.test.ts test/assistant-service-runtime.test.ts test/assistant-notification-turn-runtime.test.ts test/assistant/rich-content-routing.test.ts --config vitest.config.ts --no-coverage` passed.
- `pnpm --dir packages/assistant-runtime build` passed.
- `pnpm --dir packages/assistant-runtime typecheck` passed.
- `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-usage.test.ts test/hosted-runtime-platform.test.ts test/hosted-runtime-environment.test.ts --config vitest.config.ts --no-coverage` passed.
- `pnpm --dir packages/runtime-state typecheck` passed.
- `pnpm --dir packages/runtime-state exec vitest run test/assistant-usage.test.ts test/assistant-usage-path.test.ts test/hosted-bundle.test.ts --config vitest.config.ts --no-coverage` passed.
- `pnpm --dir packages/cli typecheck` passed.
- `pnpm --dir packages/cli exec vitest run test/setup-cli.test.ts test/assistant-state.test.ts test/cli-typed-agent-inputs-schema.test.ts --config vitest.config.ts --no-coverage` passed.
- `pnpm --dir packages/cli exec vitest run test/assistant-cli.test.ts -t "assistant session list and show expose assistant runtime metadata through the CLI" --config vitest.config.ts --no-coverage` passed.
- `pnpm --dir packages/cli gen:config-schema` passed.
- `pnpm build:test-runtime:prepared` passed.
- `pnpm exec vitest run apps/web/test/hosted-execution-usage.test.ts apps/web/test/hosted-execution-stripe-metering.test.ts --config apps/web/vitest.config.ts --no-coverage` passed.
- Residue scans for blocked runtime/provider/failover/ZDR/model-discovery/per-turn-flag names are clean in active source/tests, apart from historical CLI release notes and a completed-plan note.
- `git diff --check` passed.

## Handoff

- No scoped commit yet: this checkout has extensive unrelated dirty work and overlapping active ledger rows across the same assistant/runtime packages, so staging a safe exact-path commit is not clean.
Status: completed
Updated: 2026-04-29
Completed: 2026-04-29
