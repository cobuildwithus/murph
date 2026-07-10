# Clinical Records Intake Foundation

## Goal

Land the first clean Clinical Records Intake slice from the final architecture
plan: a pure clinical-records contract package plus deterministic FHIR raw
evidence to Murph import-plan normalization. Success means later SMART/MyChart
OAuth work can fetch raw FHIR pages and feed them through this package boundary
without giving the assistant raw FHIR, tokens, or canonical write authority.

## Scope

- Add `packages/clinical-records` as a pure workspace-private package.
- Define clinical source, raw manifest, FHIR external-ref, import-plan, and
  Tier 1 candidate contracts.
- Add `packages/importers/src/clinical-records` helpers that read a stored raw
  manifest and page files, classify supported FHIR resources, emit Tier 1
  Murph import candidates for vitals, labs, report/note text, and explicit
  negative/no-known assertions, and preserve unsupported resources as raw
  evidence.
- Wire package boundaries, docs, and focused tests.

## Out Of Scope

- Provider directory tables, SMART OAuth routes, encrypted tokens, and web UI.
- Hosted runtime job orchestration and internal signed routes.
- FHIR server/database abstractions, Medplum/Aidbox/HAPI, TEFCA, or scraping.
- Tier 2/3 registry importers for conditions, allergies, medications,
  encounters, procedures, or immunizations.

## Constraints

- FHIR/MyChart data is raw evidence; Murph canonical records remain product
  truth.
- Assistant/runtime code must not see provider tokens or raw FHIR by default.
- Positive FHIR `Condition` resources must not map to `clinical_assertion`.
- Every candidate produced from one FHIR resource must use a unique
  `externalRef.facet` when it represents a distinct Murph fact.
- Keep the importer deterministic and dependency-light.

## Verification Plan

- Focused clinical-records package tests.
- Focused importers tests for classification, facets, unsupported resources,
  and no positive-condition assertion mapping.
- `pnpm typecheck`
- `pnpm test:diff <touched paths>` or the relevant package coverage lanes if
  diff-aware coverage is not truthful.

## Completion

- Use `scripts/finish-task` to close this active plan and create the scoped
  commit.
- Push branch, open PR, and run the ReviewGPT PR loop to zero accepted findings.
Status: completed
Updated: 2026-07-07
Completed: 2026-07-07
