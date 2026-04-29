---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:hsa-lac-activated-heart-protect-recall-2024-04-16"
slug: "sources/red-yeast-rice/hsa-lac-activated-heart-protect-recall-2024-04-16"
title: "LAC Activated Heart Protect"
summary: "HSA retail-level recall of ten batches of LAC Activated Heart Protect because the product contained red yeast rice material supplied by Kobayashi Pharmaceutical Japan, which had unintended ingredients overseas."
status: "draft"
quality: "usable"
aliases:
  - "HSA LAC Activated Heart Protect red yeast rice recall"
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
  kind: "web_page"
  title: "LAC Activated Heart Protect"
  authors: "Health Sciences Authority Singapore"
  year: 2024
  journal: "HSA Product Recalls"
  citation: "Health Sciences Authority Singapore. LAC Activated Heart Protect. Product recall. 2024."
  url: "https://www.hsa.gov.sg/announcements/product-recall/lac-activated-heart-protect"
sourceIdentity:
  identityKind: "web_page"
  canonicalIdBasis: "url"
  identifiers:
    titleHash: "1cebfbee41c3b6762f56a5f1992bd1334356f949099db9c8703507cc02fa1f94"
    url: "https://www.hsa.gov.sg/announcements/product-recall/lac-activated-heart-protect"
  canonicalUrl: "https://www.hsa.gov.sg/announcements/product-recall/lac-activated-heart-protect"
researchEvidence:
  designKind: "guideline"
  designLabel: "Product recall"
  populationLabel: "Consumers and suppliers of ten recalled LAC Activated Heart Protect batches in Singapore."
  durationLabel: "Not applicable"
  aggregateRole: "primary"
  cohortKey: "hsa-lac-activated-heart-protect-recall-2024-04-16"
evidenceBucket: "Regulatory and jurisdiction warnings"
whyItMatters: "Demonstrates how upstream raw-material contamination concerns propagate across jurisdictions and brands."
potentialMurphEndpoints:
  - "batch number"
  - "supplier lineage"
  - "recall status"
  - "kidney symptoms"
protocolTakeaway: "Product supplier and batch lineage should be tracked; recall status may apply even when local product risk is uncertain."
murphTakeaway: "A Murph protocol should log product batch and supplier, not only ingredient name."
studyDesign: "Product recall"
modality: "Red yeast rice regulatory, product-quality, or safety context"
claimUse: "safety-only"
sourceFindings:

  -
    findingKind: "safety"
    population: "Consumers of recalled LAC Activated Heart Protect batches in Singapore"
    exposure: "Red yeast rice material supplied by Kobayashi Pharmaceutical Japan"
    outcome: "Precautionary retail-level recall"
    summary: "HSA announced a retail-level recall of ten LAC Activated Heart Protect batches as a precaution because the product contained red yeast rice material supplied by Kobayashi Pharmaceutical Japan, which had unintended ingredients overseas; the company clarified the product did not contain affected ingredient batches based on available information."
    evidenceUse:
      - "safety"
      - "adjacent_variant"
      - "context"
    findingId: "finding:hsa-lac-activated-heart-protect-recall-2024-04-16-lac-recall-kobayashi-lineage"
    sourceKey: "source_artifact:hsa-lac-activated-heart-protect-recall-2024-04-16"
    extractedFromArtifactId: "art_hsa_lac_activated_heart_protect_recall_2024_04_16_html"
murphV1Priority: "High"
pdfRightsStatus: "open_access"
artifacts:

  -
    artifactId: "art_hsa_lac_activated_heart_protect_recall_2024_04_16_html"
    sourceKey: "source_artifact:hsa-lac-activated-heart-protect-recall-2024-04-16"
    kind: "html"
    storage: "external"
    sourceUrl: "https://www.hsa.gov.sg/announcements/product-recall/lac-activated-heart-protect"
    rightsStatus: "open_access"
    redistributable: false
    accessNotes: "External source artifact candidate only; copyrighted or externally hosted materials were not stored in Git during this extraction."
extractedEvidence:
  population: "Consumers and suppliers of ten recalled LAC Activated Heart Protect batches in Singapore."
  interventionOrExposure: "LAC Activated Heart Protect containing red yeast rice material supplied by Kobayashi Pharmaceutical Japan."
  comparatorOrControl: "None"
  durationOrFollowUp: "Not applicable"
  endpoints:
    - "retail recall"
    - "unintended ingredients concern"
    - "batch traceability"
  effectEstimatesOrDirection: "HSA described a voluntary recall as a precautionary measure; the company clarified that available information indicated the product did not contain the affected batches of red yeast rice ingredient."
  adverseEventsOrSafetyNotes: "Recall was precautionary due to overseas unintended-ingredient concerns in Kobayashi-supplied red yeast rice material."
  limitations: "Precautionary product recall; no local adverse-event incidence and HSA note says recall does not necessarily imply a product is unsafe or inefficacious."
  populationMismatch: "Singapore product recall tied to Kobayashi raw material; adjacent product-quality context rather than direct protocol evidence."
  directnessToProtocol: "adjacent_variant"
---
This source is included for **Regulatory and jurisdiction warnings**.

**Findings:** HSA retail-level recall of ten batches of LAC Activated Heart Protect because the product contained red yeast rice material supplied by Kobayashi Pharmaceutical Japan, which had unintended ingredients overseas.

**Why it matters:** Demonstrates how upstream raw-material contamination concerns propagate across jurisdictions and brands.

**Potential experiment signals:** batch number, supplier lineage, recall status, kidney symptoms.

**Protocol takeaway:** Product supplier and batch lineage should be tracked; recall status may apply even when local product risk is uncertain.

**Claim use:** `safety-only`.
