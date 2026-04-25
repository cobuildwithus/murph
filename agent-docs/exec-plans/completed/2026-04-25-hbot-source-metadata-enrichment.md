# Enrich HBOT source metadata for experiment research display

Status: completed
Created: 2026-04-25
Updated: 2026-04-25

## Goal

- Run a Pro-backed enrichment pass for the Hyperbaric Oxygen Therapy Health Commons source corpus so the experiment page can display verified publication years and `n=` badges where the source artifacts explicitly support them.

## Success criteria

- HBOT cited research sources gain verified `source.year` metadata when the publication or guideline year is explicit.
- HBOT study-level source pages gain `researchEvidence.participantCount` only when the count is directly supported by the source artifact, extraction output, abstract metadata, or an equivalent explicit record.
- Guideline, registry, adjacent-variant, and safety-boundary sources stay conservative: add years when supported, but do not invent sample sizes or outcome details.
- The generated experiment-detail research projection reports a non-empty HBOT years-covered range and renders `n=` chips for supported study cards.
- Verification covers the Health Commons content parser/projection and catches stale generated catalog output.

## Scope

- In scope:
  - `packages/health-commons/content/sources/hyperbaric-oxygen-therapy/**`
  - Directly coupled HBOT protocol/family content only if needed to keep source citations coherent
  - `output-packages/research/hyperbaric-oxygen-therapy-20260423-093246Z/**`
  - `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
  - This active plan
- Out of scope:
  - Changing HBOT efficacy claims, protocol dose defaults, safety recommendations, or modality boundaries
  - Importing evidence from mild/soft-chamber HBOT, topical oxygen, EWOT, or normobaric oxygen into systemic clinical HBOT claims
  - Broad UI changes outside the existing research metadata projection
  - Committing regenerated `packages/health-commons/generated/**` artifacts for this content-only enrichment unless a later repo instruction explicitly requires it

## Constraints

- Preserve unrelated dirty-tree work and active Health Commons research rows.
- Keep the older HBOT charter row separate; this lane is source-metadata enrichment and content landing only.
- Do not infer sample size, effect size, adverse-event rate, population, or duration from a title, PMID, DOI, or source key alone.
- For reviews and meta-analyses, add participant counts only when an explicit pooled or included-participant count is available; prefer no `participantCount` over a weak aggregate guess.
- Retain source caveats where metadata is still incomplete.

## Tasks

1. [x] Register the enrichment lane in the active plan and coordination ledger.
2. [x] Prepare a Pro enrichment prompt and research-run seam from the existing HBOT workspace.
3. [x] Send the Pro pass and harvest the returned artifact.
4. [x] Apply only verified metadata updates to HBOT source pages.
5. [x] Regenerate and verify the Health Commons projection.
6. [x] Run required completion checks and create or hand off a scoped landing.

## Verification

- Pro enrichment/review seams were sent and harvested; the returned Pro review artifact did not add usable source-level JSON beyond confirming the candidate packet was loaded, so the applied metadata came from existing HBOT extraction batches plus conservative local review.
- `pnpm --dir packages/health-commons generate` passed after the metadata update.
- Local generated-catalog audit: cited HBOT counted research sources now have 120/120 years, 56 cited research sources with participant counts, 27 primary direct counted cohorts totaling 2,347 participants, no duplicate cohort keys among counted `n=` records, and a years-covered range of 1978-2026.
- Local source-dir audit: 297/321 HBOT source pages now carry `source.year`; 95 source pages carry explicit person-level `participantCount` after removing non-person-unit counts.
- `pnpm --dir packages/health-commons verify` passed after the final aggregate-role and cohort-key fixes.
- Required security/privacy and task-finish review passes completed; follow-up findings on non-person-unit counts, synthesis over-counting, and duplicate cohort keys were fixed before final verification.
Completed: 2026-04-25
