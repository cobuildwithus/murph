---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:doi-10.17590-20200205-121500"
slug: "sources/red-yeast-rice/doi-10.17590-20200205-121500"
title: "A questionable way to lower cholesterol: food supplements containing red yeast rice to be taken only on medical advice"
summary: "German risk-assessment opinion warning that RYR supplements may have serious safety concerns and variable monacolin K exposure."
status: "draft"
quality: "usable"
aliases:
  - "German Federal Institute for Risk Assessment (BfR) 2020: A questionable way to lower cholesterol: food supplements containing red yeast rice to be taken only on medical advice"
  - "DOI 10.17590/20200205-121500"
  - "A questionable way to lower cholesterol: food supplements containing red yeast rice to be taken only on medical advice"
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
  kind: "guideline"
  title: "A questionable way to lower cholesterol: food supplements containing red yeast rice to be taken only on medical advice"
  authors: "German Federal Institute for Risk Assessment (BfR)"
  year: 2020
  journal: "BfR Opinion No. 003/2020"
  citation: "German Federal Institute for Risk Assessment (BfR). A questionable way to lower cholesterol: food supplements containing red yeast rice to be taken only on medical advice. BfR Opinion No. 003/2020. 2020. doi:10.17590/20200205-121500."
  doi: "10.17590/20200205-121500"
  url: "https://www.bfr.bund.de/cm/349/a-questionable-way-to-lower-cholesterol-food-supplements-containing-red-yeast-rice-to-be-taken-only-on-medical-advice.pdf"
sourceIdentity:
  identityKind: "guideline"
  canonicalIdBasis: "doi"
  identifiers:
    doi: "10.17590/20200205-121500"
    titleHash: "b563216b3b68a97f0b56711578b7dfb27fdec885ed74c407d2d89a0990e0ff09"
    url: "https://www.bfr.bund.de/cm/349/a-questionable-way-to-lower-cholesterol-food-supplements-containing-red-yeast-rice-to-be-taken-only-on-medical-advice.pdf"
  canonicalUrl: "https://www.bfr.bund.de/cm/349/a-questionable-way-to-lower-cholesterol-food-supplements-containing-red-yeast-rice-to-be-taken-only-on-medical-advice.pdf"
researchEvidence:
  designKind: "guideline"
  designLabel: "Risk-assessment opinion"
  populationLabel: "General consumers of red yeast rice food supplements"
  durationLabel: "Risk-assessment opinion; no follow-up"
  aggregateRole: "primary"
  cohortKey: "doi-10-17590-20200205-121500"
evidenceBucket: "Product quality, contamination, and dose uncertainty"
whyItMatters: "Strong implementation boundary: unsupervised product use conflicts with a major European risk-assessment opinion."
potentialMurphEndpoints:
  - "medical supervision advice"
  - "monacolin K variability"
  - "lovastatin-like adverse effects"
  - "citrinin safety limit context"
protocolTakeaway: "Use as a high-priority medical-supervision and product-variability safety boundary."
murphTakeaway: "Use as a high-priority medical-supervision and product-variability safety boundary. It should shape product selection, monitoring, dose fidelity, or safety context without being treated as direct LDL-C efficacy evidence."
studyDesign: "Risk-assessment opinion"
modality: "Red yeast rice supplement quality/safety context"
claimUse: "safety-only"
sourceFindings:

  -
    findingId: "finding:doi-10-17590-20200205-121500:batch-003-primary"
    sourceKey: "source_artifact:doi-10.17590-20200205-121500"
    findingKind: "safety"
    population: "General consumers of red yeast rice food supplements"
    exposure: "Food supplements containing red yeast rice / monacolin K"
    outcome: "medical supervision advice; monacolin K variability; lovastatin-like adverse effects; citrinin safety limit context"
    summary: "BfR did not recommend consumption of RYR food supplements due to serious safety questions and advised medical supervision/consultation if used; no lipid-effect estimate."
    evidenceUse:
      - "context"
      - "safety"
murphV1Priority: "High"
pdfRightsStatus: "open_access"
---
This source is included for **Product quality, contamination, and dose uncertainty**.

**Findings:** German risk-assessment opinion warning that RYR supplements may have serious safety concerns and variable monacolin K exposure.

**Extracted details:**

- **Population / sample:** General consumers of red yeast rice food supplements
- **Intervention or exposure:** Food supplements containing red yeast rice / monacolin K
- **Comparator / control:** No comparator
- **Duration / follow-up:** Risk-assessment opinion; no follow-up
- **Endpoints:** medical supervision advice; monacolin K variability; lovastatin-like adverse effects; citrinin safety limit context
- **Effect estimates or direction:** BfR did not recommend consumption of RYR food supplements due to serious safety questions and advised medical supervision/consultation if used; no lipid-effect estimate.
- **Adverse events or safety notes:** Notes monacolin K/lovastatin identity, possible side effects, widely variable monacolin K levels, citrinin concerns, and EFSA inability to define a safe monacolin intake.
- **Limitations:** Risk-assessment synthesis; jurisdiction-specific and not a primary trial.
- **Population mismatch:** No human protocol cohort.
- **Directness:** same_mechanism safety-boundary guideline

**Why it matters:** Strong implementation boundary: unsupervised product use conflicts with a major European risk-assessment opinion.

**Potential experiment signals:** medical supervision advice; monacolin K variability; lovastatin-like adverse effects; citrinin safety limit context

**Protocol takeaway:** Use as a high-priority medical-supervision and product-variability safety boundary.

**Claim use:** `safety-only`.
