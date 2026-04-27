---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:doi-10.2183-pjab.101.017"
slug: "sources/red-yeast-rice/doi-10.2183-pjab.101.017"
title: "Mechanism of puberulic acid contamination in red yeast rice tablets that caused a serious food poisoning outbreak in Japan"
summary: "Mechanistic investigation of puberulic acid contamination in RYR tablets that caused a serious food-poisoning outbreak in Japan."
status: "draft"
quality: "usable"
aliases:
  - "Yoshinari T 2025: Mechanism of puberulic acid contamination in red yeast rice tablets that caused a serious food poisoning outbreak in Japan"
  - "DOI 10.2183/pjab.101.017"
  - "PMCID PMC12332415"
  - "Mechanism of puberulic acid contamination in red yeast rice tablets that caused a serious food poisoning outbreak in Japan"
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
  title: "Mechanism of puberulic acid contamination in red yeast rice tablets that caused a serious food poisoning outbreak in Japan"
  authors: "Yoshinari T; Watanabe M; Aoki W; Tanaka S; Masumoto N; Ito M; Ohnishi T"
  year: 2025
  journal: "Proceedings of the Japan Academy, Series B"
  citation: "Yoshinari T; Watanabe M; Aoki W; Tanaka S; Masumoto N; Ito M; Ohnishi T. Mechanism of puberulic acid contamination in red yeast rice tablets that caused a serious food poisoning outbreak in Japan. Proceedings of the Japan Academy, Series B. 2025. doi:10.2183/pjab.101.017."
  doi: "10.2183/pjab.101.017"
  url: "https://doi.org/10.2183/pjab.101.017"
sourceIdentity:
  identityKind: "scholarly_work"
  canonicalIdBasis: "doi"
  identifiers:
    doi: "10.2183/pjab.101.017"
    titleHash: "0c60b6c8d0803e5754de062ce07ee0ecd11fabcbfe6a7ab132ae9001e0ba0bd1"
    url: "https://doi.org/10.2183/pjab.101.017"
  canonicalUrl: "https://doi.org/10.2183/pjab.101.017"
researchEvidence:
  designKind: "acute_mechanistic"
  designLabel: "Mechanistic contamination investigation"
  populationLabel: "Red yeast rice tablets implicated in a serious food-poisoning outbreak in Japan; no protocol trial cohort"
  durationLabel: "Outbreak/product investigation; no intervention follow-up duration"
  aggregateRole: "primary"
  cohortKey: "doi-10-2183-pjab-101-017"
evidenceBucket: "Product quality, contamination, and dose uncertainty"
whyItMatters: "Expands contamination concern beyond citrinin and reinforces that product/manufacturing quality is a prerequisite for any protocol implementation."
potentialMurphEndpoints:
  - "puberulic acid contamination mechanism"
  - "food-poisoning outbreak context"
  - "manufacturing/product-quality failure"
protocolTakeaway: "Use as a severe-contamination guardrail, not as expected-risk quantification for vetted products."
murphTakeaway: "Use as a severe-contamination guardrail, not as expected-risk quantification for vetted products. It should shape product selection, monitoring, dose fidelity, or safety context without being treated as direct LDL-C efficacy evidence."
studyDesign: "Mechanistic contamination investigation"
modality: "Red yeast rice supplement quality/safety context"
claimUse: "safety-only"
sourceFindings:
  -
    findingId: "finding:doi-10-2183-pjab-101-017:batch-003-primary"
    sourceKey: "source_artifact:doi-10.2183-pjab.101.017"
    findingKind: "mechanistic"
    population: "Red yeast rice tablets implicated in a serious food-poisoning outbreak in Japan; no protocol trial cohort"
    exposure: "Contaminated red yeast rice tablets and the proposed mechanism of puberulic acid contamination"
    outcome: "puberulic acid contamination mechanism; food-poisoning outbreak context; manufacturing/product-quality failure"
    summary: "Mechanistic source on how puberulic acid contamination occurred in RYR tablets linked to a serious Japanese outbreak; no LDL-C effect estimate."
    evidenceUse:
      - "mechanism"
      - "safety"
murphV1Priority: "Medium"
pdfRightsStatus: "open_access"
---
This source is included for **Product quality, contamination, and dose uncertainty**.

**Findings:** Mechanistic investigation of puberulic acid contamination in RYR tablets that caused a serious food-poisoning outbreak in Japan.

**Extracted details:**

- **Population / sample:** Red yeast rice tablets implicated in a serious food-poisoning outbreak in Japan; no protocol trial cohort
- **Intervention or exposure:** Contaminated red yeast rice tablets and the proposed mechanism of puberulic acid contamination
- **Comparator / control:** No clinical comparator
- **Duration / follow-up:** Outbreak/product investigation; no intervention follow-up duration
- **Endpoints:** puberulic acid contamination mechanism; food-poisoning outbreak context; manufacturing/product-quality failure
- **Effect estimates or direction:** Mechanistic source on how puberulic acid contamination occurred in RYR tablets linked to a serious Japanese outbreak; no LDL-C effect estimate.
- **Adverse events or safety notes:** Supports a high-severity safety boundary around rare but serious manufacturing contamination.
- **Limitations:** Outbreak-specific mechanistic investigation; not evidence that all RYR products contain puberulic acid.
- **Population mismatch:** Outbreak tablets are not necessarily representative of protocol-selected products or other markets.
- **Directness:** same_mechanism safety boundary; not direct protocol efficacy

**Why it matters:** Expands contamination concern beyond citrinin and reinforces that product/manufacturing quality is a prerequisite for any protocol implementation.

**Potential experiment signals:** puberulic acid contamination mechanism; food-poisoning outbreak context; manufacturing/product-quality failure

**Protocol takeaway:** Use as a severe-contamination guardrail, not as expected-risk quantification for vetted products.

**Claim use:** `safety-only`.
