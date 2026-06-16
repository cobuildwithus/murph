Goal (incl. success criteria):
- Fix PR 183 ReviewGPT round 15 high finding: stale idempotent sending rows from an older prepared batch must use the normal stale-idempotent retry path when the current drain does not own a prepared dispatch token.

Constraints/Assumptions:
- Keep the architecture simple: prepared sending is scoped to the existing per-effect prepared dispatch token.
- Preserve existing prepared-batch CAS/reset behavior for effects this drain actually owns.
- Run focused tests, typecheck, and diff-based verification before committing.

Key decisions:
- Derive prepared-sending ownership per effect in the hosted drain loop.
- Pass prepared mode into delivery only when `allowPreparedSending`, `preparedAt`, and a matching `preparedDispatch` are all present.

State:
- Verification passed; ready to commit and rerun ReviewGPT.

Done:
- ReviewGPT round 15 identified the stale idempotent ownership gap.
- Scoped prepared sending per effect to owned prepared dispatch tokens.
- Added hosted-runtime regression coverage for stale idempotent retry without prepared ownership.
- Focused hosted-runtime tests passed.
- `pnpm typecheck` passed.
- `pnpm test:diff packages/assistant-runtime/src/hosted-runtime/callbacks.ts packages/assistant-runtime/test/hosted-runtime-callbacks.test.ts` passed.
- `git diff --check` passed.

Now:
- Commit and push the round 15 fix.

Next:
- Run ReviewGPT round 16.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `packages/assistant-runtime/src/hosted-runtime/callbacks.ts`
- `packages/assistant-runtime/test/hosted-runtime-callbacks.test.ts`
Status: completed
Updated: 2026-06-16
Completed: 2026-06-16
