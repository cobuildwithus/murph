# Linq Robustness Patch Landing

Goal (incl. success criteria):
- Land the supplied Linq robustness patch intent on the current checkout.
- Preserve active-member Linq message text even when attachment descriptors come first or the inbound part count is high.
- Stop rejecting signup-link and redirect side-effect flows solely because inbound Linq parts are oversized.
- Send the optional Linq read receipt only when the hosted wake handoff starts successfully.
- Keep hosted webhook ingress privacy and external-surface behavior fail-closed where the current architecture requires it.

Constraints/Assumptions:
- Preserve unrelated dirty work and active ledger rows.
- Treat this as high-risk hosted webhook/external ingress work.
- Do not print, fixture, or persist secrets, raw identifiers, raw request bodies, or local machine paths.
- The supplied patch is stale against this checkout, so port behavior manually and keep the write scope narrow.

Key decisions:
- Keep the current pointer-workflow wake architecture; gate the read receipt on the synchronous wake-start signal available to the webhook route.
- Do not add new persisted state.

State:
- focused_verified

Done:
- Read required repo workflow, architecture, product, security, reliability, verification, testing, and Pro patch-landing docs.
- Confirmed the supplied patch does not apply cleanly to the current checkout.
- Ported the supplied patch intent onto current hosted Linq webhook code.
- Added focused webhook-boundary tests for old part-cap text preservation, attachment descriptors before text, link preservation during truncation, signup-link and redirect side-effect oversize handling, read-receipt skip on wake-start failure, and signed attachment URL omission.
- Completed security/privacy review with no findings.
- Completed coverage-write review; it added the link-preservation proof.
- Completed final task review with no findings.

Now:
- Close this plan and create the scoped completion commit.

Next:
- None after scoped commit.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-service.ts`
- `apps/web/test/hosted-onboarding-linq-dispatch.test.ts`
- `git apply --check <supplied-patch>` failed because current target hunks have drifted.
- `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-onboarding-linq-dispatch.test.ts` passed with 36 tests.
- `pnpm --dir apps/web exec eslint src/lib/hosted-onboarding/webhook-provider-linq.ts src/lib/hosted-onboarding/webhook-service.ts test/hosted-onboarding-linq-dispatch.test.ts` passed.
- `pnpm --dir apps/web exec eslint test/hosted-onboarding-linq-dispatch.test.ts` passed after the coverage-write proof addition.
- `pnpm typecheck` failed on unrelated `packages/health-metrics` export drift before reaching `apps/web`.
- `pnpm --dir apps/web exec tsc -p tsconfig.json --pretty false` failed on unrelated browser-vault/metric-row drift in biomarker/query files.
- `bash scripts/workspace-verify.sh test:diff apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts apps/web/src/lib/hosted-onboarding/webhook-service.ts apps/web/test/hosted-onboarding-linq-dispatch.test.ts` reached `apps/web verify`; app lint passed but the full app test/build lane failed on unrelated hosted-legal-consent, browser-vault, experiment-detail, biomarker, and homepage assertions.
Status: completed
Updated: 2026-05-02
Completed: 2026-05-02
