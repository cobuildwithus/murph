## Title

Move first-cut hosted assistant-delivery ambiguity decisions onto the portable outbox mirror.

## Goal

Reduce hosted dependence on the Cloudflare-specific assistant-delivery journal for replay and ambiguity decisions by consulting the portable assistant outbox state first where that state is already definitive.

## Scope

- `packages/assistant-runtime/src/hosted-runtime/callbacks.ts`
- `packages/assistant-runtime/src/hosted-runtime/platform.ts`
- `packages/assistant-runtime/test/hosted-runtime-callbacks.test.ts`
- `packages/assistant-engine/src/assistant/outbox.ts`
- `packages/assistant-engine/src/assistant/outbox/dispatch-state.ts`
- focused `packages/assistant-engine/test/**` only if the new portable helper needs direct coverage

## Constraints

- Keep the cut bounded; do not redesign the whole hosted journal or Cloudflare runner path here.
- Do not touch `apps/cloudflare/**`.
- Prefer hard-cut/shared-owner logic over compatibility scaffolding if safe.
- Preserve existing journal writes where they still provide hosted evidence; the goal is to shrink ownership, not to delete the journal outright in this slice.

## Intended Change

1. Add a portable assistant-outbox recovery-state reader in `assistant-engine` keyed by outbox intent id.
2. Let hosted callbacks consult that portable recovery state before deciding whether a committed delivery effect should wait, finish terminally, or resend.
3. Keep the hosted journal as a mirror/evidence lane for now, but stop making it the only owner of stale-`sending` and already-terminal replay decisions when the portable outbox mirror already knows the answer.

## Success Criteria

- Hosted callbacks can avoid a resend when the portable outbox mirror already says the effect is `sent`, `failed`, `abandoned`, or still `sending`.
- Stale non-idempotent `sending` can be derived from the portable outbox mirror without requiring a pre-existing hosted journal `sending` record.
- Focused tests cover the new mirror-driven decisions.
Status: completed
Updated: 2026-04-18
Completed: 2026-04-18
