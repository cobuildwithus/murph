# Snapshot Start Attempt Correlation

Status: active
Created: 2026-08-26
Updated: 2026-08-26

## Goal

- Correlate the existing slow or failed workspace-snapshot start diagnostics
  with the existing runtime checkpoint attempt identifier.
- Preserve the current metadata-only logging, timing thresholds, checkpoint
  behavior, and privacy boundary.

## Constraints

- Reuse the existing Cloudflare structured-log path and canonical
  `workspaceAttemptId` vocabulary.
- Add no logging service, database write, metric pipeline, retry, timeout,
  queue, scheduler, or persisted state.
- Keep unauthorized requests uncorrelated because they have no validated write
  fence.

## Plan

1. Carry the validated write-fence attempt identifier into the existing route
   diagnostic and the parsed session attempt identifier into the existing
   session-owner diagnostic.
2. Add focused route and Durable Object tests proving both diagnostic scopes
   carry the same attempt identifier without exposing snapshot or user data.
3. Run focused Cloudflare tests and typecheck, inspect the final diff and
   privacy boundary, then complete the repository PR review and CI workflow.

## Verification

- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts
  --no-coverage apps/cloudflare/test/runner-outbound.test.ts
  apps/cloudflare/test/user-runner-alarm.test.ts` — passed (372 tests).
- `pnpm --dir apps/cloudflare typecheck` — passed.
- `git diff --check` — passed.
