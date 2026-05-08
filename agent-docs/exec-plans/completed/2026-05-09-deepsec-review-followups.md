Goal (incl. success criteria):
- Fix concrete bugs found by the five-subagent review of commit `0de322ef6`.
- Success means email sync, automation interval validation, and device-syncd credential transitions have simple boundary-level fixes and focused verification.

Constraints/Assumptions:
- Keep #10 out of scope.
- Preserve unrelated dirty work and active ledger rows.
- Prefer one owner for each invariant; avoid new abstractions unless they remove duplicated validation.

Key decisions:
- Email sync idempotency comes from the locked state check; mailbox occurrence ids should use mutation time.
- The automation `everyMs` floor belongs to the automation contract and should be reused by core/query/runtime.
- Hosted credential-mode transitions should be accepted or rejected based on connection/token freshness, not special-case token-version equality.

State:
- Complete; ready for scoped commit/closeout.

Done:
- Spawned five review subagents and triaged findings.
- Patched email sync occurrence timestamps and lock-before-read coverage.
- Moved the automation interval floor to the automation contract and reused it in core/query.
- Updated generated automation schema and the scheduled-log schema drift required by the artifact verifier.
- Simplified device-syncd hosted credential transition freshness rules and added store regressions.
- Focused tests, touched package typechecks, contracts artifact verification, and final follow-up audit completed.

Now:
- Close the follow-up plan and commit the scoped diff.

Next:
- Discuss #10 separately with the user.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `apps/web/app/api/settings/email/sync/route.ts`
- `apps/web/test/settings-email-sync-route.test.ts`
- `packages/contracts/src/automation.ts`
- `packages/contracts/generated/frontmatter-automation.schema.json`
- `packages/contracts/generated/frontmatter-scheduled-log.schema.json`
- `packages/contracts/test/automation-memory-event-lifecycle.test.ts`
- `packages/core/src/automation.ts`
- `packages/core/test/assessment-automation-thresholds.test.ts`
- `packages/query/src/automation.ts`
- `packages/query/test/automation-memory-knowledge-coverage.test.ts`
- `packages/device-syncd/src/store/hosted-account-hydration.ts`
- `packages/device-syncd/test/store.test.ts`
- `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts --no-coverage test/settings-email-sync-route.test.ts`
- `pnpm --dir packages/contracts exec vitest run --config vitest.config.ts --no-coverage test/automation-memory-event-lifecycle.test.ts`
- `pnpm --dir packages/core exec vitest run --config vitest.config.ts --no-coverage test/assessment-automation-thresholds.test.ts`
- `pnpm --dir packages/query exec vitest run --config vitest.config.ts --no-coverage test/automation-memory-knowledge-coverage.test.ts`
- `pnpm --dir packages/device-syncd exec vitest run --config vitest.config.ts --no-coverage test/store.test.ts`
- `pnpm --dir packages/contracts test:artifacts`
- `pnpm --dir packages/contracts typecheck`
- `pnpm --dir packages/core typecheck`
- `pnpm --dir packages/query typecheck`
- `pnpm --dir packages/device-syncd typecheck`
- `pnpm --dir apps/web typecheck` (blocked by unrelated dirty `apps/web/src/testing.ts` missing `publishHostedBrowserVaultReplicaRef`)
Status: completed
Updated: 2026-05-09
Completed: 2026-05-09
