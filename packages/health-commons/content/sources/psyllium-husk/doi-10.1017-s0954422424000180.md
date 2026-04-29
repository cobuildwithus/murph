---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:doi-10.1017-s0954422424000180"
slug: "sources/psyllium-husk/doi-10.1017-s0954422424000180"
title: "Nutrition and health effects of pectin: a systematic scoping review of human intervention studies"
summary: "Recent pectin scoping review useful for soluble-fiber formulation, structure, viscosity, and safety context, not direct psyllium evidence."
status: "draft"
quality: "usable"
aliases:
  - "doi-10.1017-s0954422424000180"
categories:
  - "psyllium-husk"
relations:

  -
    type: "related_protocol"
    target: "protocol_variant:psyllium-husk/psyllium-husk-for-cholesterol"
  -
    type: "parent_family"
    target: "experiment_family:psyllium-husk"
source:
  kind: "review"
  title: "Nutrition and health effects of pectin: a systematic scoping review of human intervention studies"
  authors: "Annika M. Weber, Nélida Pascale, Fangjie Gu, Elizabeth P. Ryan, Frederique Respondek"
  year: 2024
  journal: "Nutrition Research Reviews"
  citation: "Annika M. Weber, Nélida Pascale, Fangjie Gu, Elizabeth P. Ryan, Frederique Respondek. Nutrition and health effects of pectin: a systematic scoping review of human intervention studies. Nutrition Research Reviews. 2024. doi:10.1017/S0954422424000180."
  doi: "10.1017/S0954422424000180"
  url: "https://doi.org/10.1017/S0954422424000180"
sourceIdentity:
  identityKind: "scholarly_work"
  canonicalIdBasis: "doi"
  identifiers:
    doi: "10.1017/S0954422424000180"
    url: "https://doi.org/10.1017/S0954422424000180"
  canonicalUrl: "https://doi.org/10.1017/S0954422424000180"
researchEvidence:
  designKind: "systematic_review"
  designLabel: "Systematic scoping review of human pectin intervention studies"
  includedStudyCount: 134
  populationLabel: "Human intervention studies of pectin across health and metabolic outcomes"
  durationLabel: "Single-intake studies to 168 days"
  aggregateRole: "synthesis"
  cohortKey: "doi-10-1017-s0954422424000180"
evidenceBucket: "Mechanism: viscosity, bile-acid, sterol, and fecal-excretion context"
whyItMatters: "Prevents overgeneralizing soluble-fiber mechanisms across chemically distinct fibers."
potentialMurphEndpoints:
  - "fiber dose and formulation"
  - "viscosity or gel properties"
  - "cholesterol and fat-metabolism context"
  - "GI tolerability"
protocolTakeaway: "Use as adjacent soluble-fiber context only; it should not support direct psyllium cholesterol claims."
murphTakeaway: "Helpful for wording that physicochemical properties matter and that pectin evidence should stay separated from psyllium evidence."
studyDesign: "Systematic scoping review of human pectin intervention studies"
modality: "Adjacent soluble fiber: pectin"
claimUse: "context-only"
sourceFindings:

  -
    findingId: "finding:doi-10.1017-s0954422424000180-structure-heterogeneity"
    sourceKey: "source_artifact:doi-10.1017-s0954422424000180"
    extractedFromArtifactId: "art_doi_10_1017_s0954422424000180_source"
    findingKind: "context"
    population: "Human pectin intervention studies"
    exposure: "Pectin from varied sources and formulations"
    outcome: "Dose, structure, viscosity, gel formation, and health endpoints"
    summary: "The review summarized 134 human intervention studies and emphasized wide variation in pectin dose, molecular structure, viscosity, gel formation, and study outcomes."
    evidenceUse:
      - "adjacent_variant"
      - "context"
      - "mechanism"
  -
    findingId: "finding:doi-10.1017-s0954422424000180-safety-context"
    sourceKey: "source_artifact:doi-10.1017-s0954422424000180"
    extractedFromArtifactId: "art_doi_10_1017_s0954422424000180_source"
    findingKind: "safety"
    population: "Participants in human pectin intervention studies"
    exposure: "Pectin interventions up to 50 g/day and durations up to 168 days in the review map"
    outcome: "Tolerability and adverse effects"
    summary: "The scoping review described generally tolerable pectin interventions, with mild gastrointestinal symptoms such as flatulence or bloating reported in some studies; this remains adjacent-fiber safety context rather than psyllium safety evidence."
    evidenceUse:
      - "adjacent_variant"
      - "safety"
      - "context"
murphV1Priority: "Medium"
pdfRightsStatus: "open_access"
---
This source is included for **Mechanism: viscosity, bile-acid, sterol, and fecal-excretion context**.

## Quick read

- **Source type:** Systematic scoping review of human pectin intervention studies (2024).
- **People studied or addressed:** Human intervention studies of pectin across health and metabolic outcomes.
- **Intervention or exposure:** Pectin interventions, doses 0.1–50 g/day across diverse formulations.
- **Comparator or control:** Varied comparators across included intervention studies.
- **Duration or follow-up:** Single-intake studies to 168 days.
- **Endpoints:** Fat metabolism, cholesterol, triglycerides, absorption/excretion, bile-acid metabolism, glycemic and appetite outcomes, tolerability.
- **Directness:** adjacent_variant.
- **Claim use:** `context-only`.

## Findings

- The review summarized 134 human intervention studies and emphasized wide variation in pectin dose, molecular structure, viscosity, gel formation, and study outcomes.
- The scoping review described generally tolerable pectin interventions, with mild gastrointestinal symptoms such as flatulence or bloating reported in some studies; this remains adjacent-fiber safety context rather than psyllium safety evidence.

## Why it matters

Prevents overgeneralizing soluble-fiber mechanisms across chemically distinct fibers.

## Potential experiment signals

- fiber dose and formulation
- viscosity or gel properties
- cholesterol and fat-metabolism context
- GI tolerability

## Protocol takeaway

Use as adjacent soluble-fiber context only; it should not support direct psyllium cholesterol claims.

## Safety and adverse events

Reported pectin was generally tolerated; mild gastrointestinal symptoms such as flatulence or bloating were noted in some studies; no adverse side effects were reported in the highest-dose and longest-duration examples summarized by the review.

## Limitations and population fit

Adjacent soluble-fiber variant; pectin structure and food matrix differ from psyllium; scoping reviews are not direct efficacy estimates for this protocol.

**Population mismatch:** Pectin is not psyllium and should not be used to infer direct LDL-C effects for psyllium husk.

## Artifact and rights notes

- **Candidate artifact id:** `art_doi_10_1017_s0954422424000180_source`
- **PDF rights status:** `open_access`
- Copyrighted PDFs should not be stored in Git; use metadata/link-only candidates unless redistribution rights are confirmed.
