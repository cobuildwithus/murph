Goal (incl. success criteria):
- Deliver a completed hosted generated image promptly through its originating conversation even when newer conversation input is already waiting.
- Success means the trusted image-completion input is the next admitted Codex work once generation is ready, while newly arriving conversation input is retained by the existing foreground watcher for steering or the immediately following causal pass.

Constraints/Assumptions:
- Preserve the private `vault_image` trust boundary and the ordinary pending-input index as durable retry evidence.
- Do not add another queue, scheduler, sender, persisted state owner, or compatibility path.
- Do not interrupt a provider turn already in progress; preemption applies at the next assistant-admission boundary.
- Preserve unrelated work in the primary checkout.

Key decisions:
- Replace the invocation-local boolean image wake hint with the exact staged completion input batch returned by the image controller.
- Admit that exact batch before another initial mailbox import. When the existing live foreground watcher already captured newer conversation input, prepend the completion to that same frozen batch instead of starting an extra turn.
- Keep the pending-input index so runner loss or a failed completion turn retries through the existing durable path.
- Treat the provider continuation session as ordinary batching context, not authenticated group-route identity, for the exact trusted-completion match. The production importer does not attach that session to a newer inbound group message.

State:
- In progress.

Done:
- Reproduced the production delay and proved generation/canonical capture completed well before delivery.
- Identified the one-shot wake clearing and foreground-only fresh selection boundary.
- Read the hosted runtime, security, reliability, verification, and completion workflow guidance.
- Added a regression that failed with fresh conversation selected first and now proves the completion and fresh input enter one ordered Codex batch.
- Replaced the boolean wake hint with exact staged completion input ids and updated the architecture and invariant contracts.
- Remediated the first exact-head ReviewGPT round: production selectors and the assistant scanner now preserve the trusted completion-first batch, and readiness remains visible until the provider-acceptance boundary so shutdown can checkpoint an immediate retry.
- Added focused route-isolation, current-input-authority, provider-order, and shutdown-handoff proof; focused engine/runtime suites and package typechecks pass.
- Completed the required round-2 retrospective after production importer evidence showed that provider session equality split the trusted completion from a real newer group message. Chose shrink-and-continue: generic batching keeps session equality, while the exact trusted-completion route match reuses authenticated channel/account/thread authority without adding state or another owner.
- Added a production-importer end-to-end regression that proves a null-session group follow-up joins the ready completion in one completion-first Codex turn, becomes current at provider acceptance, and delivers through the same authenticated group route.

Now:
- Run focused verification and package typechecks for the retrospective correction.

Next:
- Commit and push the corrected candidate, update the PR evidence, then run final ReviewGPT round 3 and required CI against that exact head.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `packages/assistant-runtime/src/hosted-runtime.ts`
- `packages/assistant-runtime/src/hosted-runtime/turn-input.ts`
- `packages/assistant-engine/src/assistant/automation/grouping.ts`
- `packages/assistant-engine/src/assistant/automation/scanner.ts`
- `packages/assistant-runtime/src/hosted-runtime/image-generation.ts`
- `packages/assistant-runtime/test/hosted-runtime-image-generation.test.ts`
- `packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts`
- `ARCHITECTURE.md`
- `docs/contracts/00-invariants.md`
- `agent-docs/references/hosted-runtime-protocol.md`
