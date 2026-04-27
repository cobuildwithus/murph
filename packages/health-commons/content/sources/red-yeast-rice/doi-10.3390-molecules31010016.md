---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:doi-10.3390-molecules31010016"
slug: "sources/red-yeast-rice/doi-10.3390-molecules31010016"
title: "Determination of monacolin K and citrinin in the presence of other active ingredients found in selected food supplements by HPLC-DAD"
summary: "Analytical method source for determining monacolin K and citrinin in selected food supplements despite other active ingredients."
status: "draft"
quality: "usable"
aliases:
  - "Hubicka U 2026: Determination of monacolin K and citrinin in the presence of other active ingredients found in selected food supplements by HPLC-DAD"
  - "DOI 10.3390/molecules31010016"
  - "PMCID PMC12786744"
  - "Determination of monacolin K and citrinin in the presence of other active ingredients found in selected food supplements by HPLC-DAD"
categories:
  - "red-yeast-rice"
  - "product-quality"
  - "contamination"
  - "dose-uncertainty"
relations:
  -
    type: "related_protocol"
    target: "protocol_variant:red-yeast-rice/red-yeast-rice-for-cholesterol"
  -
    type: "parent_family"
    target: "experiment_family:red-yeast-rice"
source:
  kind: "journal_article"
  title: "Determination of monacolin K and citrinin in the presence of other active ingredients found in selected food supplements by HPLC-DAD"
  authors: "Hubicka U; Żuromska-Witek B; Szlósarczyk M; Sołtys E; Rusak M; Gacal I"
  year: 2026
  journal: "Molecules"
  citation: "Hubicka U; Żuromska-Witek B; Szlósarczyk M; Sołtys E; Rusak M; Gacal I. Determination of monacolin K and citrinin in the presence of other active ingredients found in selected food supplements by HPLC-DAD. Molecules. 2026. doi:10.3390/molecules31010016."
  doi: "10.3390/molecules31010016"
  url: "https://doi.org/10.3390/molecules31010016"
sourceIdentity:
  identityKind: "scholarly_work"
  canonicalIdBasis: "doi"
  identifiers:
    doi: "10.3390/molecules31010016"
    titleHash: "9debceefc8e4dc2714f1ed3ee8c867da46773a5fa3ee24e663bb059317216c10"
    url: "https://doi.org/10.3390/molecules31010016"
  canonicalUrl: "https://doi.org/10.3390/molecules31010016"
researchEvidence:
  designKind: "other"
  designLabel: "HPLC-DAD analytical method"
  populationLabel: "Selected food supplements containing red yeast rice or related active ingredients; no human participants"
  durationLabel: "Single laboratory method-development/validation context"
  aggregateRole: "primary"
  cohortKey: "doi-10-3390-molecules31010016"
evidenceBucket: "Product quality, contamination, and dose uncertainty"
whyItMatters: "Supports the feasibility of product testing when RYR is combined with other nutraceuticals."
potentialMurphEndpoints:
  - "monacolin K measurement"
  - "citrinin measurement"
  - "method performance in multi-ingredient supplements"
protocolTakeaway: "Use as measurement-context evidence for QC requirements, not as clinical efficacy evidence."
murphTakeaway: "Use as measurement-context evidence for QC requirements, not as clinical efficacy evidence. It should shape product selection, monitoring, dose fidelity, or safety context without being treated as direct LDL-C efficacy evidence."
studyDesign: "HPLC-DAD analytical method"
modality: "Red yeast rice supplement quality/safety context"
claimUse: "safety-only"
sourceFindings:
  -
    findingId: "finding:doi-10-3390-molecules31010016:batch-003-primary"
    sourceKey: "source_artifact:doi-10.3390-molecules31010016"
    findingKind: "measurement_validation"
    population: "Selected food supplements containing red yeast rice or related active ingredients; no human participants"
    exposure: "Analytical determination of monacolin K and citrinin in selected food supplements"
    outcome: "monacolin K measurement; citrinin measurement; method performance in multi-ingredient supplements"
    summary: "Method-development source for determining monacolin K and citrinin in the presence of other supplement ingredients; no prevalence or lipid-response estimate extracted."
    evidenceUse:
      - "measurement"
      - "safety"
murphV1Priority: "Medium"
pdfRightsStatus: "open_access"
---
This source is included for **Product quality, contamination, and dose uncertainty**.

**Findings:** Analytical method source for determining monacolin K and citrinin in selected food supplements despite other active ingredients.

**Extracted details:**

- **Population / sample:** Selected food supplements containing red yeast rice or related active ingredients; no human participants
- **Intervention or exposure:** Analytical determination of monacolin K and citrinin in selected food supplements
- **Comparator / control:** No clinical comparator
- **Duration / follow-up:** Single laboratory method-development/validation context
- **Endpoints:** monacolin K measurement; citrinin measurement; method performance in multi-ingredient supplements
- **Effect estimates or direction:** Method-development source for determining monacolin K and citrinin in the presence of other supplement ingredients; no prevalence or lipid-response estimate extracted.
- **Adverse events or safety notes:** Enables product-quality verification for both active statin-like compound and citrinin contaminant.
- **Limitations:** Method and selected-supplement context; not a representative market survey unless sample frame is separately documented.
- **Population mismatch:** No human outcomes.
- **Directness:** measurement_context for the same product family

**Why it matters:** Supports the feasibility of product testing when RYR is combined with other nutraceuticals.

**Potential experiment signals:** monacolin K measurement; citrinin measurement; method performance in multi-ingredient supplements

**Protocol takeaway:** Use as measurement-context evidence for QC requirements, not as clinical efficacy evidence.

**Claim use:** `safety-only`.
