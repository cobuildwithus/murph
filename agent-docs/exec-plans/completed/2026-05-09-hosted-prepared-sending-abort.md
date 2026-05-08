# Hosted Prepared Sending Abort

## Goal

Prevent hosted foreground assistant replies from getting stranded in prepared
`sending` state when the runner aborts before any provider dispatch is entered.

## Scope

- Add a narrow outbox repair helper for prepared-but-not-dispatched intents.
- Use it only for current-turn foreground hosted delivery aborts before provider
  entry.
- Add focused tests for the outbox helper and hosted delivery abort behavior.

## Constraints

- Preserve existing prepared `outbox_sending` checkpoint semantics.
- Never revert an intent after provider dispatch may have been entered.
- Keep normal ambiguous-send and confirmation-pending behavior unchanged.
- Do not touch unrelated dirty worktree files.

## Verification

- `pnpm typecheck`
- `pnpm test:diff packages/assistant-engine/src/assistant/outbox/dispatch-state.ts packages/assistant-engine/src/assistant/outbox.ts packages/assistant-engine/test/outbox-dispatch-state.test.ts packages/assistant-runtime/src/hosted-runtime/callbacks.ts packages/assistant-runtime/test/hosted-runtime-callbacks.test.ts`

## Status

- Implementation and focused regression tests added.
- Focused Vitest tests passed for `outbox-dispatch-state` and
  `hosted-runtime-callbacks`.
- Security/privacy review found no security issue; its functional realism gap
  was addressed by allowing the guarded repair to reset matching no-provider
  dispatch-failure aftermath.
- Coverage pass added one Linq post-provider-entry guard test.
- Final review found the same production-path gap; fixed and retested.
- `git diff --check` passed for touched task files.
- `bash scripts/workspace-verify.sh test:diff ...` passed owner typechecks but
  remains blocked by unrelated `assistant-automation-runtime` expectations
  around `materializeWorkspaceArtifacts`.
- `pnpm typecheck` remains blocked by unrelated
  `packages/assistant-engine/src/assistant/automation/reply.ts` `executionContext`
  type errors.
Status: completed
Updated: 2026-05-09
Completed: 2026-05-09
