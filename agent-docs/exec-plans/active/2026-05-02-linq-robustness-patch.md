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
- in_progress

Done:
- Read required repo workflow, architecture, product, security, reliability, verification, testing, and Pro patch-landing docs.
- Confirmed the supplied patch does not apply cleanly to the current checkout.

Now:
- Port the supplied patch intent onto the current files.

Next:
- Run focused hosted-web tests, typecheck/verification, required audits, then close the plan and commit if exact staging stays safe.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-service.ts`
- `apps/web/test/hosted-onboarding-linq-dispatch.test.ts`
- `git apply --check <supplied-patch>` failed because current target hunks have drifted.
