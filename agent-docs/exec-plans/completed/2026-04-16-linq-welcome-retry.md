Goal (incl. success criteria):
- Stop repeated Linq first-contact welcome sends after a successful materialized send hits a later failure path.
- Success means retries reconcile the existing delivery state instead of creating a fresh participant-targeted Linq chat and resending the same intro.

Constraints/Assumptions:
- Keep the Telegram and iMessage members separate; that is not the target of this fix.
- Do not change the `[DEV]` prompt behavior in this lane.
- Preserve unrelated worktree edits.

Key decisions:
- Focus on the first-contact Linq materialization retry path in `packages/assistant-engine`.
- Treat the post-send failure gap as the likely source of repeated welcomes because the existing test suite currently preserves a participant-targeted intent after that failure.

State:
- completed

Done:
- Confirmed the repeated intro text is the exact first-contact welcome constant.
- Confirmed phone member identity/routing is stable and separate from Telegram.
- Confirmed hosted bundles include assistant sessions and first-contact state.
- Confirmed the existing outbox test encodes the risky behavior: a materialized Linq first-contact persist failure leaves the session/intent effectively participant-targeted.
- Persisted the resolved Linq chat binding and pending delivery state before later session-save hooks can fail.
- Added a hosted-style regression and a hookless local regression proving retries reconcile without another `sendLinq` call.
- Passed targeted Vitest, package coverage, and package typecheck for `packages/assistant-engine`.

Now:
- None.

Next:
- Monitor production for any remaining repeat-intro signals outside this retry path.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: whether the repeated intro in production is exclusively this retry path or also involves a first-turn check-in state mismatch on inbound Linq captures.

Working set (files/ids/commands):
- `packages/assistant-engine/src/assistant/outbox.ts`
- `packages/assistant-engine/test/assistant-outbox-runtime.test.ts`
- `pnpm exec vitest run packages/assistant-engine/test/assistant-outbox-runtime.test.ts --no-coverage`
Status: completed
Updated: 2026-04-16
Completed: 2026-04-16
