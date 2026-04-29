# Privacy Policy Final Adjustments

Status: completed
Created: 2026-04-29
Updated: 2026-04-29

## Goal

- Land the remaining privacy, terms, consumer-health notice, subprocessor, and HTML policy-surface adjustments from the latest review notes.
- Explicitly skip the analytics relocation request because the user wants to keep Vercel Analytics.

## Success Criteria

- Privacy Section 17 points to the separate Consumer Health Data Privacy Policy instead of duplicating the supplemental notice.
- Terms and Privacy have no general-purpose health-data model-training consent escape hatch.
- Privacy text tightens product-improvement, consent-screen, HealthKit, telemetry, retention, changed-practices, and breach language.
- Separate Consumer Health Data Privacy Policy includes consumer-health request/appeal timing and regulator-contact handoff language.
- Subprocessor page wording is affirmative for model/search providers and accurate for Cloudflare execution/storage surfaces.
- HTML policy routes exist for `/legal/privacy`, `/legal/terms`, `/consumer-health-data-privacy-policy`, and `/subprocessors`, with PDFs retained.
- Focused tests cover the new legal-copy and route-surface invariants.

## Scope

- In scope:
  - `apps/web/legal/{privacy-policy,terms-of-service,consumer-health-data-privacy-policy}.md`
  - `apps/web/public/legal/{privacy,terms,consumer-health-data-privacy}.pdf`
  - `apps/web/app/**` legal/privacy/subprocessor route surfaces
  - `apps/web/src/components/homepage/site-footer.tsx` and `apps/web/app/layout.tsx` only if the footer links are missing or need copy alignment
  - `apps/web/README.md` implementation checklist note for Health Connect publication surfaces
  - focused hosted-web tests for legal copy and route metadata/links
- Out of scope:
  - Moving, removing, or narrowing Vercel Analytics / Speed Insights.
  - Rewriting homepage causality claims.
  - Broad runtime, auth, billing, or hosted execution changes.

## Constraints

- Preserve unrelated dirty work in the shared checkout.
- Do not include local account, home-directory, or direct personal identifiers in files or commits.
- Do not weaken existing stronger privacy commitments while applying the requested drafting updates.

## Verification

- `pnpm --dir apps/web legal:pdf` passed.
- Focused hosted-web Vitest for page/layout/consumer-health/legal-copy/legal-html/route-metadata coverage passed: 6 files, 16 tests.
- `pnpm --dir apps/web lint` passed.
- `pnpm --dir apps/web typecheck` passed.
- Scoped `git diff --check` passed.
- Stale legal-string scan, text identifier scan, PDF identifier scan, and PDF text extraction passed.
- Required security/privacy and frontend reviews flagged appeal-timing and duplicate-canonical follow-ups; both were fixed.
- Coverage review reported no extra test changes needed.
- Task-finish review flagged ordered-list rendering in the shared legal markdown renderer; fixed and rerun verification passed.
- Final task-finish recheck found no remaining issues.
- Broader `scripts/workspace-verify.sh test:diff ...` remains blocked by unrelated Health Commons/web issues outside this legal diff.
Completed: 2026-04-29
