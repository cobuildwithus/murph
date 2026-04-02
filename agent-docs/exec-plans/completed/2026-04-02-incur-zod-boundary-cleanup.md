# Incur To Zod Boundary Cleanup

## Goal

Remove `incur` from the lower-level `@murphai/gateway-core` and `@murphai/assistant-core` packages where it is currently used for schema definitions, replace those usages with plain `zod`, and keep CLI-facing error handling correct without relying on `IncurError` inheritance below the CLI layer.

## Scope

- Replace `import { z } from 'incur'` with `import { z } from 'zod'` across the targeted `gateway-core` and `assistant-core` schema/contract/helper modules.
- Add a direct `zod` dependency to `@murphai/gateway-core` and remove its `incur` dependency.
- Remove the `IncurError` inheritance from `packages/assistant-core/src/vault-cli-errors.ts` while preserving the current `code`, `message`, and `context` surface used by callers.
- Refresh the lockfile and any affected package metadata.

## Constraints

- Preserve unrelated dirty worktree edits and avoid overlapping the active assistant prompt/system-prompt lane in `packages/assistant-core/src/assistant/**` except for the already-owned `assistant/cron/store.ts` schema import if needed.
- Do not widen the change into CLI command routing or a broader package-ownership redesign.
- Keep runtime behavior and exported schemas stable; this is a dependency-boundary cleanup, not a contract rewrite.

## Verification

- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`

## Outcome

- Completed. `@murphai/gateway-core` and `@murphai/assistant-core` now use plain `zod` for their schema surfaces, while CLI-facing `VaultCliError` handling is rewrapped at the `packages/cli` boundary through an `incur` middleware bridge.
- Verification passed with `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`, and a focused `packages/cli/test/incur-smoke.test.ts` run covering the bridge envelope.
Status: completed
Updated: 2026-04-02
Completed: 2026-04-02
