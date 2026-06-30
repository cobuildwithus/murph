# PR 295 ReviewGPT round 14 fixes

## Goal

Resolve the accepted ReviewGPT round 14 privacy finding for hosted Retell phone
calls.

Success criteria:

- Retell start succeeds only when the create-phone-call response reports
  `data_storage_setting: "basic_attributes_only"`.
- On a returned storage-mode mismatch, Murph attempts to stop the Retell call
  before throwing and does not mark the local call `calling`.
- The local env assertion remains a preflight guard, and webhook mismatch
  logging remains defense-in-depth.
- Focused web verification and typecheck pass before pushing and rerunning
  ReviewGPT.

## Constraints

- Keep Retell SDK/provider behavior isolated to `apps/web`.
- Do not add a new privacy configuration table or provider supervisor.
- Do not log raw Retell bodies or transcripts.
- Preserve unrelated active-plan and working-tree edits.

## Approach

1. Parse Retell `data_storage_setting` from the create-phone-call response.
2. Require `basic_attributes_only` before returning `providerCallId`.
3. Add a best-effort Stop Call request on mismatch.
4. Add focused Retell runtime regressions.

## State

Ready for scoped commit.

## Notes

- Retell docs expose `data_storage_setting` on create-phone-call responses and
  document `basic_attributes_only` as metadata-only storage.
- Retell docs expose `POST /v2/stop-call/{call_id}` for ongoing calls.
- Fixed by requiring the create response `data_storage_setting` to equal
  `basic_attributes_only` before returning `providerCallId`.
- On mismatch, Murph sends a best-effort Stop Call request and throws, so the
  local service marks the row failed instead of `calling`.
- Verification passed:
  `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/phone-calls-retell.test.ts apps/web/test/phone-calls-service.test.ts --no-coverage`;
  `pnpm --filter @murphai/hosted-web typecheck`;
  `git diff --check`.
Status: completed
Updated: 2026-06-25
Completed: 2026-06-25
