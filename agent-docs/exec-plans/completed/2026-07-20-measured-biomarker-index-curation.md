# Curate and redesign the measured Biomarkers index

Status: completed
Created: 2026-07-20
Updated: 2026-07-20

## Goal

- Present a calm, useful measured-biomarker index: one longitudinal entry for
  explicitly equivalent lab aliases, no report metadata or non-biomarker noise,
  device-derived metrics first, and lab areas collapsed until the member opens
  them.

## Success criteria

- Only explicitly classified measured biomarkers appear in the index. Canonical
  test rows and the private all-history lab projection remain intact, including
  rows that do not belong on this page.
- Administrative/report text, malformed value-as-analyte rows, ECG and stress
  test fields, routine urinalysis, infectious screening/culture outcomes, and
  other unclassified observations do not appear as Biomarkers.
- Proven equivalent aliases collapse into one metric identity, including BUN,
  TSH, MCH, MCHC, common CBC names, and common lipid/liver/vitamin variants.
- Nearby but distinct analytes, including BUN/creatinine ratio, MCV, absolute
  cell counts, and percentage cell counts, remain separate.
- Meaningful measured biomarkers from the supplied archive resolve into an
  explicit member-facing health area rather than a catch-all Other section.
- Device-derived metrics render before lab health areas. Each lab area is
  closed by default with an accessible native disclosure, and opened contents
  use a dense responsive notebook index rather than one endless card/list stack.
- Focused owner tests, archive-level proof, truthful diff verification, desktop
  and mobile browser proof, required specialist audits, green PR CI, and an
  exact-head ReviewGPT pass complete without unresolved accepted findings.

## Proven gap

- The supplied archive contains hundreds of projected lab rows and far more
  spelling-derived keys than the small explicit lab catalog. Every unresolved
  key is currently admitted to the Biomarkers page by default.
- That permissive fallback turns report metadata, malformed value labels,
  procedure observations, routine screening results, and valid but uncategorized
  analytes into one large Other section.
- Equivalent historical/current analyte spellings have no stable
  `biomarkerSlug`, so several real biomarkers are split into duplicate entries.
- The current page renders every lab group expanded before the device section.

## Constraints

- Keep aliasing explicit and owner-defined; do not use fuzzy medical matching.
- Preserve canonical source rows and provenance. Normalize the read projection
  through the existing health-metrics registry rather than rewriting the vault.
- Unclassified must mean hidden from this index, not deleted or declared
  clinically unimportant. Direct raw/query evidence remains available to its
  existing owners.
- Add no new persisted state, dependency, custom accordion, or UI state owner.

## Tasks

1. Extend the shared lab identity and health-area registries for the proven
   biomarker families, add explicit index-admission semantics, and cover positive
   and negative cases.
2. Filter the measured-biomarker selector at that shared classification
   boundary without narrowing the underlying private lab projection or exact
   detail selector.
3. Reorder the existing device section and render lab groups as native closed
   disclosures with a responsive notebook index and focused component coverage.
4. Record the durable measured-biomarker index contract and design pattern.
5. Run scoped verification, direct archive/browser proof, required
   `frontend-review` and `coverage-write` passes, Fable UI review, and parent
   final review.
6. Close this plan with a scoped commit, open a PR, and run CI plus ReviewGPT on
   the exact pushed head.

## Completion evidence

- The measured index now admits only exact identities in the shared health-area
  registry. The underlying browser-vault lab rows and exact detail selector are
  unchanged, so excluded report fields remain privately queryable rather than
  being deleted.
- Read-only proof against the supplied archive confirmed that representative
  real measurements enter explicit areas, known report/procedure/screening
  noise classes stay below the index, and the targeted alias families collapse.
  Temporary extracted proof material was removed after verification.
- Devices now lead the page. Lab areas use closed native disclosures and a
  compact one-to-two-column notebook surface; saved but unclassified labs are
  acknowledged without exposing their raw labels in the index.
- `packages/health-metrics` passed 63 tests and typecheck; `packages/query`
  passed 558 tests and typecheck; the three focused web files passed 29 tests
  and web typecheck; scenario integrity passed 204 scenarios.
- The broad `test:diff` lane was attempted normally and with one Vitest worker.
  Both attempts exhausted the Node 4 GB heap in the untouched
  `assistant-local-service-runtime` test. The same focused reverse-dependent
  test reproduced the same failure and 82-of-93 progress on current `main`,
  establishing that blocker as pre-existing rather than caused by this diff.
- Coverage review added the regression that keeps generic eGFR and the two
  legacy MDRD calculations distinct. Frontend review findings around stale
  unclassified rows, device-plus-unclassified state, metadata, and skeleton
  geometry were corrected; the final frontend pass reported no findings.
- The required second-model UI review was blocked by explicit usage-credit
  exhaustion, so the Codex frontend-review substitute completed. The in-app
  browser reported no available browser, leaving rendered desktop/mobile proof
  unavailable; source, accessibility structure, responsive classes, tests, and
  typecheck provide the available UI evidence.
- PR CI and the exact-pushed-head ReviewGPT gate follow the scoped plan-closing
  commit, as required by the repository workflow.

## Verification

- `pnpm test:diff packages/health-metrics/src packages/query/src/browser-replica/lab-results.ts packages/query/test/browser-vault-lab-results.test.ts apps/web/app/(dashboard)/biomarkers/biomarkers-page-client.tsx apps/web/test/lab-biomarker-history-ui.test.tsx`
- Focused Vitest while iterating.
- Read-only archive proof of before/after index counts, hidden noise classes,
  retained underlying lab rows, alias collapse, and health-area coverage.
- Desktop and mobile browser proof of closed lab areas, expansion behavior,
  responsive opened contents, and device-first ordering.
- `git diff --check`, parent final diff review, PR CI, and exact-head ReviewGPT.
Completed: 2026-07-20
