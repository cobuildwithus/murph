# Land HBOT Health Commons package

Status: completed
Created: 2026-04-24
Updated: 2026-04-24

## Goal

- Land the downloaded Hyperbaric Oxygen Therapy Health Commons package into `packages/health-commons/content` after validating the builder outputs, rights-safe source pages, artifact manifest, and repo parser/generator checks.

## Success criteria

- Builder schema report is pass and package paths are repository-internal.
- Content files for the HBOT family, starter protocol, tolerability biomarker, source pages, and artifact manifest are landed without large copyrighted source files.
- Health Commons generation and relevant repo verification have been run or any blockers are clearly attributed.
- Required finish review is complete before handoff.

## Scope

- In scope: `packages/health-commons/content/**` files produced by the HBOT page-builder package, and generated Health Commons catalog outputs only if required by verification.
- Out of scope: rerunning HBOT research seams, uploading artifacts to R2, changing app UI, changing research tooling, or editing unrelated active rows.

## Constraints

- Technical constraints: preserve current dirty tree work; commit only files touched for this landing; source pages must remain metadata/summaries only.
- Product/process constraints: keep clinical/supervised HBOT separate from home mild-HBOT claims; do not fabricate citations, sample sizes, or artifact rights.

## Risks and mitigations

1. Risk: generated package contains unsafe paths, privacy leaks, or non-source content.
   Mitigation: extract to a temporary validation directory, scan paths/content, and copy only validated package-internal files.
2. Risk: artifact rights are mixed.
   Mitigation: preserve manifest rights metadata and do not upload or mark blocked artifacts as redistributable.
3. Risk: generated catalog changes collide with other Health Commons work.
   Mitigation: inspect status and include generated outputs only if required and attributable to this landing.

## Tasks

1. Inspect builder downloads and current Health Commons content shape.
2. Validate zip paths, schema report, artifact metadata, and privacy-sensitive strings.
3. Copy validated HBOT content files into `packages/health-commons/content`.
4. Run Health Commons generation/checks and repo verification.
5. Run required finish review and create a scoped commit if safe.

## Decisions

- Use the downloaded page-builder zip as the landing source, not inline thread text.
- Keep artifact upload out of scope because the manifest includes blocked/unknown rights states.

## Verification

- Builder package validation passed: 325 package-internal Markdown/JSON files, 321 source pages, 269 artifact entries, no redistributable artifact flags, and no sensitive-string scan hits.
- `pnpm --filter @murphai/health-commons verify` passed.
- `pnpm --dir apps/web exec vitest run test/browser-vault-dashboard-pages.test.tsx --config vitest.workspace.ts --no-coverage` passed.
- `pnpm test:diff packages/health-commons/content packages/health-commons/generated apps/web/test/browser-vault-dashboard-pages.test.tsx` passed on retry. The first current-content rerun failed only on transient Google Fonts fetch errors during Next build; the retry completed Health Commons checks, apps/web dev smoke, lint, 179 test files / 1089 tests, and Next build.
- `pnpm typecheck` was attempted and failed in unrelated `packages/assistant-engine` accepted-inbound-message test/type drift; this landing does not touch those files.
- Required coverage-write audit found no extra proof needed.
- Required task-finish-review audit found no high, medium, or low findings.
Completed: 2026-04-24
