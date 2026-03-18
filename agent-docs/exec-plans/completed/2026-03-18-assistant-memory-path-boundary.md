# Narrow assistant memory path boundary

Status: completed
Created: 2026-03-18
Updated: 2026-03-18

## Goal

- Narrow the assistant memory path boundary so memory code and `assistant memory` CLI handlers only receive the memory-specific path surface they need.
- Preserve the existing assistant-state path layout and CLI-visible `stateRoot` output while reducing accidental access to non-memory assistant-state paths.

## Success criteria

- A concrete `AssistantMemoryPaths` shape exists and resolves only `assistantStateRoot`, `dailyMemoryDirectory`, and `longTermMemoryPath`.
- Memory internals and `assistant memory search|get|upsert|forget` handlers stop depending on the full `AssistantStatePaths` surface.
- The compatibility story for the existing exported `resolveAssistantMemoryPaths` symbol is explicit and does not silently expand new internal call sites back to the full assistant-state surface.
- Focused assistant path/CLI tests cover the narrowed resolver plus unchanged `stateRoot` output.

## Scope

- In scope:
- `packages/cli/src/assistant/memory.ts` path types/helpers needed to narrow the memory boundary
- `packages/cli/src/commands/assistant.ts` memory command handler updates
- targeted assistant CLI/state verification for the narrowed boundary without changing persisted layout
- Out of scope:
- assistant session/transcript/automation path layout changes
- renaming the assistant-state root or changing any persisted memory file locations
- wider assistant command-surface or provider/runtime refactors

## Constraints

- Technical constraints:
- Do not change the on-disk assistant-state layout.
- Keep CLI `stateRoot` output intact for assistant memory commands.
- Avoid risky public API breakage from the index re-export unless compatibility can be defended.
- Product/process constraints:
- Follow the coordination-ledger gate and repo completion workflow.
- Run the required repo verification commands after the code/test updates.

## Risks and mitigations

1. Risk: narrowing the exported resolver signature could break external TypeScript consumers that currently treat it as full assistant-state access.
   Mitigation: keep a deprecated compatibility alias for the wide contract while moving internal code to a new narrow resolver.
2. Risk: command-handler edits accidentally change rendered `stateRoot` output or persisted path layout.
   Mitigation: reuse the same underlying state-root derivation and add CLI assertions that `stateRoot` still appears.

## Tasks

1. Add the narrow assistant-memory path type and a real memory-only resolver.
2. Rewire assistant memory internals and memory command handlers to that narrow resolver.
3. Extend assistant state/CLI tests for the narrowed boundary and unchanged `stateRoot` output.
4. Run required verification plus completion-workflow audit passes, then commit the scoped files.

## Decisions

- Keep the existing exported `resolveAssistantMemoryPaths` symbol as a deprecated compatibility alias returning full assistant-state paths, and introduce a separate narrow resolver for new/internal memory-only use.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Expected outcomes:
- The required repo checks pass, or any unrelated pre-existing failure is explicitly documented with a defensible causal separation.

## Outcome

- Added a concrete `AssistantMemoryPaths` type in `assistant/memory.ts` plus a real `resolveAssistantMemoryStoragePaths` helper that returns only the memory-specific assistant-state subset.
- Moved assistant memory internals and `assistant memory search|get|upsert|forget` CLI handlers onto the narrow helper while keeping the deprecated `resolveAssistantMemoryPaths` compatibility wrapper for full-state callers.
- Added direct test coverage for the narrow resolver and strengthened assistant memory CLI assertions so `stateRoot` stays present and stable across memory commands.

## Verification results

- Passed:
  - `pnpm exec vitest run packages/cli/test/assistant-state.test.ts --no-coverage --maxWorkers 1`
  - `pnpm exec vitest run packages/cli/test/assistant-cli.test.ts --no-coverage --maxWorkers 1`
- Failed for unrelated pre-existing reasons:
  - `pnpm typecheck`
    - `packages/core/src/**` reported existing `TS6305` contracts build-output errors plus an existing `TS7053` error in `packages/core/src/mutations.ts`.
  - `pnpm test`
    - `packages/web` failed its Next.js build because `@healthybob/query` / `@healthybob/query/search` could not be resolved from `packages/web/src/lib/overview.ts`.
  - `pnpm test:coverage`
    - `packages/contracts` failed while cleaning `packages/contracts/dist` with `ENOTEMPTY`, before the run reached the CLI coverage surface.
Completed: 2026-03-18
