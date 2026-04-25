Goal (incl. success criteria):
- Add a production-testable hosted Linq typing diagnostic that can be triggered by sending an iMessage/Linq message after idle.
- Prove locally, with focused e2e or integration coverage, whether an ingress-side typing ping is issued before Cloudflare hosted execution handoff.

Constraints/Assumptions:
- Preserve existing runner-owned typing refresh/stop ownership; ingress typing is a one-shot diagnostic/front-runner only.
- Do not log or fixture raw phone numbers, chat ids, member ids, request ids, tokens, or local paths.
- Work in the current checkout and preserve unrelated dirty edits.
- Existing ledger rows own broader hosted typing/runtime patch lanes; keep this task narrow on webhook ingress and test proof.

Key decisions:
- UNCONFIRMED: If ingress-side typing makes production iMessage show typing after idle, the current web-to-runner handoff latency is the user-visible gap.

State:
- Implementation and local verification complete; ready for production flag test.

Done:
- Reviewed production logs from the latest cold message: runner typing started before container startup and Linq returned 204.
- Added default-off hosted Linq ingress typing diagnostic envs.
- Added one-shot ingress Linq typing ping before Cloudflare handoff for active-member conversation wakes only.
- Added focused tests for default env behavior, enabled ordering, non-blocking failure, and hosted-local e2e stub observation.
- Ran focused, app-scoped, e2e, typecheck, security/privacy, coverage, and final review passes.

Now:
- Close out the task in the shared plan/ledger flow without disturbing unrelated active rows.

Next:
- Enable `HOSTED_LINQ_INGRESS_TYPING_DIAGNOSTIC=1` in production, wait past the idle window, send an iMessage/Linq test message, and inspect logs for `hosted-onboarding.webhook.linq.ingress-typing` before Cloudflare handoff.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: Whether Linq/iMessage displays typing only when the first typing ping lands immediately after webhook receipt.

Working set (files/ids/commands):
- `apps/web/src/lib/hosted-onboarding/webhook-service.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-provider-linq*.ts`
- `apps/web/src/lib/linq/**`
- `apps/web/test/**` focused Linq webhook tests
- `apps/cloudflare/test/hosted-local-linq-*.test.ts`
Status: completed
Updated: 2026-04-25
Completed: 2026-04-25
