# Current Thread Reminder Helper

## Goal

Add a simple assistant helper that creates a reminder for the current direct conversation thread by deriving the delivery route from the active session binding.

## Scope

- Add a small assistant-engine primitive for current-thread reminder creation.
- Expose it as a provider-turn bound tool.
- Pass the active session binding into provider-turn tool context.
- Nudge automation prompt guidance toward the helper for "remind/text me here" requests.
- Add focused assistant-engine coverage.
- Keep existing provider execution coverage aligned with current conversation-context injection behavior.
- Keep directly coupled CLI provider coverage aligned with current conversation-context injection behavior.

## Constraints

- Keep `deliveryTarget` intact; this task does not remove or redesign route storage.
- Do not require the model to copy raw route identifiers from context into reminder inputs.
- Keep internal `linq` naming internal and describe user-facing iMessage routes as iMessage.
- Preserve unrelated dirty work in the shared checkout.

## Verification

- Focused assistant-engine tests for the helper/catalog seams.
- Typecheck or scoped equivalent unless blocked by unrelated workspace errors.
Status: completed
Updated: 2026-04-26
Completed: 2026-04-26
