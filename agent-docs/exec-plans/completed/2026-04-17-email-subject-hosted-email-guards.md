## Goal (incl. success criteria)

Land the smallest fixes for the email-subject wake-task findings that still reproduce in the current tree: thread email subject overrides must fail in the shared assistant layer before queue-only persistence, and hosted email participant routes must be rejected before hosted delivery side effects are committed.

## Constraints / Assumptions

- Keep the scope limited to the confirmed invariant breaks from the watched ChatGPT thread.
- Do not widen ordinary AgentMail explicit-send behavior or generic hosted side-effect contracts beyond what the hosted email boundary requires.
- Preserve unrelated worktree state.

## Key decisions

- Make the shared assistant subject normalizer authoritative for thread-subject rejection instead of silently dropping invalid subjects.
- Narrow only the hosted email request contract to `explicit | thread`; do not change the broader gateway delivery target enum.
- Reject hosted email participant routes while building committed hosted delivery effects so unsupported hosted email sends fail before side-effect persistence.

## State

- in_progress

## Done

- Confirmed the watched thread export has no downloadable artifact in its latest request/response pair.
- Verified the current tree still silently drops email thread subjects in the shared assistant layer.
- Verified hosted email parsing still accepts `participant`, while the Cloudflare transport rejects it later.

## Now

- Implement the two invariant fixes and update focused tests.

## Next

- Run required verification for the touched owners and complete the repo finish flow.

## Open questions

- None currently.

## Working set (files / ids / commands)

- `packages/assistant-engine/src/assistant/channels/helpers.ts`
- `packages/assistant-runtime/src/hosted-email.ts`
- `packages/assistant-runtime/src/hosted-runtime/callbacks.ts`
- `packages/assistant-engine/test/assistant-outbox-runtime.test.ts`
- `packages/assistant-engine/test/email-subject.test.ts`
- `packages/assistant-runtime/test/hosted-email.test.ts`
- `packages/assistant-runtime/test/hosted-runtime-callbacks.test.ts`
Status: completed
Updated: 2026-04-17
Completed: 2026-04-17
