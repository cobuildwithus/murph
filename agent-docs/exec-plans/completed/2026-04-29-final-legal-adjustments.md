# Final Legal Adjustments

Status: completed
Created: 2026-04-29
Updated: 2026-04-29

## Goal

- Land the remaining legal/copy adjustments from the provided review notes, excluding the legal-PDF build change and homepage causality rewrite the user explicitly asked to leave alone.
- Keep the public legal documents, generated PDFs, and focused tests aligned.

## Success Criteria

- Public FAQ copy no longer names a specific model in protocol-generation claims.
- Terms align with the stronger Privacy Policy posture on health-data model training and no health-data sale/adtech/data-broker use.
- Privacy Policy includes the requested legally required health-breach-notification framing.
- Existing Consumer Health Data Privacy Policy page and homepage/footer link remain intact.
- Legal PDFs are regenerated from the updated Markdown sources.

## Scope

- In scope:
  - `apps/web/src/components/homepage/faq-section.tsx`
  - `apps/web/legal/{terms-of-service,privacy-policy,consumer-health-data-privacy-policy}.md`
  - `apps/web/public/legal/{terms,privacy,consumer-health-data-privacy}.pdf`
  - focused `apps/web/test/**` assertions where needed
- Out of scope:
  - Adding `legal:pdf` to the build script.
  - Rewriting homepage causality/headline/metadata claims.
  - Broad legal restructuring beyond the supplied patch-note items.
  - Auth, billing, hosted runtime, Health Commons, or Cloudflare behavior changes.

## Constraints

- Preserve unrelated dirty work in the shared checkout.
- Do not include local account, home-directory, or direct personal identifiers in files or commits.
- Avoid introducing new legal/product promises beyond the supplied drafting notes and current repo posture.

## Verification

- Passed: `pnpm --dir apps/web legal:pdf`.
- Passed: `pnpm --dir apps/web exec eslint src/components/homepage/faq-section.tsx test/page.test.ts test/consumer-health-data-privacy-policy.test.ts test/legal-policy-copy.test.ts`.
- Passed: `pnpm exec vitest run --config apps/web/vitest.workspace.ts --project hosted-web-store-config apps/web/test/page.test.ts apps/web/test/layout.test.ts apps/web/test/consumer-health-data-privacy-policy.test.ts apps/web/test/legal-policy-copy.test.ts --no-coverage`.
- Passed: `git diff --check` on the scoped files.
- Passed: PDF text extraction for the updated Terms, Privacy Policy, and Consumer Health Data Privacy Policy promises.
- Passed: scoped identifier scans for local account/home-directory leakage.
- Blocked: full `pnpm --dir apps/web lint` and `pnpm --dir apps/web typecheck` fail on unrelated current app JSX/type issues outside this task.
- Blocked: `scripts/workspace-verify.sh test:diff ...` fails on unrelated current app/Health Commons build issues outside this task.
Completed: 2026-04-29
