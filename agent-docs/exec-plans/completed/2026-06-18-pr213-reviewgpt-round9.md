# PR 213 ReviewGPT Round 9 Fixes

Status: completed
Created: 2026-06-18
Updated: 2026-06-18

## Goal

- Resolve verified ReviewGPT round 9 findings for PR 213 with the smallest durable changes.

## Success Criteria

- Concurrent progress delivery cannot let `finish_without_reply` pass while user-visible output is still pending.
- Interactive CLI turns marked `responseDisposition: "none"` do not render empty replies, and no-reply transcript markers are hidden from user-facing transcript projection.
- Unsafe native Codex resume state is durably invalidated before `finish_without_reply` is acknowledged.
- Unreachable trace-removal protocol is deleted if static verification confirms it is unnecessary.
- Focused tests and scoped verification pass, then the PR branch is committed and pushed.

## Scope

- In scope: no-reply finalization, progress pending tracking, CLI turn outcome/projection, durable Codex resume invalidation hook, directly related trace protocol cleanup, and tests.
- Out of scope: unrelated assistant UX changes, broad runtime refactors, or new persisted state.

## Constraints

- Prefer deletion and direct value flow over new abstractions.
- Preserve the pushed PR-head review target and unrelated active ledger rows.
- Keep response files under `audit-packages/` local and uncommitted.

## Risks And Mitigations

1. Risk: progress send races still expose output after no-reply.
   Mitigation: track in-flight visible progress by count or token and only clear pending after the last send settles.
2. Risk: durable resume clearing adds provider/service coupling.
   Mitigation: pass one narrow awaited invalidation callback from the session owner into provider execution.
3. Risk: CLI transcript filtering hides legitimate system status.
   Mitigation: filter only the explicit no-reply marker prefix.

## Tasks

1. Verify each ReviewGPT finding against current code. Done.
2. Patch accepted findings with focused tests. Done.
3. Run scoped typechecks/tests/build and required audits. Done.
4. Commit with `scripts/finish-task`, push, and decide whether another ReviewGPT round is needed. Pending commit/push.

## Verification

- `pnpm --filter @murphai/assistant-engine typecheck`
- `pnpm --filter @murphai/assistant-engine test -- assistant-wrapper-exports.test.ts assistant-codex-runtime.test.ts assistant-local-service-runtime.test.ts assistant-notification-turn-runtime.test.ts assistant-service-runtime.test.ts`
- `pnpm --filter @murphai/assistant-cli typecheck`
- `pnpm --filter @murphai/assistant-cli test -- assistant-ui-controller.test.ts assistant-ui-runtime.test.ts assistant-ui-state-view-model.test.ts assistant-ui-helpers.test.ts`
- `pnpm --filter @murphai/assistant-engine... build`
- Manual security/privacy, coverage, and deep-review pass completed after audit subagents were unavailable due usage limits.
Completed: 2026-06-18
