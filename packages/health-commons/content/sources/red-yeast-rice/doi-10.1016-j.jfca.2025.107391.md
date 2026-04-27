---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:doi-10.1016-j.jfca.2025.107391"
slug: "sources/red-yeast-rice/doi-10.1016-j.jfca.2025.107391"
title: "Development of a liquid chromatography–tandem mass spectrometry method for the determination of puberulic acid in red yeast rice supplements"
summary: "Method-development article for detecting and quantifying puberulic acid in red yeast rice supplements after the Japan contamination concern."
status: "draft"
quality: "usable"
aliases:
  - "Guo W 2025: Development of a liquid chromatography–tandem mass spectrometry method for the determination of puberulic acid in red yeast rice supplements"
  - "DOI 10.1016/j.jfca.2025.107391"
  - "Development of a liquid chromatography–tandem mass spectrometry method for the determination of puberulic acid in red yeast rice supplements"
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
  title: "Development of a liquid chromatography–tandem mass spectrometry method for the determination of puberulic acid in red yeast rice supplements"
  authors: "Guo W; Li J; Zhou S; Zhang S; Qiu N; Zhu L; Cai Z"
  year: 2025
  journal: "Journal of Food Composition and Analysis"
  citation: "Guo W; Li J; Zhou S; Zhang S; Qiu N; Zhu L; Cai Z. Development of a liquid chromatography–tandem mass spectrometry method for the determination of puberulic acid in red yeast rice supplements. Journal of Food Composition and Analysis. 2025. doi:10.1016/j.jfca.2025.107391."
  doi: "10.1016/j.jfca.2025.107391"
  url: "https://doi.org/10.1016/j.jfca.2025.107391"
sourceIdentity:
  identityKind: "scholarly_work"
  canonicalIdBasis: "doi"
  identifiers:
    doi: "10.1016/j.jfca.2025.107391"
    titleHash: "9a7e34a31a5065bdc2b767d5be328bfb7483f9420262155badc33c5b180949f8"
    url: "https://doi.org/10.1016/j.jfca.2025.107391"
  canonicalUrl: "https://doi.org/10.1016/j.jfca.2025.107391"
researchEvidence:
  designKind: "other"
  designLabel: "LC-MS/MS puberulic acid method validation"
  populationLabel: "Red yeast rice supplements considered for puberulic acid testing; no human participants"
  durationLabel: "Laboratory method development/validation"
  aggregateRole: "primary"
  cohortKey: "doi-10-1016-j-jfca-2025-107391"
evidenceBucket: "Product quality, contamination, and dose uncertainty"
whyItMatters: "Adds a modern QC target beyond citrinin and active monacolins."
potentialMurphEndpoints:
  - "puberulic acid detection"
  - "method accuracy/precision"
  - "LOD/LOQ"
protocolTakeaway: "Use as contaminant-testing context; not a protocol efficacy source."
murphTakeaway: "Use as contaminant-testing context; not a protocol efficacy source. It should shape product selection, monitoring, dose fidelity, or safety context without being treated as direct LDL-C efficacy evidence."
studyDesign: "LC-MS/MS puberulic acid method validation"
modality: "Red yeast rice supplement quality/safety context"
claimUse: "safety-only"
sourceFindings:
  -
    findingId: "finding:doi-10-1016-j-jfca-2025-107391:batch-003-primary"
    sourceKey: "source_artifact:doi-10.1016-j.jfca.2025.107391"
    findingKind: "measurement_validation"
    population: "Red yeast rice supplements considered for puberulic acid testing; no human participants"
    exposure: "LC-MS/MS determination of puberulic acid in RYR supplements"
    outcome: "puberulic acid detection; method accuracy/precision; LOD/LOQ"
    summary: "Validated a direct LC-MS/MS method for puberulic acid; reported calibration r²=0.999 and detection/quantification limits of 1.95 ng/mL and 6.55 ng/mL."
    evidenceUse:
      - "measurement"
      - "safety"
murphV1Priority: "High"
pdfRightsStatus: "open_access"
---
This source is included for **Product quality, contamination, and dose uncertainty**.

**Findings:** Method-development article for detecting and quantifying puberulic acid in red yeast rice supplements after the Japan contamination concern.

**Extracted details:**

- **Population / sample:** Red yeast rice supplements considered for puberulic acid testing; no human participants
- **Intervention or exposure:** LC-MS/MS determination of puberulic acid in RYR supplements
- **Comparator / control:** No clinical comparator
- **Duration / follow-up:** Laboratory method development/validation
- **Endpoints:** puberulic acid detection; method accuracy/precision; LOD/LOQ
- **Effect estimates or direction:** Validated a direct LC-MS/MS method for puberulic acid; reported calibration r²=0.999 and detection/quantification limits of 1.95 ng/mL and 6.55 ng/mL.
- **Adverse events or safety notes:** Connects RYR supplement QC to puberulic acid, a nephrotoxic contaminant implicated in a severe outbreak context.
- **Limitations:** Analytical method; does not estimate routine prevalence or clinical risk in ordinary products.
- **Population mismatch:** No human intervention outcomes.
- **Directness:** measurement_context for same product family

**Why it matters:** Adds a modern QC target beyond citrinin and active monacolins.

**Potential experiment signals:** puberulic acid detection; method accuracy/precision; LOD/LOQ

**Protocol takeaway:** Use as contaminant-testing context; not a protocol efficacy source.

**Claim use:** `safety-only`.
