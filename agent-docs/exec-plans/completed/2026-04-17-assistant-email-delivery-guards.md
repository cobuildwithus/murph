## Goal

Tighten assistant email delivery validation so invalid thread-subject overrides and unsupported hosted participant routes fail in the shared normalization/callback path before queue or journal side effects are written.

## Scope

- `packages/assistant-engine/src/assistant/**`
- `packages/assistant-engine/test/**`
- `packages/assistant-runtime/src/{hosted-email.ts,hosted-runtime/callbacks.ts}`
- `packages/assistant-runtime/test/**`
- `packages/assistantd/**` only if request-surface proof needs adjustment
- `apps/cloudflare/src/hosted-email/transport.ts` only for defensive alignment with the shared contract

## Constraints

- Keep explicit email sends with optional subjects unchanged.
- Reject thread replies that attempt to override subject before dedupe, queue, journal, or dispatch persistence.
- Keep transport-side subject checks as defensive backstops rather than the authoritative semantic owner.
- Narrow hosted email target kinds to `explicit` and `thread` without widening the gateway enum used elsewhere.
- Preserve unrelated in-flight hosted email transport edits already present in the worktree.

## Verification

- `pnpm typecheck`
- Truthful scoped coverage for touched owners, preferring `pnpm test:diff <paths>` if it covers this slice
- Focused direct tests proving invalid thread-subject inputs fail before queue-only outbox creation and notification dispatch, and hosted participant routes fail before hosted side effects persist
Status: completed
Updated: 2026-04-17
Completed: 2026-04-17
