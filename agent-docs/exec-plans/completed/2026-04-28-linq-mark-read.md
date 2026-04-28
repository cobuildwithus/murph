# Linq Mark Read

## Goal

Mark inbound hosted Linq conversation chats as read only after the message has been durably imported into the local inbox.

Success criteria:
- `@murphai/operator-config/linq-runtime` exposes a small `markLinqChatRead` wrapper for `POST /chats/{chatId}/read`.
- Hosted Linq inbound conversation wakes call the wrapper after successful local inbox import.
- Outbound/self-authored Linq wakes and non-Linq wakes do not mark reads.
- Linq read failures remain best-effort and do not fail ingestion.
- Focused unit coverage proves the provider wrapper and hosted import behavior.

## Constraints / Assumptions

- Do not implement Linq `message.read` webhook handling in this task.
- Keep the side effect out of webhook parsing, onboarding transport, and assistant reply logic.
- Preserve existing typing behavior and avoid broad channel-activity refactors.
- Treat provider calls as external egress and avoid logging raw identifiers.

## Key Decisions

- Add the provider operation in `operator-config`, matching the existing Linq typing/delete wrapper style.
- Add a hosted runtime helper for best-effort channel activity.
- Invoke the helper from the shared local import seam so direct ingest and mailbox import both inherit the same post-import invariant.

## State

Implemented and verified. Ready to close.

## Done

- Read routing, architecture, verification, security, reliability, and coordination docs.
- Added `markLinqChatRead()` in `operator-config`.
- Added hosted runtime best-effort Linq read acknowledgement after local inbox import.
- Added focused provider-wrapper and hosted conversation import tests.
- Ran focused tests, package coverage, root typecheck, and required audits.

## Now

- Close active plan and create scoped commit if the dirty shared ledger permits it.

## Next

- Handoff with verification evidence and unrelated diff-aware blocker.

## Open Questions

- None.

## Working Set

- `packages/operator-config/src/linq-runtime.ts`
- `packages/operator-config/test/http-linq-device-runtime.test.ts`
- `packages/assistant-runtime/src/hosted-runtime/channel-activity.ts`
- `packages/assistant-runtime/src/hosted-runtime/events/conversation.ts`
- `packages/assistant-runtime/test/hosted-runtime-conversation-event.test.ts`
- `agent-docs/exec-plans/active/2026-04-28-linq-mark-read.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`

Verification:
- `pnpm exec vitest run test/http-linq-device-runtime.test.ts --config vitest.config.ts --no-coverage` from `packages/operator-config` passed.
- `pnpm exec vitest run test/hosted-runtime-conversation-event.test.ts --config vitest.config.ts --no-coverage` from `packages/assistant-runtime` passed.
- `pnpm --dir packages/operator-config typecheck` passed.
- `pnpm --dir packages/assistant-runtime typecheck` passed.
- `pnpm --dir packages/operator-config test:coverage` passed.
- `pnpm --dir packages/assistant-runtime test:coverage` passed.
- `pnpm typecheck` passed.
- Scoped `test:diff` failed on unrelated missing coordination row for `2026-04-28-hosted-thin-runner-snapshot.md`.
Status: completed
Updated: 2026-04-28
Completed: 2026-04-28
