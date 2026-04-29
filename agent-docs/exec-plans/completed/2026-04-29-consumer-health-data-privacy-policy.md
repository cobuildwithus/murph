# Land Consumer Health Data Privacy Policy

Status: completed
Created: 2026-04-29
Updated: 2026-04-29

## Goal

- Land the supplied Consumer Health Data Privacy Policy update against the current hosted web checkout.
- Provide a public policy page, generated PDF output, and visible footer links from homepage/global footer surfaces.
- Reference the separate policy from the existing general Privacy Policy.

## Success Criteria

- `/legal/consumer-health-data-privacy-policy` renders the standalone policy.
- `apps/web/legal/consumer-health-data-privacy-policy.md` is the authored source for the policy.
- `apps/web/public/legal/consumer-health-data-privacy.pdf` is generated from the legal PDF script and text-readable.
- Global and homepage footer surfaces link prominently to the policy.
- The general Privacy Policy points readers to the separate policy and gives it precedence for consumer health data where applicable.

## Scope

- In scope:
  - `apps/web/legal/consumer-health-data-privacy-policy.md`
  - `apps/web/app/legal/consumer-health-data-privacy-policy/page.tsx`
  - `apps/web/public/legal/consumer-health-data-privacy.pdf`
  - `apps/web/public/legal/privacy.pdf`
  - `apps/web/scripts/generate-legal-pdfs.ts`
  - `apps/web/legal/privacy-policy.md`
  - `apps/web/app/layout.tsx`
  - `apps/web/src/components/homepage/site-footer.tsx`
  - focused `apps/web/test/**` coverage for the route and footer links
- Out of scope:
  - Broader legal copy rewrites beyond the supplied policy landing.
  - Subprocessor/vendor list changes outside policy text.
  - Auth, billing, device-sync, assistant-runtime, or Health Commons behavior changes.

## Constraints

- Treat the supplied patch as behavioral intent because parts of it do not apply cleanly to the current checkout.
- Preserve unrelated dirty work in the current checkout.
- Do not include local account, home-directory, or other direct personal identifiers in committed files or commit messages.
- Because this touches health-data privacy claims and public `apps/web` surfaces, run the required security/privacy, frontend, coverage, and final review passes before handoff.

## Verification

- Generate legal PDFs through the repo script.
- Inspect generated PDF text for the new policy title.
- Inspect regenerated general Privacy Policy PDF text for the new separate-policy reference.
- Run `git diff --check`.
- Run the highest-signal hosted-web verification available for the touched files; record any unrelated dirty-tree blockers.
- Run required completion-workflow audit passes before commit.

## Outcome

- Added the standalone consumer health data policy route, Markdown source, generated PDF, footer links, generator entry, and general Privacy Policy cross-reference.
- Added focused coverage for the new route and footer links.
- Passed `pnpm --dir apps/web legal:pdf`, `pnpm --dir apps/web lint`, `pnpm --dir apps/web typecheck`, focused hosted-web Vitest coverage, `git diff --check`, PDF text extraction checks, and direct page/PDF smoke proof.
- Required security/privacy, frontend, coverage, and task-finish review passes completed; the frontend footer wrapping finding was fixed before close.
- Broader `scripts/workspace-verify.sh test:diff` remains blocked by unrelated active Health Commons/Turbopack build failures outside this policy diff.
Completed: 2026-04-29
