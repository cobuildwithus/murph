# Remove Hosted Member Reset Admin Route

Created: 2026-06-05

## Goal

Remove the temporary hosted member reset admin surface now that the production
reset pass is complete.

Success criteria:

- `/api/internal/admin/hosted-member-reset` no longer exists.
- The `admin:reset-member` package script no longer exists.
- The reset script and reset-only tests/smoke are removed.
- No live code, test, config, or doc references remain outside immutable completed
  plan snapshots.

## Scope

Delete the reset-only implementation and verification surfaces:

- `apps/web/app/api/internal/admin/hosted-member-reset/route.ts`
- `apps/web/scripts/reset-hosted-member-runtime.ts`
- `apps/web/test/hosted-member-reset-admin-route.test.ts`
- `apps/web/test/reset-hosted-member-runtime-script.test.ts`
- `apps/cloudflare/test/hosted-local-member-reset-smoke-e2e.test.ts`
- `packages/hosted-local-harness/src/e2e.ts`
- `packages/hosted-local-harness/test/hosted-local.test.ts`
- `docs/hosted-account-hard-reset-migration-guide.md`
- `apps/web/package.json` script entry

Do not edit historical completed execution-plan snapshots.

## Verification Plan

- Search for remaining live references.
- Run `pnpm typecheck`.
- Run `bash scripts/workspace-verify.sh test:diff <changed paths>`.
- Run `git diff --check` for the touched files.

## Audit Plan

This touches an internal admin route and trust-boundary surface, so run:

- `security-privacy-review`
- `coverage-write`
- `task-finish-review`

## State

Implementation removed the reset route, script, command alias, and reset-only
tests. Live-reference search only finds this active plan and the coordination
ledger row.

Initial verification passed:

- `git diff --check -- apps/web/package.json apps/web/app/api/internal/admin/hosted-member-reset/route.ts apps/web/scripts/reset-hosted-member-runtime.ts apps/web/test/hosted-member-reset-admin-route.test.ts apps/web/test/reset-hosted-member-runtime-script.test.ts apps/cloudflare/test/hosted-local-member-reset-smoke-e2e.test.ts agent-docs/exec-plans/active/2026-06-05-remove-hosted-member-reset-admin.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- live reference search excluding completed plan snapshots and this active
  plan/ledger
- deleted-path and removed package-script direct checks
- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff apps/web/package.json apps/web/app/api/internal/admin/hosted-member-reset/route.ts apps/web/scripts/reset-hosted-member-runtime.ts apps/web/test/hosted-member-reset-admin-route.test.ts apps/web/test/reset-hosted-member-runtime-script.test.ts apps/cloudflare/test/hosted-local-member-reset-smoke-e2e.test.ts agent-docs/exec-plans/active/2026-06-05-remove-hosted-member-reset-admin.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`

Direct proof: the Next build route list no longer included
`/api/internal/admin/hosted-member-reset`.

Security/privacy and coverage-write review found and fixed one stale
hosted-local scenario registration for `member-reset-smoke`. Added a generic
hosted-local harness test that every registered scenario file exists.

Rerun verification passed before final review:

- focused `packages/hosted-local-harness` hosted-local test
- `git diff --check -- apps/web/package.json apps/web/app/api/internal/admin/hosted-member-reset/route.ts apps/web/scripts/reset-hosted-member-runtime.ts apps/web/test/hosted-member-reset-admin-route.test.ts apps/web/test/reset-hosted-member-runtime-script.test.ts apps/cloudflare/test/hosted-local-member-reset-smoke-e2e.test.ts packages/hosted-local-harness/src/e2e.ts packages/hosted-local-harness/test/hosted-local.test.ts agent-docs/exec-plans/active/2026-06-05-remove-hosted-member-reset-admin.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- live reference search excluding completed plan snapshots and this active
  plan/ledger
- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff apps/web/package.json apps/web/app/api/internal/admin/hosted-member-reset/route.ts apps/web/scripts/reset-hosted-member-runtime.ts apps/web/test/hosted-member-reset-admin-route.test.ts apps/web/test/reset-hosted-member-runtime-script.test.ts apps/cloudflare/test/hosted-local-member-reset-smoke-e2e.test.ts packages/hosted-local-harness/src/e2e.ts packages/hosted-local-harness/test/hosted-local.test.ts agent-docs/exec-plans/active/2026-06-05-remove-hosted-member-reset-admin.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`

Final review found and fixed two low issues:

- deleted obsolete `docs/hosted-account-hard-reset-migration-guide.md`
- updated this plan state before archive

Final post-doc-deletion checks passed:

- live reference search excluding completed plan snapshots and this active
  plan/ledger
- deleted-path direct checks
- `git diff --check -- apps/web/package.json apps/web/app/api/internal/admin/hosted-member-reset/route.ts apps/web/scripts/reset-hosted-member-runtime.ts apps/web/test/hosted-member-reset-admin-route.test.ts apps/web/test/reset-hosted-member-runtime-script.test.ts apps/cloudflare/test/hosted-local-member-reset-smoke-e2e.test.ts packages/hosted-local-harness/src/e2e.ts packages/hosted-local-harness/test/hosted-local.test.ts docs/hosted-account-hard-reset-migration-guide.md agent-docs/exec-plans/active/2026-06-05-remove-hosted-member-reset-admin.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `pnpm typecheck`

All required audits are complete. Ready for `finish-task`.
Status: completed
Updated: 2026-06-05
Completed: 2026-06-05
