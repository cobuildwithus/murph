# Hosted Linq First-Contact Home Thread

## Goal

Keep re-homing active hosted members onto capped Linq home lines while removing the separate activation-time handoff text so the only proactive signup message is Murph's canonical first-contact welcome.

## Why

- The current activation flow creates a new Linq home chat up front and sends a separate handoff message only to obtain a `chatId` for the later assistant welcome.
- That adds a redundant user-visible message and splits responsibility awkwardly between hosted web routing and assistant delivery.
- The cleaner boundary is: hosted web chooses the home line, assistant delivery materializes the home thread if needed by sending the canonical welcome as the first message.

## Scope

- `apps/web/src/lib/hosted-onboarding/**`
- `apps/web/test/**`
- `packages/hosted-execution/**`
- `packages/assistant-runtime/**`
- `packages/assistant-engine/**`

## Constraints

- Preserve active-member re-homing and per-line capacity selection.
- Remove the activation-time handoff copy entirely.
- Keep assistant-runtime as the owner of the proactive first-contact welcome.
- Avoid inventing a second callback/persistence lane unless the flow cannot work without it.
- Preserve unrelated worktree edits, including the dirty `apps/web/src/components/hosted-onboarding/join-invite-copy.ts`.

## Plan

1. Extend hosted activation/first-contact contracts so activation can carry either an existing Linq thread or enough metadata for assistant delivery to materialize the home thread.
2. Update hosted onboarding routing so activation stops creating a Linq chat just to obtain a thread id and instead persists only the chosen home-line metadata when no reusable chat exists.
3. Extend assistant Linq delivery and first-contact welcome delivery so the canonical welcome can create the home thread and then persist the real thread binding in assistant state.
4. Add focused coverage across web routing, hosted runtime activation, and assistant first-contact delivery.
5. Run required verification and audit passes, inspect diffs for scope/privacy, and land with a scoped finish-task commit.

## Verification Target

- `pnpm typecheck`
- `pnpm test:diff apps/web packages/assistant-engine packages/assistant-runtime packages/hosted-execution` if truthful in this workspace; otherwise the required owner/app coverage-bearing commands
- direct scenario proof from focused tests covering re-homed activation where the canonical welcome creates the home thread

## Status

- Implemented the first-contact union shape so activation can emit either a reusable thread target or a Linq home-thread materialization target.
- Removed the activation-time Linq handoff copy and proactive chat creation from hosted web.
- Kept home-line capacity/re-homing in hosted web by persisting recipient-phone assignment even before a Linq chat id exists.
- Updated assistant delivery to materialize the Linq chat from the canonical welcome, persist the upgraded thread binding, and fail closed if that binding cannot be saved.
- Marked both actor-scoped and upgraded thread-scoped first-contact dedupe records after successful materialized delivery.

## Verification Run

- `pnpm typecheck` passed.
- `pnpm --dir packages/hosted-execution typecheck` passed.
- `pnpm --dir packages/assistant-runtime typecheck` passed.
- `pnpm --dir packages/assistant-engine typecheck` passed.
- `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-onboarding-linq-home-routing.test.ts apps/web/test/hosted-onboarding-member-activation.test.ts apps/web/test/hosted-onboarding-member-store.test.ts` passed.
- `pnpm --dir packages/hosted-execution test:coverage` passed.
- `pnpm --dir packages/assistant-runtime test:coverage` passed.
- `pnpm --dir packages/assistant-engine test:coverage` passed.

## Audit Notes

- Required `simplify` pass found and we fixed three items: fail-closed session persistence after materialized send, actor+thread dedupe after thread upgrade, and dead activation-routing params.
- Required `coverage-write` pass on `gpt-5.4-mini` found the current proof sufficient and made no file changes.
- Final review found and we fixed two follow-ups: ambiguous Linq create-chat responses now become confirmation-pending instead of hard failure, and existing participant-scoped Linq sessions no longer skip home-thread materialization just because they already have turns.
Status: completed
Updated: 2026-04-15
Completed: 2026-04-15
