# Assistant runtime integration

Status: completed
Created: 2026-03-26
Updated: 2026-03-26

## Goal

- Integrate the assistant runtime worker lanes for lifecycle hooks, transcript maintenance, deterministic fallback routing, and event-driven automation onto the committed foundations base.
- Resolve overlap cleanly in the shared assistant runtime files and finish the implementation with repo verification and a staging commit.

## Success criteria

- The staging branch contains the foundations base plus the worker-lane changes for hooks, transcripts, fallbacks, and events.
- Shared files such as `assistant/service.ts`, `assistant/cron.ts`, `outbound-channel.ts`, and the automation loop retain all intended behavior from each lane without regressions.
- Required completion audits are run from staging.
- `pnpm typecheck` and `pnpm test` pass from the integrated staging worktree.
- `pnpm test:coverage` is rerun and any remaining failure is documented precisely if it is outside the integrated diff.

## Scope

- In scope:
  - worker diff integration and overlap resolution
  - any small glue fixes required to make the combined implementation coherent
  - verification, cleanup of active plan state, and final staging commit
- Out of scope:
  - unrelated assistant/runtime refactors outside the worker scope
  - touching the user's main dirty worktree

## Risks and mitigations

1. Risk: worker branches conflict semantically in `assistant/service.ts`, `assistant/cron.ts`, `outbound-channel.ts`, or automation paths.
   Mitigation: merge lane diffs one at a time, inspect the combined result after each overlap-heavy surface, and keep tests focused on the integrated behavior.
2. Risk: worker branches assumed a local install and may have incomplete verification/commit state.
   Mitigation: treat worker verification as advisory only and rerun all completion audits and required repo checks from the installed staging worktree.
3. Risk: active/complete plan docs and ledger rows become inconsistent after integration.
   Mitigation: keep a staging integration plan, move completed worker plans out of active state when the integrated implementation is finalized, and remove this integration ledger row when done.

## Tasks

1. Inspect worker branch diffs and register the staging integration surface.
2. Merge hooks, transcripts, fallbacks, and event-automation diffs onto staging, resolving overlap carefully.
3. Run completion-workflow audit passes from staging.
4. Run required repo verification from staging and fix any integration regressions.
5. Commit the integrated implementation from staging and summarize the results.

## Verification

- Completion workflow audit passes:
  - `pnpm review:gpt --preset simplify --dry-run`
  - `pnpm review:gpt --preset test-coverage-audit --dry-run --no-zip`
  - `pnpm review:gpt --preset task-finish-review --dry-run --no-zip`
- Required commands:
  - `pnpm typecheck` ✅
  - `pnpm test` ✅
  - `pnpm test:coverage` ❌ unrelated repo threshold miss: `packages/core/src/vault.ts` branch coverage 77.04% vs global threshold 80%
- Focused runtime verification:
  - `pnpm exec vitest run --coverage=false packages/cli/test/assistant-service.test.ts` ✅
  - `pnpm exec vitest run --coverage=false packages/runtime-state/test/ulid.test.ts packages/cli/test/assistant-state.test.ts packages/cli/test/assistant-runtime.test.ts packages/cli/test/assistant-channel.test.ts packages/cli/test/assistant-cron.test.ts packages/inboxd/test/inboxd.test.ts packages/parsers/test/parsers.test.ts` ✅
Completed: 2026-03-26
