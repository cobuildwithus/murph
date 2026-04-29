---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:mhlw-beni-koji-cause-investigation-2024-09-18"
slug: "sources/red-yeast-rice/mhlw-beni-koji-cause-investigation-2024-09-18"
title: "Responses to the events associated with Beni-koji containing products"
summary: "MHLW cause-investigation PDF summarizing puberulic acid, compounds Y/Z, suspected blue-mold contamination during fermentation, and rat kidney-toxicity findings."
status: "draft"
quality: "usable"
aliases:
  - "MHLW September 2024 Beni-koji cause investigation"
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
  kind: "other"
  title: "Responses to the events associated with Beni-koji containing products"
  authors: "Ministry of Health, Labour and Welfare, Japan"
  year: 2024
  journal: "MHLW"
  citation: "Ministry of Health, Labour and Welfare, Japan. Responses to the events associated with Beni-koji containing products. 2024."
  url: "https://www.mhlw.go.jp/content/001311206.pdf"
sourceIdentity:
  identityKind: "other"
  canonicalIdBasis: "url"
  identifiers:
    titleHash: "ab2c87cbe9646ad55867f2cf1caccb65237ace50ca08ef04642231f4507d73fc"
    url: "https://www.mhlw.go.jp/content/001311206.pdf"
  canonicalUrl: "https://www.mhlw.go.jp/content/001311206.pdf"
researchEvidence:
  designKind: "guideline"
  designLabel: "Government cause-investigation summary"
  populationLabel: "Recalled Kobayashi Beni-koji product batches and animal-toxicity testing; no protocol participants."
  durationLabel: "Not applicable"
  aggregateRole: "primary"
  cohortKey: "mhlw-beni-koji-cause-investigation-2024-09-18"
evidenceBucket: "Regulatory and jurisdiction warnings"
whyItMatters: "Refines the Kobayashi safety event from nonspecific red yeast rice risk toward a product-contamination mechanism."
potentialMurphEndpoints:
  - "batch identity"
  - "kidney-function symptoms"
  - "product supplier traceability"
  - "contaminant test status"
protocolTakeaway: "Treat as adjacent contamination mechanism evidence; it supports product-quality guardrails rather than efficacy claims."
murphTakeaway: "Batch contamination can create risks unrelated to intended monacolin exposure, so lot/source traceability matters."
studyDesign: "Government cause-investigation summary"
modality: "Red yeast rice regulatory, product-quality, or safety context"
claimUse: "safety-only"
sourceFindings:

  -
    findingKind: "mechanistic"
    population: "Affected Beni-koji product batches and rat toxicity testing"
    exposure: "Puberulic acid and compounds Y/Z from blue-mold contaminated fermentation"
    outcome: "Renal-toxicity mechanism context"
    summary: "MHLW summarized evidence that Penicillium adametzioides contamination during fermentation produced puberulic acid and contributed to compounds Y/Z; puberulic acid alone produced proximal tubule degeneration/necrosis in rats, whereas Y/Z alone did not show kidney-toxicity findings in the summarized testing."
    evidenceUse:
      - "mechanism"
      - "safety"
      - "adjacent_variant"
    findingId: "finding:mhlw-beni-koji-cause-investigation-2024-09-18-puberulic-acid-mechanism"
    sourceKey: "source_artifact:mhlw-beni-koji-cause-investigation-2024-09-18"
    extractedFromArtifactId: "art_mhlw_beni_koji_cause_investigation_2024_09_18_pdf"
murphV1Priority: "High"
pdfRightsStatus: "open_access"
artifacts:

  -
    artifactId: "art_mhlw_beni_koji_cause_investigation_2024_09_18_pdf"
    sourceKey: "source_artifact:mhlw-beni-koji-cause-investigation-2024-09-18"
    kind: "pdf"
    storage: "external"
    sourceUrl: "https://www.mhlw.go.jp/content/001311206.pdf"
    rightsStatus: "open_access"
    redistributable: false
    accessNotes: "External source artifact candidate only; copyrighted or externally hosted materials were not stored in Git during this extraction."
extractedEvidence:
  population: "Recalled Kobayashi Beni-koji product batches and animal-toxicity testing; no protocol participants."
  interventionOrExposure: "Puberulic acid and compounds Y/Z detected in affected Beni-koji products."
  comparatorOrControl: "Animal toxicity comparison of puberulic acid versus compounds Y/Z as described by MHLW."
  durationOrFollowUp: "Not applicable"
  endpoints:
    - "proximal tubule degeneration/necrosis in rats"
    - "compound identification"
    - "fermentation contamination mechanism"
  effectEstimatesOrDirection: "MHLW reported renal dysfunction/toxicity findings with puberulic acid alone and no kidney-toxicity findings for compounds Y/Z alone in the summarized animal testing."
  adverseEventsOrSafetyNotes: "Renal toxicity centered on puberulic acid and affected product batches."
  limitations: "Cause-investigation and animal-toxicity summary; not a human protocol study and not a general incidence estimate."
  populationMismatch: "Mechanistic/product-specific adjacent evidence; not direct evidence for generic red yeast rice use for cholesterol."
  directnessToProtocol: "adjacent_variant"
---
This source is included for **Regulatory and jurisdiction warnings**.

**Findings:** MHLW cause-investigation PDF summarizing puberulic acid, compounds Y/Z, suspected blue-mold contamination during fermentation, and rat kidney-toxicity findings.

**Why it matters:** Refines the Kobayashi safety event from nonspecific red yeast rice risk toward a product-contamination mechanism.

**Potential experiment signals:** batch identity, kidney-function symptoms, product supplier traceability, contaminant test status.

**Protocol takeaway:** Treat as adjacent contamination mechanism evidence; it supports product-quality guardrails rather than efficacy claims.

**Claim use:** `safety-only`.
