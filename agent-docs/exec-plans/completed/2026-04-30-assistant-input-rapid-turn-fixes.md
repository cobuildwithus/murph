# Assistant Input Rapid-Turn Fixes

Status: completed
Created: 2026-04-30
Updated: 2026-05-01

## Goal

Fix the remaining assistant-input hard-cut bugs found by review agents without
adding another architecture layer.

The intended spine stays:

```text
source adapter -> AssistantInputEvent -> AssistantInputSource -> scanner / active turn -> accepted-input journal -> Codex
```

`replyTarget` remains the private delivery authority. The stored conversation
reference remains the query/grouping identity. Inbox remains projection and
enrichment only.

## Success Criteria

- Rapid hosted captureless follow-up messages are listed by the active turn
  using the stored/minimized conversation ref, not the raw provider delivery id.
- Multiple pending active-turn admissions merge at checkpoint time so terminal
  evidence covers every accepted input id.
- Auto-reply cursors are native `AssistantInputCursor` values, preserving hosted
  mailbox source ordering so same-millisecond events cannot be skipped.
- Reply delivery ignores minimized/hashed ids if they ever appear in
  `replyTarget`.
- Mixed projected plus captureless Linq admissions preserve cleanup evidence for
  provider message ids.
- Setup channel priming no longer carries a stale inbox-list dependency.
- Hosted workspace startup and wake bootstrap no longer initialize inbox
  projection before mailbox import or assistant automation.
- Hosted conversation import stages every decoded/matched mailbox event as an
  `AssistantInputEvent` before inbox projection, including metadata-only email
  events when raw email bytes are unavailable.
- Captureless hosted email events carry a private serialized reply target so
  delivery and same-turn coalescing do not depend on inbox projection.
- Hosted email serialized reply targets are bounded before assistant input
  staging, so oversized email headers cannot block Codex admission.
- Runtime-only inbox projection ballast is removed from the greenfield
  assistant path; inbox rows are canonical projection rows only.

## Scope

- `packages/assistant-engine/src/assistant/automation/reply.ts`
- `packages/assistant-engine/src/assistant/automation/scanner.ts`
- `packages/assistant-engine/src/assistant/auto-reply-channels.ts`
- `packages/assistant-engine/src/assistant/input-store.ts`
- `packages/runtime-state/src/hosted-email.ts`
- `packages/setup-cli/src/setup-services.ts`
- `packages/setup-cli/src/setup-services/channels.ts`
- Directly coupled assistant-engine, assistant-runtime, runtime-state, and
  setup-cli tests.

## Constraints

- Do not add a new hosted-specific queue, journal, or delivery-authority
  abstraction.
- Do not re-couple Codex admission to inbox capture projection.
- Do not store or log raw provider ids outside the existing private
  `replyTarget` path.
- Preserve unrelated dirty tree work and package boundaries.

## Tasks

1. Keep active-turn same-conversation queries on stored conversation refs while
   carrying `replyTarget` only for delivery.
2. Make checkpoint-time pending acceptance application merge into the current
   context instead of replacing it with each pending snapshot.
3. Delete the auto-reply cursor conversion path; persist and scan with
   `AssistantInputCursor` directly.
4. Filter minimized/hashed ids before using `replyTarget` for delivery.
5. Add focused regressions for rapid captureless input and mixed Linq cleanup.
6. Remove stale setup inbox-list dependency and fixtures.
7. Run focused verification, required completion audits, and commit the scoped
   fix.
8. Remove remaining hosted pre-assistant inbox initialization so projection prep
   failures cannot block Codex admission.
9. Bound hosted email reply-target serialization and cover oversized header
   cases.
Completed: 2026-05-01
