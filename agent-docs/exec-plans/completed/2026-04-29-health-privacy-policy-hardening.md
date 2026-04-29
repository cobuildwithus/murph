# Harden health privacy policy commitments

## Goal

Land the requested health-privacy hardening changes while deferring the separate Consumer Health Data Privacy Policy page and homepage link for a later task.

Success criteria:

- `apps/web/legal/privacy-policy.md` reflects stronger health-data commitments, AI/model-provider restrictions, health memory treatment, retention windows, HealthKit/wearable rules, HIPAA boundary language, incident/research/law-enforcement/corporate-transfer/geofencing/local-telemetry language.
- `apps/web/legal/terms-of-service.md` stays aligned on wellness/FDA-style use and HIPAA/BAA boundaries.
- A public `/subprocessors` page exists with a provider table placeholder/current-provider list structure.
- Footer links expose the public legal/privacy/subprocessor surfaces without touching the deferred separate consumer-health-data notice.
- Legal PDFs are regenerated from the Markdown.

## Constraints

- Do not create the separate Consumer Health Data Privacy Policy page or homepage/footer link in this task.
- Treat this as product/privacy drafting, not legal advice; keep language counsel-reviewable and avoid overclaiming engineering controls beyond current repo posture.
- Preserve unrelated dirty work in the shared checkout.
- Do not expose personal identifiers in generated content, diffs, commit messages, or handoff.

## Scope

- Intended files:
  - `apps/web/legal/privacy-policy.md`
  - `apps/web/legal/terms-of-service.md`
  - `apps/web/public/legal/privacy.pdf`
  - `apps/web/public/legal/terms.pdf`
  - `apps/web/app/subprocessors/page.tsx`
  - `apps/web/src/components/homepage/site-footer.tsx`
  - `apps/web/app/layout.tsx`
  - directly coupled tests

## Verification

- Passed: `pnpm --dir apps/web legal:pdf`.
- Passed: focused Vitest suite for touched layout/homepage/metadata surfaces.
- Passed: `pnpm --dir apps/web typecheck`.
- Passed: direct ESLint over touched app/test files.
- Passed: `git diff --check` over touched files.
- Passed: personal-identifier scan over touched text files and generated PDFs.
- Failed for unrelated active-lane app-test drift: `bash scripts/workspace-verify.sh test:diff ...` passed dependency, boundary, stale-name, raw-log, app lint, and app build checks, then failed in broad `apps/web verify` Vitest suites for Health Commons experiment rendering, `HostedAuthPanel`, and `StudyCard` expectations outside this legal/subprocessors diff.

## State

- Implemented.
- Security/privacy and frontend review findings were handled by tightening configurable-provider language, softening operational retention/security claims to auditable targets, and adding accessible table semantics.
- Terms hardening change pack was applied after the first implementation pass, including wellness-only, AI Actions, no-monitoring, platform-health-data, self-hosting, copyright, acceptable-use, arbitration, California notice, liability, indemnity, and contact cleanup language.
- Awaiting post-Terms verification, final finish review, and scoped commit.
Status: completed
Updated: 2026-04-29
Completed: 2026-04-29
