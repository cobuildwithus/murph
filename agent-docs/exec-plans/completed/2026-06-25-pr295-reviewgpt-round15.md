# PR 295 ReviewGPT round 15 fixes

## Goal

Resolve the accepted ReviewGPT round 15 findings for hosted Retell phone calls.

Success criteria:

- Production Retell create/stop egress always targets the fixed Retell API
  hosts, with `fetchImpl` as the only test seam.
- Retell privacy mismatch stop failures are attached to the thrown structured
  error context instead of logged through caller-local `console.warn`.
- Webhook storage-mode mismatch diagnostics use a stable structured error code.
- Focused web verification and typecheck pass before pushing and rerunning
  ReviewGPT.

## Constraints

- Do not add provider endpoint override env vars.
- Do not log raw Retell bodies, transcripts, API keys, or phone numbers.
- Keep provider-specific logic isolated in `apps/web`.
- Preserve unrelated active-plan and working-tree edits.

## Approach

1. Remove Retell endpoint env overrides and update tests to assert fixed URLs.
2. Replace best-effort stop local warnings with structured mismatch error
   details.
3. Replace storage-mode mismatch warning with stable structured code metadata.
4. Run focused verification, commit, push, and rerun ReviewGPT.

## State

Ready to finish.

## Notes

- Round 15 finding 1: `RETELL_CREATE_PHONE_CALL_URL` and
  `RETELL_STOP_CALL_URL_BASE` were test-only egress overrides in production
  code.
- Round 15 finding 2: privacy-path diagnostics used caller-local partial
  `console.warn` shapes.
- Verification passed:
  - `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/phone-calls-retell.test.ts apps/web/test/phone-calls-service.test.ts --no-coverage`
  - `pnpm --filter @murphai/hosted-web typecheck`
  - `git diff --check`
Status: completed
Updated: 2026-06-25
Completed: 2026-06-25
