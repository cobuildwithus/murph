Goal (incl. success criteria):
- Make OpenAI Responses continuity reliable after native-resume invalidation by using an explicit provider history mode instead of replaying historical assistant turns as structured Responses messages.
- Success: Responses native resume sends no replayed transcript, Responses fallback sends transcript only as text bootstrap context, and focused tests cover both paths.

Constraints/Assumptions:
- Keep the change minimal and local to assistant-engine provider request shaping plus focused tests.
- Preserve unrelated dirty work and active ledger rows; do not revert or stage files outside this task.
- Do not log or fixture raw contact identifiers, secrets, local paths, or personal identifiers.

Key decisions:
- Prefer `previousResponseId` as the native OpenAI Responses resume primitive.
- Represent fallback transcript serialization with a small provider history-mode helper instead of scattered Responses conditionals.
- Keep structured replay for generic chat-message providers.

State:
- Implementation complete; closing after scoped commit.

Done:
- Traced production failure to Responses fallback replay of historical assistant messages as structured AI SDK messages.
- Added provider history-mode request shaping.
- Added direct tests for Responses fallback, Responses invalid resume fallback, Responses native resume, and generic chat stale-resume replay.
- Ran required security/privacy, coverage-write, and task-finish review passes; fixed the final-review stale generic resume finding.

Now:
- Close the plan with a scoped commit if the dirty shared ledger allows it without absorbing unrelated work.

Next:
- Watch production logs after deploy to confirm long Linq fallback no longer emits structured historical assistant items.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `packages/assistant-engine/src/assistant/providers/helpers.ts`
- `packages/assistant-engine/test/provider-continuity.test.ts`
- `packages/assistant-engine/test/provider-execution.test.ts`
- `agent-docs/exec-plans/active/2026-04-26-responses-history-mode.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
Status: completed
Updated: 2026-04-26
Completed: 2026-04-26
