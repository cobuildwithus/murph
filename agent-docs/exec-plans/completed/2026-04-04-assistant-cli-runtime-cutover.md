# 2026-04-04 Assistant CLI Runtime Cutover

## Goal

Cut provider-turn assistant execution over to a CLI-first Murph runtime so assistant turns can invoke `vault-cli` directly instead of depending on the large hand-built provider tool catalog. Keep the long-term architecture simple: the CLI is the canonical operator surface, and the provider-turn runtime should use it directly.

## Scope

- `packages/assistant-core/src/assistant/provider-turn-runner.ts`
- `packages/assistant-core/src/assistant/system-prompt.ts`
- `packages/assistant-core/src/assistant-cli-access.ts`
- `packages/assistant-core/src/assistant-cli-tools.ts`
- Focused provider/runtime tests under `packages/cli/test/**`

## Constraints

- Preserve overlapping dirty-tree edits in `provider-turn-runner.ts` and `system-prompt.ts`.
- Keep inbox-routing catalogs and unrelated hosted/runtime work untouched.
- Do not introduce a package dependency from `assistant-core` back up into `packages/cli`.
- Keep the assistant on the bound vault by default and continue using Murph validation/audit paths.

## Plan

1. Add a provider-turn CLI executor tool that shells out to the real local `vault-cli`, injects the bound vault when appropriate, and supports CLI discovery surfaces like `--help`, `--schema`, and `--llms`.
2. Switch provider turns to use a CLI-first catalog rather than the large hand-built provider catalog, while preserving the small non-CLI helper tools that still matter.
3. Simplify provider-turn system prompt guidance so it points the model at the CLI executor as the primary Murph runtime surface.
4. Update focused provider/runtime tests, run required verification, then complete the required audit and scoped commit flow.

## Verification

- `pnpm exec vitest run packages/cli/test/assistant-service.test.ts packages/cli/test/assistant-runtime.test.ts --no-coverage --maxWorkers 1`
- `pnpm typecheck`
- Direct provider-turn CLI proof via `pnpm exec tsx --eval ... createProviderTurnAssistantToolCatalog(...).executeCalls(...)`, covering a successful `device provider list`, a successful `assistant state put --input -`, temp-path redaction in returned argv, and explicit `--vault` override rejection.

## Audit Follow-up

- Fixed provider-turn CLI executor bypasses by rejecting explicit `--vault` overrides and parsing blocked command paths with the same root-option handling used by operator config.
- Redacted returned argv and error metadata so bound-vault and temp-input absolute paths do not leak back through tool results.
- Switched `--input -` materialization to a private temp directory with `0600` payload writes and recursive cleanup.

Status: completed
Updated: 2026-04-04
Completed: 2026-04-04
