Goal (incl. success criteria):
- Remove the completed hosted email reply-alias backfill maintenance surface.
- Success means the one-off GitHub workflow, internal Vercel route, and dedicated tests are gone; production is deployed without the route; and the dedicated backfill trigger secret is removed from GitHub/Vercel.

Constraints/Assumptions:
- The backfill already completed in production and a final dry-run showed zero missing aliases.
- Keep the completed backfill plan as historical evidence; do not edit completed snapshots.
- Do not remove normal hosted email signing configuration.
- Preserve unrelated active ledger rows and working-tree edits.

Key decisions:
- Delete the production mutation route rather than leaving it fail-closed but reachable.
- Delete the manual workflow because rerunning it is no longer useful after the backfill has completed.
- Delete the dedicated workflow and route tests with their deleted surfaces.

State:
- In progress.

Done:
- Confirmed the only live references are the one-off workflow, internal route, and their tests.
- Deleted the one-off workflow, internal backfill route, and route/workflow tests.
- Confirmed only the active cleanup plan and ledger mention the deleted surface outside the historical completed backfill plan.
- `pnpm typecheck` passed.
- `pnpm test:diff .github/workflows/backfill-hosted-email-reply-aliases.yml apps/web/app/api/internal/hosted-execution/email/backfill-reply-aliases/route.ts apps/web/test/hosted-execution-email-backfill-route.test.ts packages/cli/test/hosted-email-alias-backfill-workflow-guards.test.ts` passed; the web production route list no longer includes the backfill route.
- Security/privacy review found no issues. Residual operational checks are to deploy the deletion, confirm the production backfill route is not routed, then delete only `HOSTED_EMAIL_REPLY_ALIAS_BACKFILL_SECRET` from GitHub/Vercel.
- Coverage/proof review found existing proof sufficient and recommended no permanent absence test for the deleted one-off surface.
- Final completion review found no issues. Deployment order: deploy Vercel/web deletion first, confirm the route is not routed, then remove only the dedicated backfill secret from GitHub/Vercel.

Now:
- Close the plan with a scoped commit.

Next:
- Merge/deploy, confirm production route removal, and remove provider secrets.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- .github/workflows/backfill-hosted-email-reply-aliases.yml
- apps/web/app/api/internal/hosted-execution/email/backfill-reply-aliases/route.ts
- apps/web/test/hosted-execution-email-backfill-route.test.ts
- packages/cli/test/hosted-email-alias-backfill-workflow-guards.test.ts
Status: completed
Updated: 2026-06-09
Completed: 2026-06-09
