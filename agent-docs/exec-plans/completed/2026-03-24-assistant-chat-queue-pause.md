# Assistant chat queue and pause controls

Status: completed
Created: 2026-03-24
Updated: 2026-03-28

## Goal

- Add Codex-style follow-up queueing on `Tab` and Escape-driven pause behavior to the Ink-backed assistant chat without regressing transcript, slash-command, or session recovery flows.

## Success criteria

- `Tab` queues the current draft while a turn is streaming.
- `Tab` still submits immediately when the chat is idle.
- `Esc` interrupts an active turn and restores queued follow-ups to the composer instead of auto-sending them.
- Partial streamed assistant output remains visible after an interrupt.
- Codex interrupt failures are classified separately from connection loss and preserve recovered provider session ids.
- Focused tests cover submit-action resolution, queued draft restoration, provider abort plumbing, and Codex interrupt handling.

## Scope

- In scope:
- `packages/cli/src/assistant/ui/{ink,view-model}.ts`
- `packages/cli/src/{assistant-codex,chat-provider}.ts`
- `packages/cli/src/assistant/{service,provider-turn-recovery}.ts`
- targeted `packages/cli/test/{assistant-runtime,assistant-provider,assistant-codex}.test.ts`
- this plan and the coordination ledger
- Out of scope:
- broader assistant persistence refactors
- queue editing/history beyond current-session follow-ups
- changing Enter-while-busy behavior

## Constraints

- Preserve adjacent assistant runtime and Ink edits already present in the tree.
- Keep queued follow-ups ephemeral to the current Ink session.
- Do not revert unrelated worktree changes.

## Risks and mitigations

1. Risk: queued prompts could auto-send or duplicate unexpectedly.
   Mitigation: centralize queue/dequeue/restore helpers and cover the submit resolution path with focused tests.
2. Risk: Escape could surface as a generic provider failure.
   Mitigation: thread `AbortSignal` to the provider adapter and classify interrupted Codex exits explicitly.
3. Risk: interrupt handling could leave pending trace rows stuck.
   Mitigation: finalize pending trace rows on turn teardown, including interrupted turns.

## Verification

- Required repo checks after implementation:
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Focused verification if needed:
- `pnpm exec vitest run packages/cli/test/assistant-codex.test.ts packages/cli/test/assistant-provider.test.ts packages/cli/test/assistant-runtime.test.ts --no-coverage --maxWorkers 1`

## Verification results

- `pnpm exec vitest run packages/cli/test/assistant-codex.test.ts packages/cli/test/assistant-provider.test.ts packages/cli/test/assistant-runtime.test.ts --no-coverage --maxWorkers 1` passed (`3` files, `79` tests).
- `pnpm typecheck` passed.
- `pnpm test` failed in the pre-existing `packages/web` build path while compiling `packages/query/dist/**` because `@murph/contracts` is currently missing exports used by the built query bundle (`healthEntityDefinitionByKind`, `hasHealthEntityRegistry`, `deriveProtocolGroupFromRelativePath`, `parseFrontmatterDocument`, `parseFrontmatterScalar`).
- `pnpm test:coverage` failed for the same pre-existing `packages/web` build issue during `pnpm test:packages:coverage`.
Completed: 2026-03-28
