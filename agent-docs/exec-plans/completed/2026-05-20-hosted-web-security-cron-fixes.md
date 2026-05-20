# Hosted web security and cron Clawpatch fixes

Status: completed
Created: 2026-05-20
Updated: 2026-05-19

## Goal

- Fix three hosted web Clawpatch findings:
  - unsafe install command on the security page,
  - malformed workflow webhook token escaping route error handling,
  - dirty sweeper cron reporting success when dirty wake append fails.

## Success Criteria

- Security page uses the same safe hosted install command shape as the homepage.
- Malformed workflow webhook tokens return a controlled 400 response instead of
  throwing outside route handling.
- Dirty sweeper cron fails or reports failure when dirty wake append failures are
  present.
- Focused tests and Clawpatch revalidation confirm all three findings are fixed.

## Scope

- In scope:
  - `apps/web/app/security/page.tsx`
  - `apps/web/middleware.ts`
  - `apps/web/app/api/internal/device-sync/dirty-sweeper/cron/route.ts`
  - Focused tests for those surfaces.
- Out of scope:
  - Reworking unrelated workflow generated artifacts.
  - Patching third-party Workflow package code.
  - Changing device-sync dirty sweep semantics beyond failure reporting.
  - Fixing unrelated active checkout changes.

## Constraints

- Preserve unrelated dirty work.
- Do not expose secrets, local paths, raw auth headers, or private payloads in
  tests, docs, logs, or error messages.

## Verification

- Passed:
  - Focused Vitest for the security page, dirty-sweeper cron route, and workflow
    webhook middleware tests.
  - Scoped ESLint for touched files.
  - `pnpm --dir apps/web typecheck`.
  - `pnpm --dir apps/web lint` with only pre-existing warnings outside this
    task's files.
  - `git diff --check` on touched files.
  - Clawpatch revalidated all three targeted findings as fixed under the
    `.codex-3` profile.
  - Required security/privacy, frontend, and final completion audit passes ran;
    low follow-up proof/UX items were addressed.
Completed: 2026-05-19
