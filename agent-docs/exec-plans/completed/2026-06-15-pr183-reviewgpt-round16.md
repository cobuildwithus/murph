Goal (incl. success criteria):
- Fix PR 183 ReviewGPT round 16 high finding: same-millisecond prepared batches must not both own and dispatch the same outbox intent.

Constraints/Assumptions:
- Keep the architecture simple: one opaque prepared-dispatch token on the existing outbox intent, no new queue/table.
- Token must be required for prepared dispatch and prepared reset.
- Preserve normal non-prepared outbox dispatch behavior.
- Run focused tests, typecheck, and diff-based verification before committing.

Key decisions:
- Add `preparedDispatchToken` to the persisted assistant outbox intent schema with default `null`.
- Generate one token per hosted prepared effect, persist it on the sending row, and return it to the caller.
- Require token equality in prepared dispatch and reset CAS checks.

State:
- Verification passed; ready to commit and rerun ReviewGPT.

Done:
- ReviewGPT round 16 identified the timestamp collision ownership race.
- Added `preparedDispatchToken` to outbox intent schema.
- Required token equality for prepared dispatch and prepared reset.
- Added same-millisecond competing batch regression coverage.
- Focused assistant-engine and assistant-runtime tests passed.
- `pnpm typecheck` passed.
- `pnpm test:diff packages/operator-config/src/assistant-cli-contracts.ts packages/assistant-engine/src/assistant/outbox.ts packages/assistant-engine/src/assistant/outbox/dispatch-state.ts packages/assistant-engine/test/assistant-outbox-runtime.test.ts packages/assistant-engine/test/outbox-dispatch-state.test.ts packages/assistant-runtime/src/hosted-runtime/callbacks.ts packages/assistant-runtime/test/hosted-runtime-callbacks.test.ts packages/assistant-cli/test/assistant-doctor.test.ts packages/assistant-cli/test/assistant-daemon-client-owned-coverage.test.ts` passed.
- `git diff --check` passed.

Now:
- Commit and push the round 16 fix.

Next:
- Run ReviewGPT round 17.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `packages/operator-config/src/assistant-cli-contracts.ts`
- `packages/assistant-engine/src/assistant/outbox/dispatch-state.ts`
- `packages/assistant-engine/src/assistant/outbox.ts`
- `packages/assistant-runtime/src/hosted-runtime/callbacks.ts`
- matching tests
Status: completed
Updated: 2026-06-16
Completed: 2026-06-16
