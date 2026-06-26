# PR 295 ReviewGPT round 18 fixes

## Goal

Resolve the accepted ReviewGPT round 18 findings for hosted Retell phone calls.

Success criteria:

- Duplicate request-key replays do not leave stale unstarted phone-call rows in
  `starting` forever.
- Retell final analysis text is normalized into the stored result bounds instead
  of making terminal webhook handling fail forever.
- Focused phone-call tests and hosted web typecheck pass before pushing and
  rerunning ReviewGPT.

## Constraints

- Do not add phone-call attempt tables, provider-event framework, or supervisor.
- Preserve idempotency: duplicate replays must not double-start Retell.
- Keep provider text bounded without storing transcripts or raw analysis blobs.
- Preserve unrelated active-plan and working-tree edits.

## Approach

1. Treat duplicate unstarted `starting/providerCallId=null` rows as active only
   for a short freshness window; stale rows transition to failed and return
   `failed`.
2. Clamp Retell `result` and `follow_up` fields before schema parsing, with a
   short truncation marker.
3. Add regressions for stale unstarted replay and oversized analysis text.
4. Run focused verification, commit, push, and rerun ReviewGPT.

## State

Ready to finish.

## Notes

- Round 18 finding 1: duplicate request-key rows created before provider start
  can replay forever as `starting` without a real Retell call.
- Round 18 finding 2: oversized provider analysis text can fail schema parsing
  before `analyzedAt` and result notification are persisted.
- Verification passed:
  - `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/phone-calls-service.test.ts apps/web/test/phone-calls-retell.test.ts --no-coverage`
  - `pnpm --filter @murphai/hosted-web typecheck`
  - `git diff --check`
Status: completed
Updated: 2026-06-25
Completed: 2026-06-25
