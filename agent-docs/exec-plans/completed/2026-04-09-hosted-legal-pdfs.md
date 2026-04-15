# Hosted Legal PDFs

## Goal

Replace the hosted terms and privacy links in `apps/web` with the provided Murph legal drafts, serve them from the hosted web app as PDF assets, and keep the checkout green.

## Scope

- `apps/web/public/**` for hosted PDF assets
- `apps/web/app/**` for any hosted legal routes or redirects
- `apps/web/src/components/hosted-onboarding/**` for legal-link wiring
- `apps/web/test/**` for targeted assertions
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`

## Constraints

- Use the user-provided terms and privacy Markdown as the source content.
- Do not publish the revision-notes draft unless a concrete route is required.
- Keep the hosted/local product split and existing onboarding/billing/legal link semantics intact.
- Finish with targeted hosted-web verification, a required review pass, and a scoped commit.

## Verification

- `pnpm --dir apps/web test`
- `pnpm --dir apps/web lint`
- Add any narrower direct proof needed for the new legal asset paths.
Status: completed
Updated: 2026-04-09
Completed: 2026-04-09
