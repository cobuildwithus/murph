---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:kobayashi-red-yeast-rice-voluntary-collection-2024-03-22"
slug: "sources/red-yeast-rice/kobayashi-red-yeast-rice-voluntary-collection-2024-03-22"
title: "Request for discontinuation of use of Red Yeast Rice related products and notice of voluntary collection"
summary: "Kobayashi notice asking customers to stop using specified Beni-koji products and announcing voluntary collection after kidney-problem reports and detection of unanticipated components."
status: "draft"
quality: "usable"
aliases:
  - "Kobayashi March 2024 Beni-koji voluntary collection notice"
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
  title: "Request for discontinuation of use of Red Yeast Rice related products and notice of voluntary collection"
  authors: "Kobayashi Pharmaceutical Co., Ltd."
  year: 2024
  journal: "Kobayashi Pharmaceutical notice"
  citation: "Kobayashi Pharmaceutical Co., Ltd. Request for discontinuation of use of Red Yeast Rice related products and notice of voluntary collection. 2024."
  url: "https://www.kobayashi.co.jp/info/files/pdf/20240322_en.pdf"
sourceIdentity:
  identityKind: "other"
  canonicalIdBasis: "url"
  identifiers:
    titleHash: "0beb50d00cdff746a303e0214cc12f7500248a6ab987d6fb5bf590cf0603d560"
    url: "https://www.kobayashi.co.jp/info/files/pdf/20240322_en.pdf"
  canonicalUrl: "https://www.kobayashi.co.jp/info/files/pdf/20240322_en.pdf"
researchEvidence:
  designKind: "guideline"
  designLabel: "Company safety notice / voluntary recall"
  populationLabel: "Consumers of named Kobayashi Beni-koji products including Beni-koji Choleste-Help."
  durationLabel: "Not applicable"
  aggregateRole: "primary"
  cohortKey: "kobayashi-red-yeast-rice-voluntary-collection-2024-03-22"
evidenceBucket: "Regulatory and jurisdiction warnings"
whyItMatters: "Captures the start of a major Beni-koji safety event and preserves the initial uncertainty around cause."
potentialMurphEndpoints:
  - "product name and lot"
  - "kidney symptoms"
  - "recall status"
  - "raw-material supplier"
protocolTakeaway: "Use as a safety boundary and adjacent-variant alert; do not generalize causality beyond the named products."
murphTakeaway: "Product identity and batch history can determine risk; stop-use notices should supersede experimentation."
studyDesign: "Company safety notice / voluntary recall"
modality: "Red yeast rice regulatory, product-quality, or safety context"
claimUse: "safety-only"
sourceFindings:
  -
    findingKind: "adverse_event"
    population: "Consumers of named Kobayashi Beni-koji products"
    exposure: "Kobayashi red yeast rice related products"
    outcome: "Kidney-problem reports and voluntary collection"
    summary: "Kobayashi asked users to discontinue specified red yeast rice related products and announced voluntary collection after kidney-problem reports and detection of possible unanticipated components; the exact component and causal relationship were not yet identified."
    evidenceUse:
      - "safety"
      - "adjacent_variant"
    findingId: "finding:kobayashi-red-yeast-rice-voluntary-collection-2024-03-22-voluntary-collection-kidney-reports"
    sourceKey: "source_artifact:kobayashi-red-yeast-rice-voluntary-collection-2024-03-22"
    extractedFromArtifactId: "art_kobayashi_red_yeast_rice_voluntary_collection_2024_03_22_pdf"
murphV1Priority: "High"
pdfRightsStatus: "permission_required"
artifacts:
  -
    artifactId: "art_kobayashi_red_yeast_rice_voluntary_collection_2024_03_22_pdf"
    sourceKey: "source_artifact:kobayashi-red-yeast-rice-voluntary-collection-2024-03-22"
    kind: "pdf"
    storage: "external"
    sourceUrl: "https://www.kobayashi.co.jp/info/files/pdf/20240322_en.pdf"
    rightsStatus: "permission_required"
    redistributable: false
    accessNotes: "External source artifact candidate only; copyrighted or externally hosted materials were not stored in Git during this extraction."
extractedEvidence:
  population: "Consumers of named Kobayashi Beni-koji products including Beni-koji Choleste-Help."
  interventionOrExposure: "Kobayashi red yeast rice related products and raw red yeast rice ingredients."
  comparatorOrControl: "None"
  durationOrFollowUp: "Not applicable"
  endpoints:
    - "kidney-problem reports"
    - "unanticipated components"
    - "recall/collection status"
  effectEstimatesOrDirection: "The company reported kidney-problem reports and ingredient analyses showing possible unanticipated components; exact ingredient and causal relationship were not identified in this initial notice."
  adverseEventsOrSafetyNotes: "Kidney problems were the triggering safety concern; the notice requested discontinuation and voluntary collection as a precaution."
  limitations: "Initial company notice; causal relationship and exact component were explicitly unresolved at the time."
  populationMismatch: "Product-specific Japanese Beni-koji products; adjacent safety context rather than general RYR-for-cholesterol efficacy evidence."
  directnessToProtocol: "adjacent_variant"
---
This source is included for **Regulatory and jurisdiction warnings**.

**Findings:** Kobayashi notice asking customers to stop using specified Beni-koji products and announcing voluntary collection after kidney-problem reports and detection of unanticipated components.

**Why it matters:** Captures the start of a major Beni-koji safety event and preserves the initial uncertainty around cause.

**Potential experiment signals:** product name and lot, kidney symptoms, recall status, raw-material supplier.

**Protocol takeaway:** Use as a safety boundary and adjacent-variant alert; do not generalize causality beyond the named products.

**Claim use:** `safety-only`.
