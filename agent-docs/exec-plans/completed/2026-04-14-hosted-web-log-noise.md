# Hosted Web Log Noise

## Goal

Reduce noisy hosted-web production logs by suppressing the known SQLite experimental warning and downgrading expected transient Prisma connectivity errors from `error` to `warn`, while preserving true unexpected failures as error-level logs.

## Scope

- `apps/web/src/lib/hosted-onboarding/http.ts`
- `apps/web/src/lib/http.ts`
- `apps/web/src/lib/prisma.ts`
- `apps/web/instrumentation.ts`
- Focused hosted-web tests for warning filtering and hosted onboarding error logging

## Constraints

- Do not hide unexpected Prisma failures such as schema drift or logic bugs.
- Keep the change app-local to `apps/web`; do not broaden it into shared package logging policy.
- Preserve existing sanitization and privacy redaction behavior in logs.
- Preserve unrelated dirty worktree edits.

## Verification

- `pnpm --dir apps/web typecheck`
- Focused Vitest coverage for touched hosted-web tests

## Status

- In progress
Status: completed
Updated: 2026-04-14
Completed: 2026-04-14
