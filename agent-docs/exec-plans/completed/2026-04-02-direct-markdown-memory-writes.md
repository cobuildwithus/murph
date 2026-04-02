# Direct Markdown memory writes

## Goal

Remove the dedicated assistant-memory write/delete API layer and have the assistant treat Markdown memory files as the write surface, while keeping memory search/get intact for recall.

## Why

- The current memory store is already Markdown-backed.
- The extra upsert/forget layer adds heuristics and a special write API the user explicitly wants removed.
- OpenClaw-style memory is simpler: ordinary file mutation for writes, indexed/search tooling for recall.

## Scope

- Remove assistant memory write/delete tools from the assistant tool catalog.
- Remove CLI `assistant memory upsert` and `assistant memory forget`.
- Update assistant prompt guidance to point memory writes at the Markdown files directly.
- Keep search/get and Markdown-backed read/index behavior intact.
- Update focused tests for the new guidance and surface area.

## Non-goals

- Do not replace search/get with a new special write API.
- Do not change the underlying Markdown memory storage locations.
- Do not widen into unrelated assistant config or hosted runtime work already active in the tree.

## Verification

- Focused assistant tests for memory command/tool surface and prompt guidance.
- Repo-required `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage`.

## Outcome

- Removed the model-facing assistant memory `upsert`/`forget` tools and the matching CLI commands, leaving `search` and `get` as the recall surface.
- Added bounded direct Markdown memory file tools for live assistant turns: the assistant can now read and replace `MEMORY.md` and dated `memory/YYYY-MM-DD.md` files without going through the semantic memory write API.
- Updated the assistant system prompt to prefer `assistant.memory.search`/`assistant.memory.get` for recall and `assistant.memory.file.read`/`assistant.memory.file.write` for direct Markdown edits.
- Regenerated `packages/cli/src/incur.generated.ts` from the built CLI entry so the generated Incur command map reflects the current CLI topology.
- Reworked focused assistant CLI/service tests to seed Markdown memory files directly and assert the new direct-file tool guidance.

## Verification notes

- Focused verification passed:
  - `pnpm --dir packages/assistant-core typecheck`
  - `pnpm --dir packages/cli build`
  - `pnpm exec vitest run --config packages/cli/vitest.workspace.ts packages/cli/test/assistant-service.test.ts packages/cli/test/assistant-cli.test.ts --coverage.enabled=false --maxWorkers 1`
- `pnpm typecheck` failed for a pre-existing unrelated CLI test issue:
  - `packages/cli/test/assistant-observability.test.ts(154,16): 'receiptCheck.details' is possibly 'undefined'`
- `pnpm test` failed for pre-existing unrelated workspace issues:
  - `packages/assistant-runtime/test/assistant-core-boundary.test.ts`: expected `config.defaultVault` to be `null`, received `'/tmp/invalid-preserved-value'`
  - `apps/cloudflare/test/node-runner.test.ts`: expected summary text `hosted assistant config unavailable`, received `hosted assistant config missing`
  - `apps/web/scripts/dev-smoke.ts`: active Next dev process lock on pid `84824`, port `62396`
- `pnpm test:coverage` failed for pre-existing unrelated workspace issues:
  - the same `apps/cloudflare/test/node-runner.test.ts` summary-string mismatch
  - `apps/cloudflare/test/deploy-automation.test.ts`: missing `@murphai/contracts/dist/index.js` under `packages/hosted-execution/node_modules`
  - `packages/cli/test/assistant-cli.test.ts`: unrelated `assistant self-target commands manage local saved outbound routes without needing a vault`
  - the same `apps/web` smoke lock on pid `84824`, port `62396`

Status: completed
Updated: 2026-04-02
Completed: 2026-04-02
