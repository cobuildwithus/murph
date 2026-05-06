# Export Omit Runtime Logs

## Goal

Remove hosted runtime log rows from the user data export while preserving live deletion coverage for the `HostedRuntimeLog` store.

Success means `buildHostedDataExport` no longer queries or serializes runtime logs, tests prove that runtime logs are omitted from the export bundle, and the hosted data export documentation matches the new contract.

## Constraints

- Runtime logs remain live-deleted by account deletion.
- Do not expose raw identifiers, local paths, secrets, or runtime payloads in docs, tests, commit text, or handoff.
- Preserve unrelated working-tree edits and active coordination rows.

## Current State

- `buildHostedDataExport` omits runtime log queries, runtime-log counts, row-limit metadata, and diagnostics output.
- The public export docs describe runtime logs as live-deleted but not exported.

## Work

1. Remove runtime log query/result serialization from hosted data export. Done.
2. Update tests and docs to reflect omission from export. Done.
3. Run focused hosted privacy verification plus typecheck as required. Done.
4. Run required privacy/security and completion reviews, then commit through `scripts/finish-task`.

## Verification

- `pnpm --dir apps/web test hosted-account-data-service.test.ts` passed.
- `pnpm --dir apps/web typecheck` passed.
- `pnpm --dir apps/web lint` passed.
- `git diff --check -- apps/web/src/lib/hosted-privacy/account-data-service.ts apps/web/test/hosted-account-data-service.test.ts docs/hosted-account-data-deletion-export.md agent-docs/exec-plans/active/2026-05-07-export-omit-runtime-logs.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md` passed.
- `bash scripts/workspace-verify.sh test:diff apps/web/src/lib/hosted-privacy/account-data-service.ts apps/web/test/hosted-account-data-service.test.ts docs/hosted-account-data-deletion-export.md agent-docs/exec-plans/active/2026-05-07-export-omit-runtime-logs.md` was blocked by an unrelated raw-payload log guard finding outside this task's files.
Status: completed
Updated: 2026-05-07
Completed: 2026-05-07
