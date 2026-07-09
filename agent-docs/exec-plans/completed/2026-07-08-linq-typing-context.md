Goal (incl. success criteria):
- Diagnose and fix missing hosted Linq/iMessage typing indicators for member-reported recent replies.
- Success means hosted Linq typing uses the same delivery context proof as message delivery, including explicit current-inbound targets, without weakening recent-inbound guardrails or exposing message content.

Constraints/Assumptions:
- Keep the fix narrow to the existing assistant channel typing boundary.
- Do not log or persist message contents, phone numbers, raw provider identifiers, secrets, or local personal identifiers.
- Preserve existing Linq recent-inbound/context validation; typing must no-op when the current inbound context cannot be proven.
- Preserve unrelated active ledger rows and current branch work.

Key decisions:
- Carry Linq `targetKind` and `replyToMessageId` through the existing typing adapter contract instead of adding a special hosted-only path.
- Keep direct/non-hosted Linq typing on the existing simple `target` call.
- Add focused regression coverage for explicit hosted Linq typing resolution and the engine bridge carrying reply-to proof.

State:
- In progress.

Done:
- Inspected screenshot and runtime metadata: recent replies delivered, but typing-related hosted logs were absent.
- Identified root cause: hosted typing treated every Linq typing request as a thread target and passed no reply-to proof, while recent replies were delivered through explicit targets.
- Implemented a narrow typing contract fix and focused tests.
- Coverage audit identified a missing bridge test; added it.

Now:
- Run required verification and completion audits.

Next:
- Close this plan with a scoped commit after verification/audits pass.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- packages/assistant-engine/src/assistant/channel-typing.ts
- packages/assistant-engine/src/assistant/channels/descriptors.ts
- packages/assistant-engine/src/assistant/channels/helpers.ts
- packages/assistant-engine/src/assistant/channels/types.ts
- packages/assistant-engine/test/assistant-delivery-service.test.ts
- packages/assistant-engine/test/channel-helpers.test.ts
- packages/assistant-runtime/src/hosted-runtime/channel-activity.ts
- packages/assistant-runtime/test/hosted-runtime-channel-activity.test.ts
Status: completed
Updated: 2026-07-08
Completed: 2026-07-08
