Goal (incl. success criteria):
- Simplify hosted conversation inbox projection to one-shot best-effort after mailbox import checkpoint.
- Remove hosted retry scheduling ambiguity so projection `pending`/`failed` remains diagnostic enrichment state unless a real durable executor exists.

Constraints/Assumptions:
- Preserve assistant input admission and hosted mailbox checkpoint semantics.
- Do not add durable payload duplication or a new maintenance drain.
- Preserve unrelated dirty work in the active checkout.

Key decisions:
- Use the recommended greenfield shape: no hosted projection retry queue or due-time executor.
- Keep `projection.status` values for visibility and prompt/search enrichment state.

State:
- Completed. Scoped commit was not created because the touched files overlap
  other active dirty rows in the shared checkout.

Done:
- Read repo routing, architecture, security, reliability, hosted runtime protocol, verification, and coordination docs.
- Located the hosted projection retry surface.
- Removed hosted projection retry scheduling from the mailbox import path.
- Removed `nextAttemptAfter` from projection update/storage shape while
  preserving legacy read compatibility by stripping that key at parse time.
- Updated hosted runtime docs and hosted assistant input planning docs to state
  one-shot best-effort projection semantics.
- Focused tests, docs drift, diff hygiene, security/privacy review,
  coverage-write review, and task-finish review completed.

Now:
- None.

Next:
- Resolve overlapping active-row findings separately before committing this
  checkout as a whole.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `packages/assistant-runtime/src/hosted-runtime/mailbox-conversation-import.ts`
- `packages/assistant-runtime/test/hosted-runtime-mailbox-conversation-import.test.ts`
- `packages/assistant-engine/src/assistant/input-store.ts`
- `packages/assistant-engine/test/assistant-input-store.test.ts`
- `packages/assistant-runtime/README.md`
- `agent-docs/references/hosted-runtime-protocol.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
Status: completed
Updated: 2026-05-01
Completed: 2026-05-01
