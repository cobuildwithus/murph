# Hosted Before-Delivery Mailbox Refresh

## Goal

Add the smallest hosted before-delivery mailbox refresh hook that composes with the existing local assistant turn revision loop.

Success criteria:

- Hosted automation can call a mailbox refresh callback immediately before assistant delivery.
- Revision decisions stay delegated to `listNewConversationCaptures` and `AssistantTurnRevisionRequiredError`.
- No web-owned peek/adopt, run adoption, committed sequence, finalize, `source_cursor`, or Cloudflare queue semantics are introduced.
- Focused tests prove callback ordering and revision delegation without raw hosted payload fixtures.

## Constraints

- Work only in `packages/assistant-runtime/src/hosted-runtime/**` and/or `packages/assistant-engine/src/**` if needed, plus focused tests.
- Preserve Worker A/B lanes around checkpoint wrappers and conversation import adapters.
- Preserve unrelated dirty work in the shared checkout.
- Keep logs and fixtures redacted.

## State

Implemented narrow seam and focused tests. Focused verification and required reviews are complete.

## Done

- Read required routing, architecture, security, reliability, verification, completion, and migration Phase 3 docs.
- Traced local revision path: `createAssistantTurnBeforeDeliveryHook` refreshes before delivery, lists same-conversation captures, and throws `AssistantTurnRevisionRequiredError`; `automation/reply.ts` catches it for bounded reruns/defer.
- Added optional hosted `refreshMailboxBeforeDelivery` platform callback.
- Updated hosted turn input so the mailbox callback runs only for `before_delivery`, before the inbox-backed capture listing, and takes precedence over legacy hosted turn-input refresh for that phase.
- Added focused coverage that proves callback ordering, local revision delegation, progress propagation, and redacted failure logging.
- Focused exact Vitest file passed; package-local typecheck passed; scoped `git diff --check` passed.
- Security/privacy review, coverage-write, and task-finish-review found no required production changes.
- Package-level assistant-runtime test command fanned out and failed in unrelated Worker A checkpoint coverage: expected `payload.sidecar_missing` but received `payload.sidecar_unavailable`.

## Now

- Hand off the integration seam because a safe scoped commit is blocked by overlapping active Worker A/B and ledger edits in the shared checkout.

## Next

- Parent/Worker A/B can wire `refreshMailboxBeforeDelivery` to the durable mailbox import/checkpoint wrapper once that wrapper is stable.

## Open Questions

- UNCONFIRMED: final durable wrapper name/signature for the mailbox import/checkpoint adapter. Current integration point is `HostedRuntimePlatform.refreshMailboxBeforeDelivery`.

## Working Set

- `packages/assistant-runtime/src/hosted-runtime/turn-input.ts`
- `packages/assistant-runtime/test/hosted-runtime-turn-input.test.ts`
- `packages/assistant-runtime/src/hosted-runtime/mailbox-import.ts` (read-only unless unavoidable)
- `packages/assistant-engine/src/assistant/turn-input.ts` (read-only unless unavoidable)
- `packages/assistant-engine/src/assistant/automation/reply.ts` (read-only unless unavoidable)
Status: completed
Updated: 2026-04-26
Completed: 2026-04-26
