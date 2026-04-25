Goal (incl. success criteria):
- Change hosted member vault bootstrap fallback timezone from `UTC` to `America/New_York` when signup did not provide a valid timezone.
- Keep user-provided validated IANA timezone behavior unchanged.

Constraints/Assumptions:
- This is a narrow follow-up to the completed hosted signup timezone path.
- No new persisted state is needed.
- Preserve unrelated dirty work in the shared checkout.

Key decisions:
- Use the IANA timezone `America/New_York` for the no-hint fallback.

State:
- Implemented; focused verification passed.

Done:
- Read required repo workflow docs for this code change.
- Changed hosted member vault bootstrap no-timezone fallback to `America/New_York`.
- Kept explicit signup timezone hints authoritative, including explicit `UTC`.
- Updated focused hosted runtime coverage for both missing-hint fallback and explicit hint preservation.
- Verification passed:
  - `pnpm test:diff packages/assistant-runtime/src/hosted-runtime/context.ts packages/assistant-runtime/test/hosted-runtime-context.test.ts packages/assistant-runtime/test/hosted-runtime-context-coverage.test.ts`
  - `pnpm --filter @murphai/assistant-runtime exec vitest run --config vitest.config.ts --no-coverage test/hosted-runtime-context.test.ts`
  - `pnpm --filter @murphai/assistant-runtime run typecheck`
  - `git diff --check -- packages/assistant-runtime/src/hosted-runtime/context.ts packages/assistant-runtime/test/hosted-runtime-context.test.ts agent-docs/exec-plans/active/2026-04-26-hosted-timezone-default-nyc.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- Required completion passes completed:
  - security/privacy review: no findings.
  - coverage-write: added explicit UTC preservation test.
  - task-finish review: no code findings; requested this plan update before archival.

Now:
- Close the plan and commit the scoped follow-up.

Next:
- None.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `packages/assistant-runtime/src/hosted-runtime/context.ts`
- `packages/assistant-runtime/test/hosted-runtime-context.test.ts`
- `packages/assistant-runtime/test/hosted-runtime-context-coverage.test.ts`
Status: completed
Updated: 2026-04-26
Completed: 2026-04-26
