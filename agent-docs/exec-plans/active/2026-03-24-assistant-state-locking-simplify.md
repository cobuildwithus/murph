# Assistant state locking simplify

Status: completed
Created: 2026-03-24
Updated: 2026-03-24

## Goal

- Remove duplicated assistant-state write-lock internals shared by assistant cron and assistant memory without changing any user-visible or concurrency-visible behavior.

## Success criteria

- `packages/cli/src/assistant/cron/locking.ts` and `packages/cli/src/assistant/memory/locking.ts` delegate to one private shared helper/factory.
- Public wrappers and exported behavior stay unchanged, including lock directory paths, metadata filenames, owner-key prefixes, error codes, and user-facing messages.
- Nested/reentrant calls and per-root serialization semantics remain intact and are pinned by focused tests.

## Scope

- In scope:
  - assistant cron and assistant memory write-lock internals
  - one private shared helper module under `packages/cli/src/assistant/`
  - focused regression tests for assistant-state write locking
- Out of scope:
  - changing call sites outside the existing cron/memory wrappers
  - changing assistant-state storage paths or error wording
  - broader assistant runtime/session refactors

## Constraints

- Preserve lock paths, metadata paths, owner keys, error codes, and user-facing strings byte-for-byte.
- Preserve the current per-root promise-chain queue and nested `AsyncLocalStorage` reentrancy behavior.
- Keep the helper private to assistant internals.

## Risks and mitigations

1. Risk: shared helper subtly changes the serialized/reentrant ordering contract.
   Mitigation: lift the current logic almost verbatim and add focused regression coverage for nested calls/serialization.
2. Risk: helper extraction drifts cron and memory error handling or metadata parsing.
   Mitigation: pass variant-specific strings/prefixes into the helper and keep wrapper exports stable.

## Tasks

1. Inspect the duplicated lock modules and existing assistant-state tests for current behavior.
2. Extract a private shared assistant-state write-lock helper with configurable lock metadata/error details.
3. Rewire cron and memory wrappers to the helper while keeping public names and behavior unchanged.
4. Add focused regression coverage for nested/reentrant or queued assistant-state writes.
5. Run required audits/checks and record outcomes.

## Verification

- Focused commands:
  - `pnpm exec vitest run packages/cli/test/assistant-cron.test.ts packages/cli/test/assistant-state.test.ts packages/cli/test/assistant-cli.test.ts --no-coverage --maxWorkers 1`
  - `pnpm exec vitest run packages/cli/test/assistant-state.test.ts --no-coverage --maxWorkers 1`
- Required commands:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`

## Outcome

- Extracted a private shared `createAssistantStateWriteLock` helper under `packages/cli/src/assistant/state-write-lock.ts`.
- Rebuilt the cron and memory lock wrappers on top of that helper without changing their public wrapper names, lock paths, owner-key prefixes, invalid-metadata strings, or held-lock error formatting.
- Renamed the AsyncLocalStorage bookkeeping in the shared helper to `reentrantRootStorage` / `reentrantRoots` to make the serialization boundary explicit.
- Added a focused assistant-memory regression test that proves nested same-root lock reentry still succeeds while concurrent same-root callers remain serialized.

## Verification results

- Focused assistant-state regression passed:
  - `pnpm exec vitest run packages/cli/test/assistant-state.test.ts --no-coverage --maxWorkers 1`
- Broader suggested regression surface is currently red for unrelated pre-existing reasons:
  - `pnpm exec vitest run packages/cli/test/assistant-cron.test.ts packages/cli/test/assistant-state.test.ts packages/cli/test/assistant-cli.test.ts --no-coverage --maxWorkers 1`
    - new lock regression passed under `assistant-state.test.ts`
    - `assistant-cli.test.ts` failed in unrelated existing runtime/build paths (`packages/query/src/health/canonical-collector.ts` and source-CLI/Corepack JSON parsing)
    - `assistant-cron.test.ts` is not currently included by the repo Vitest config filter and does not run under direct file targeting
- Required commands failed for unrelated pre-existing issues outside this lock refactor:
  - `pnpm typecheck`
    - fails in `packages/inboxd/src/indexing/persist.ts` with `TS2307: Cannot find module '@healthybob/contracts'`
  - `pnpm test`
    - fails during workspace build in `packages/cli/src/chat-provider.ts` because `abortSignal` is not in `CodexExecInput`
  - `pnpm test:coverage`
    - fails at the same `packages/cli/src/chat-provider.ts` build error plus an unrelated comparison error in `packages/cli/src/run-terminal-logging.ts`
