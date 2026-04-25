# Hosted web retention cleanup

Status: completed
Created: 2026-04-25
Updated: 2026-04-25

## Goal

- Enforce hosted-web retention for encrypted share and vault-sync payloads plus stale hosted execution operational rows.

## Success criteria

- Expired hosted share payloads are deleted by scheduled cleanup instead of only by status-page reads.
- Hosted vault-sync encrypted payloads are deleted after successful run commit/finalization status import.
- Scheduled cleanup deletes expired vault-sync sessions/payloads, stale ingress payload/event rows, and old hosted run logs.
- Focused tests prove the DB/job-level cleanup behavior.

## Scope

- `apps/web/src/lib/hosted-retention/**` or equivalent hosted-web cleanup owner.
- `apps/web/app/api/internal/hosted-execution/retention/cron/route.ts`
- `apps/web/vercel.json`
- `apps/web/src/lib/vault-sync/session-service.ts`
- directly coupled hosted-web tests.

## Constraints

- Do not change Cloudflare retention behavior; that is tracked by the active Cloudflare-only retention row.
- Do not log encrypted payload ciphertexts, raw payloads, user ids, contact identifiers, or local paths.
- Preserve web-owned hosted run, ingress, and vault-sync authority boundaries.
- Keep cleanup idempotent and safe to retry.

## Risks and mitigations

1. Risk: Deleting pending ingress or active run rows could break replay/recovery.
   Mitigation: cleanup deletes terminal rows, and quarantines only the oldest contiguous stale pending prefix per user while advancing the locked cursor.
2. Risk: Deleting vault-sync payload too early could prevent a successful import.
   Mitigation: delete after the committed run summary marks a reported vault-sync session committed or committed with conflicts.
3. Risk: The shared dirty ledger blocks a scoped commit.
   Mitigation: keep touched source/test files narrow and close the plan explicitly if commit helpers cannot stage only this lane.

## Tasks

1. Register this plan in the coordination ledger.
2. Trace current share, vault-sync, ingress, run-log schemas and deletion paths.
3. Implement idempotent retention cleanup and the protected cron route.
4. Delete vault-sync payloads after successful import status update.
5. Add focused tests for payload deletion and cleanup cutoffs.
6. Run verification, required audits, and close/commit if safe.

## Verification

- passed: focused hosted-web Vitest for retention cleanup, retention cron route, vault-sync session service, vault-sync payload route, and hosted share payload route.
- passed: `bash scripts/workspace-verify.sh test:diff <touched paths>` for the hosted retention/vault-sync diff; full `apps/web verify` completed.
- passed: `pnpm typecheck`.
- passed: `pnpm --dir apps/web lint` with existing warning-only findings.
- passed: `git diff --check` for touched files.
- completed: required `security-privacy-review`, `coverage-write`, and `task-finish-review` passes.
Completed: 2026-04-25
