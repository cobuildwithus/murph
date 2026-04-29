---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:eur-lex-regulation-2023-915-citrinin-red-yeast-rice-2023-04-25"
slug: "sources/red-yeast-rice/eur-lex-regulation-2023-915-citrinin-red-yeast-rice-2023-04-25"
title: "Commission Regulation (EU) 2023/915 of 25 April 2023 on maximum levels for certain contaminants in food"
summary: "EU contaminants regulation carrying the maximum citrinin limit for food supplements based on rice fermented with red yeast Monascus purpureus."
status: "draft"
quality: "usable"
aliases:
  - "EU 2023 contaminants regulation for citrinin in red yeast rice supplements"
categories:
  - "red-yeast-rice"
  - "regulatory"
  - "safety"
relations:

  -
    type: "related_protocol"
    target: "protocol_variant:red-yeast-rice/red-yeast-rice-for-cholesterol"
  -
    type: "parent_family"
    target: "experiment_family:red-yeast-rice"
source:
  kind: "guideline"
  title: "Commission Regulation (EU) 2023/915 of 25 April 2023 on maximum levels for certain contaminants in food"
  authors: "European Commission"
  year: 2023
  journal: "Official Journal of the European Union"
  citation: "European Commission. Commission Regulation (EU) 2023/915 of 25 April 2023 on maximum levels for certain contaminants in food. Official Journal of the European Union. 2023."
  url: "https://eur-lex.europa.eu/eli/reg/2023/915/oj/eng"
sourceIdentity:
  identityKind: "guideline"
  canonicalIdBasis: "url"
  identifiers:
    titleHash: "4e635267739dc288133df62166bd050a5c313b8beacff6ab89258a02b123e5c8"
    url: "https://eur-lex.europa.eu/eli/reg/2023/915/oj/eng"
  canonicalUrl: "https://eur-lex.europa.eu/eli/reg/2023/915/oj/eng"
researchEvidence:
  designKind: "guideline"
  designLabel: "Regulation / contaminant limit"
  populationLabel: "Food supplements based on rice fermented with red yeast Monascus purpureus."
  durationLabel: "Not applicable"
  aggregateRole: "primary"
  cohortKey: "eur-lex-regulation-2023-915-citrinin-red-yeast-rice-2023-04-25"
evidenceBucket: "Regulatory and jurisdiction warnings"
whyItMatters: "Provides the current EU contaminant-limit context that should be attached to red yeast rice product-quality review."
potentialMurphEndpoints:
  - "citrinin certificate of analysis"
  - "kidney symptoms"
  - "product batch/lot"
protocolTakeaway: "Use as safety context for product selection; do not use as evidence of cholesterol benefit."
murphTakeaway: "Citrinin status is a required sourcing/safety covariate in any red yeast rice experiment."
studyDesign: "Regulation / contaminant limit"
modality: "Red yeast rice regulatory, product-quality, or safety context"
claimUse: "safety-only"
sourceFindings:

  -
    findingKind: "safety"
    population: "EU red-yeast-rice food supplements"
    exposure: "Citrinin in rice fermented with red yeast Monascus purpureus"
    outcome: "Maximum contaminant level"
    summary: "Regulation (EU) 2023/915 lists food supplements based on rice fermented with red yeast Monascus purpureus under citrinin with a maximum level of 100 µg/kg."
    evidenceUse:
      - "safety"
      - "context"
    findingId: "finding:eur-lex-regulation-2023-915-citrinin-red-yeast-rice-2023-04-25-citrinin-100-ug-kg"
    sourceKey: "source_artifact:eur-lex-regulation-2023-915-citrinin-red-yeast-rice-2023-04-25"
    extractedFromArtifactId: "art_eur_lex_regulation_2023_915_citrinin_red_yeast_rice_2023_04_25_pdf"
murphV1Priority: "High"
pdfRightsStatus: "open_access"
artifacts:

  -
    artifactId: "art_eur_lex_regulation_2023_915_citrinin_red_yeast_rice_2023_04_25_pdf"
    sourceKey: "source_artifact:eur-lex-regulation-2023-915-citrinin-red-yeast-rice-2023-04-25"
    kind: "pdf"
    storage: "external"
    sourceUrl: "https://eur-lex.europa.eu/eli/reg/2023/915/oj/eng"
    rightsStatus: "open_access"
    redistributable: false
    accessNotes: "External source artifact candidate only; copyrighted or externally hosted materials were not stored in Git during this extraction."
extractedEvidence:
  population: "Food supplements based on rice fermented with red yeast Monascus purpureus."
  interventionOrExposure: "Citrinin contamination."
  comparatorOrControl: "None"
  durationOrFollowUp: "Not applicable"
  endpoints:
    - "citrinin contamination"
    - "product-quality compliance"
  effectEstimatesOrDirection: "Lists food supplements based on rice fermented with red yeast Monascus purpureus with a maximum citrinin level of 100 µg/kg."
  adverseEventsOrSafetyNotes: "Citrinin is treated as a contaminant with kidney-safety relevance."
  limitations: "Regulatory contaminant listing; no direct clinical cholesterol or adverse-event estimate."
  populationMismatch: "Regulatory, product-quality, or safety context; not a Murph self-experiment cohort."
  directnessToProtocol: "general_guideline"
---
This source is included for **Regulatory and jurisdiction warnings**.

**Findings:** EU contaminants regulation carrying the maximum citrinin limit for food supplements based on rice fermented with red yeast Monascus purpureus.

**Why it matters:** Provides the current EU contaminant-limit context that should be attached to red yeast rice product-quality review.

**Potential experiment signals:** citrinin certificate of analysis, kidney symptoms, product batch/lot.

**Protocol takeaway:** Use as safety context for product selection; do not use as evidence of cholesterol benefit.

**Claim use:** `safety-only`.
