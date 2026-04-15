# Codex Image Cleanup

## Goal

Refactor the Codex image passthrough implementation so supported user-message content policy is defined in one shared assistant-provider contract and the Codex image materialization path stays as simple as the current feature requires.

## Success Criteria

- Assistant-provider capabilities expose one canonical supported user-message-part policy for routing and execution.
- Codex image routing and provider execution derive from that shared policy instead of duplicating a special-case.
- Codex runtime image inputs are simplified without losing the current Telegram image passthrough behavior.
- Catalog and focused tests stay internally consistent with Codex image support and PDF/file exclusion.

## Scope

- `packages/assistant-engine/**`
- `packages/cli/test/**`

## Constraints

- Keep Telegram ingestion unchanged.
- Keep Codex image passthrough behavior intact.
- Keep PDF/file parts excluded for Codex.
- Avoid unrelated assistant prompt/system-prompt or meal-add work already in flight.

## Verification

- `pnpm --dir packages/assistant-engine typecheck`
- `pnpm --dir packages/assistant-engine test:coverage -- test/assistant-codex-runtime.test.ts test/assistant/rich-content-routing.test.ts test/provider-registry-helpers.test.ts test/provider-registry-attempts.test.ts test/assistant-provider-final-coverage.test.ts test/provider-execution.test.ts`
- `pnpm --dir ../.. exec vitest run --config packages/cli/vitest.workspace.ts --project cli-assistant packages/cli/test/assistant-provider.test.ts packages/cli/test/assistant-runtime.test.ts --no-coverage`
- Required `coverage-write` audit on `gpt-5.4-mini`
- Required `task-finish-review` audit
Status: completed
Updated: 2026-04-15
Completed: 2026-04-15
