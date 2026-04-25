# Vault Sync Pairing Window

## Goal

Reduce online guessing exposure for hosted vault-sync pairing by shortening the pending session lifetime and expanding generated pairing-code entropy.

Success criteria:

- New hosted vault-sync sessions expire after 10 minutes.
- Generated pairing codes contain 10 uppercase alphanumeric characters while keeping the existing hyphenated CLI-friendly display format.
- Focused vault-sync tests cover the new TTL and code shape.

## Constraints

- Preserve the existing public exchange route behavior, one-time exchange semantics, and uniform unavailable responses.
- Do not add new persistent rate-limit state or dependencies.
- Preserve unrelated dirty work in the shared checkout, especially existing vault-sync token/payload cleanup edits.

## Plan

1. Register this plan in the coordination ledger.
2. Update vault-sync constants and generated code formatting.
3. Add focused test coverage for TTL/code shape.
4. Run focused verification and required completion reviews.
5. Close the plan and commit only if the scoped diff can be safely separated from overlapping pre-existing edits.

## Verification

- `pnpm exec vitest run apps/web/test/vault-sync-session-service.test.ts --config apps/web/vitest.workspace.ts --no-coverage` passed: 1 file, 11 tests.
- `pnpm --dir apps/web exec eslint src/lib/vault-sync/shared.ts test/vault-sync-session-service.test.ts` passed.
- `pnpm --dir apps/web typecheck:prepared` failed on pre-existing errors in `apps/web/src/lib/hosted-onboarding/linq-typing-diagnostic.ts`; no vault-sync files were reported.
- `bash scripts/workspace-verify.sh test:diff apps/web/src/lib/vault-sync/shared.ts apps/web/test/vault-sync-session-service.test.ts` cleared dependency policy, workspace boundary checks, and the hosted stale-name guard, then failed inside `apps/web verify` on unrelated existing app failures in Health Commons rendering tests, hosted retention cleanup tests, and `apps/web/src/lib/health-commons/experiment-detail-research.ts`.

## Reviews

- `security-privacy-review`: no findings. Residual platform checks are Vercel WAF confirmation, optional duplicate-exchange smoke, and real CLI pairing copy/paste verification.
- `coverage-write`: no edits needed. Existing focused proof covers generated code shape, normalized length, 10-minute TTL, and displayed agent command. The worker reran the focused vault-sync Vitest file successfully.
- `task-finish-review`: no findings. Residual gaps remain the unrelated broader `apps/web` failures and the same platform/CLI human checks.

## Status

- Complete; archived with only the exact task hunks staged, leaving overlapping pre-existing vault-sync edits unstaged.
Status: completed
Updated: 2026-04-25
Completed: 2026-04-25
