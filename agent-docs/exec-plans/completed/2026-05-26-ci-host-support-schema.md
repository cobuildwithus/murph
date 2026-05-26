Goal (incl. success criteria):
- Fix remaining failure from GitHub Actions run 26475342203 on current `main`.
- Success means the CLI package-shape schema freshness guard passes and the already-landed app webhook-trace mock fix is confirmed locally.

Constraints/Assumptions:
- Preserve unrelated dirty edits in `apps/web/src/lib/device-sync/wake-service.ts` and `packages/device-syncd/src/public-ingress.ts`.
- Do not expose local paths, account names, secrets, raw credentials, or full authorization headers in repo files or final notes.
- Failed run head was `ea7dd0a`; local `main` is newer and already includes the app-side `$queryRaw` test mock fix.

Key decisions:
- Regenerate the existing committed CLI `config.schema.json` artifact rather than hand-editing it.
- Treat the app verification failure as already addressed unless the focused app test still fails on current `main`.

State:
- Implemented and verified; awaiting final completion review and scoped commit.

Done:
- Inspected failing Actions run logs.
- Reproduced the current CLI package-shape failure locally.
- Confirmed newer commits after the failed run changed `apps/web/test/prisma-store-device-sync-signal.test.ts` to mock `$queryRaw`.
- Regenerated `packages/cli/config.schema.json` with `pnpm --dir packages/cli gen:config-schema`.
- Verified `pnpm exec tsx packages/cli/scripts/verify-package-shape.ts` passes.
- Verified focused app regression with `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/prisma-store-device-sync-signal.test.ts`.
- Verified `pnpm typecheck`.
- Verified scoped CLI lane with `bash scripts/workspace-verify.sh test:diff packages/cli/config.schema.json`.
- Completed coverage-write audit with no requested file changes.

Now:
- Run final completion review.

Next:
- Close the active plan and create the scoped commit.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- Run: `https://github.com/cobuildwithus/murph/actions/runs/26475342203`
- Plan: `agent-docs/exec-plans/active/2026-05-26-ci-host-support-schema.md`
- Expected generated file: `packages/cli/config.schema.json`
- Focused commands: `pnpm --dir packages/cli gen:config-schema`, `pnpm exec tsx packages/cli/scripts/verify-package-shape.ts`, app focused Vitest test.
Status: completed
Updated: 2026-05-26
Completed: 2026-05-26
