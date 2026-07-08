Goal (incl. success criteria):
- Remove the onboarding-invites, onboarding-activation, and pulse-trial-reset tools from the internal /ops surface: dashboard pages, client components, API routes, their ops-only lib modules, and their tests.
- Keep the runtime-latency and runtime-maintenance ops pages fully working, along with the shared ops access gate.
- Success means the ops index lists only the two kept tools, no dangling imports or links remain, and typecheck plus the apps/web verification lane pass.

Constraints/Assumptions:
- Delete only ops-page-only machinery under `apps/web/src/lib/hosted-ops/`; do not touch the shared production modules the deleted code called (`hosted-onboarding/*` billing, invite, trial-enrollment, Linq, identity services, `hosted-runtime-latency/*`, prisma, lib/http).
- No Prisma models or migrations are involved; the deleted code only read/wrote shared production tables through kept services.
- Keep `hosted-ops/access.ts` (`requireHostedOpsPageAccess`, `requireHostedOpsRequestAccess`) untouched; it gates the kept pages and routes.
- Preserve unrelated ledger rows and active lanes; no registered lane owns the ops surface.

Key decisions:
- Straight deletion, no deprecation shims or feature flags: these are internal operator tools, and the production onboarding/trial flows have their own non-ops routes.
- Update the ops index `OPS_TOOLS` array and header copy in place rather than restructuring the page.

State:
- In progress.

Done:
- Mapped the full removal surface repo-wide; confirmed no cron, worker, CLI, or schema usage; identified the one README block referencing a removed tool.
- Deleted the sixteen feature files, trimmed the ops index `OPS_TOOLS` list and header copy, removed the README repair-surface block; repo-wide grep shows no stale references.

Now:
- Run `pnpm typecheck` and `pnpm verify:acceptance` (fresh worktree needed workspace package builds first).

Next:
- Finish via `scripts/finish-task`, push, open the PR, then run the ReviewGPT loop.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- apps/web/app/(dashboard)/ops/{onboarding-activation,onboarding-invites,pulse-trial-reset}/**
- apps/web/app/api/ops/{onboarding-activation,onboarding-invites,pulse-trial-reset}/route.ts
- apps/web/src/lib/hosted-ops/{onboarding-activation,onboarding-invites,pulse-trial-reset}.ts
- apps/web/test/hosted-ops-onboarding-activation.test.ts, apps/web/test/hosted-ops-onboarding-invites.test.ts, apps/web/test/hosted-ops-pulse-trial-reset.test.ts, apps/web/test/hosted-pulse-trial-reset.test.ts
- apps/web/app/(dashboard)/ops/page.tsx, apps/web/README.md
- pnpm typecheck
- pnpm verify:acceptance
Status: completed
Updated: 2026-07-02
Completed: 2026-07-02
