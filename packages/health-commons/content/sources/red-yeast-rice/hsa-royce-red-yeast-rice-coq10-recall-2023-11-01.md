---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:hsa-royce-red-yeast-rice-coq10-recall-2023-11-01"
slug: "sources/red-yeast-rice/hsa-royce-red-yeast-rice-coq10-recall-2023-11-01"
title: "Royce Red Yeast Rice & CoQ10"
summary: "HSA retail-level Class 2 recall of Royce Red Yeast Rice & CoQ10 batch RY30203 after product-quality surveillance found lovastatin above allowable limits."
status: "draft"
quality: "usable"
aliases:
  - "HSA Royce Red Yeast Rice CoQ10 recall"
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
  title: "Royce Red Yeast Rice & CoQ10"
  authors: "Health Sciences Authority Singapore"
  year: 2023
  journal: "HSA Product Recalls"
  citation: "Health Sciences Authority Singapore. Royce Red Yeast Rice & CoQ10. Product recall. 2023."
  url: "https://www.hsa.gov.sg/announcements/product-recall/royce-red-yeast-rice-coq10"
sourceIdentity:
  identityKind: "web_page"
  canonicalIdBasis: "url"
  identifiers:
    titleHash: "3ca1427b6941dfcd0ca9f2ae3d69a7c45d08f12991614ac643b60984f261f399"
    url: "https://www.hsa.gov.sg/announcements/product-recall/royce-red-yeast-rice-coq10"
  canonicalUrl: "https://www.hsa.gov.sg/announcements/product-recall/royce-red-yeast-rice-coq10"
researchEvidence:
  designKind: "guideline"
  designLabel: "Product recall"
  populationLabel: "Consumers and suppliers of Royce Red Yeast Rice & CoQ10 batch RY30203 in Singapore."
  durationLabel: "Not applicable"
  aggregateRole: "primary"
  cohortKey: "hsa-royce-red-yeast-rice-coq10-recall-2023-11-01"
evidenceBucket: "Regulatory and jurisdiction warnings"
whyItMatters: "Concrete Singapore enforcement example for lovastatin content above allowable red yeast rice limits."
potentialMurphEndpoints:
  - "batch number"
  - "lovastatin content"
  - "recall status"
  - "muscle symptoms"
protocolTakeaway: "Check current HSA recalls and product lot numbers before using red yeast rice products."
murphTakeaway: "A recalled batch should be excluded even if the product category is otherwise allowed."
studyDesign: "Product recall"
modality: "Red yeast rice regulatory, product-quality, or safety context"
claimUse: "safety-only"
sourceFindings:

  -
    findingKind: "safety"
    population: "Consumers of Royce Red Yeast Rice & CoQ10 batch RY30203"
    exposure: "Product found to contain lovastatin above allowable limits"
    outcome: "HSA retail-level Class 2 recall"
    summary: "HSA announced a retail-level Class 2 recall of Royce Red Yeast Rice & CoQ10 batch RY30203 after surveillance testing found lovastatin above allowable limits."
    evidenceUse:
      - "safety"
      - "context"
    findingId: "finding:hsa-royce-red-yeast-rice-coq10-recall-2023-11-01-royce-recall-lovastatin"
    sourceKey: "source_artifact:hsa-royce-red-yeast-rice-coq10-recall-2023-11-01"
    extractedFromArtifactId: "art_hsa_royce_red_yeast_rice_coq10_recall_2023_11_01_html"
murphV1Priority: "High"
pdfRightsStatus: "open_access"
artifacts:

  -
    artifactId: "art_hsa_royce_red_yeast_rice_coq10_recall_2023_11_01_html"
    sourceKey: "source_artifact:hsa-royce-red-yeast-rice-coq10-recall-2023-11-01"
    kind: "html"
    storage: "external"
    sourceUrl: "https://www.hsa.gov.sg/announcements/product-recall/royce-red-yeast-rice-coq10"
    rightsStatus: "open_access"
    redistributable: false
    accessNotes: "External source artifact candidate only; copyrighted or externally hosted materials were not stored in Git during this extraction."
extractedEvidence:
  population: "Consumers and suppliers of Royce Red Yeast Rice & CoQ10 batch RY30203 in Singapore."
  interventionOrExposure: "Royce Red Yeast Rice & CoQ10 batch RY30203 with lovastatin above allowable limits."
  comparatorOrControl: "None"
  durationOrFollowUp: "Not applicable"
  endpoints:
    - "lovastatin above allowable limits"
    - "retail recall"
    - "product-quality surveillance"
  effectEstimatesOrDirection: "HSA product-quality surveillance found lovastatin above allowable limits and initiated a retail-level Class 2 recall."
  adverseEventsOrSafetyNotes: "Excess lovastatin creates a statin-like safety boundary, but the recall notice does not report individual adverse events."
  limitations: "Product-specific recall; no efficacy endpoint and no adverse-event denominator."
  populationMismatch: "Regulatory, product-quality, or safety context; not a Murph self-experiment cohort."
  directnessToProtocol: "general_guideline"
---
This source is included for **Regulatory and jurisdiction warnings**.

**Findings:** HSA retail-level Class 2 recall of Royce Red Yeast Rice & CoQ10 batch RY30203 after product-quality surveillance found lovastatin above allowable limits.

**Why it matters:** Concrete Singapore enforcement example for lovastatin content above allowable red yeast rice limits.

**Potential experiment signals:** batch number, lovastatin content, recall status, muscle symptoms.

**Protocol takeaway:** Check current HSA recalls and product lot numbers before using red yeast rice products.

**Claim use:** `safety-only`.
