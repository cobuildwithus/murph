# WHOOP Reconcile Diagnostics

## Goal

Fix scheduled device-sync jobs so successful provider results that omit `nextReconcileAt` preserve the scheduler-owned future reconcile cursor, and add redacted diagnostics that make WHOOP token/API failures actionable without logging provider payloads, tokens, account ids, or request bodies.

Diagnose live WHOOP out-of-sync state with production database inspection, Cloudflare observability, and Vercel API/CLI evidence before fixing.

## Scope

- `packages/device-syncd/src/service.ts`
- `packages/device-syncd/src/types.ts`
- `packages/device-syncd/src/hosted-runtime.ts`
- `packages/device-syncd/src/providers/shared-oauth.ts`
- `packages/device-syncd/src/providers/whoop.ts`
- focused `packages/device-syncd` tests
- `packages/assistant-runtime/src/hosted-runtime/maintenance.ts`
- hosted runtime failure-log diagnostics tests

## Constraints

- Keep the fix small and provider-agnostic.
- Diagnostics must stay metadata-only: status, retryability, account-status classification, and safe reason codes only.
- Do not persist or log provider response bodies, tokens, headers, URLs with query secrets, raw account ids, or health payloads.
- Preserve unrelated dirty worktree edits.

## Findings

- Production database inspection shows all WHOOP dirty rows have `dirty_revision = processed_revision`; dirty recovery is not blocked.
- Production database inspection shows repeated `reconcile_due` signals for two healthy WHOOP connections while their `next_reconcile_at` remains stuck in early May after fresh successful syncs.
- Hosted database/log inspection shows two active WHOOP attention rows: one `WHOOP_TOKEN_REQUEST_FAILED`, one `SYNC_JOB_FAILED` with `fetch failed`; existing logs do not include provider HTTP/OAuth details or transport cause details.
- Cloudflare observability shows the hosted worker and runtime wake path were active during the incident window; this is not a dead cron/runtime-wake issue.
- Vercel API/CLI confirmed the web project deployment and cron config; queried deployment runtime logs did not add a more specific device-sync error than the DB-hosted runtime logs.

## Verification

- Focused device-syncd tests for reconcile cursor preservation and redacted failure diagnostics.
- Focused hosted-runtime maintenance tests for durable device-sync failure-log diagnostics.
- Package coverage for `packages/device-syncd` and `packages/assistant-runtime`.
- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff <changed-files>` or the package-local coverage lane if diff coverage is not truthful.
Status: completed
Updated: 2026-05-19
Completed: 2026-05-19
