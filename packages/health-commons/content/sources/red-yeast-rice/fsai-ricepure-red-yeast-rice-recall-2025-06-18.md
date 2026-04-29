---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:fsai-ricepure-red-yeast-rice-recall-2025-06-18"
slug: "sources/red-yeast-rice/fsai-ricepure-red-yeast-rice-recall-2025-06-18"
title: "Recall of Ricepure Red Yeast Rice food supplement due to an elevated level of monacolin K and missing warning statements"
summary: "FSAI recall of Ricepure Red Yeast Rice due to elevated monacolin K in one batch and missing consumption warning statements on all packs."
status: "draft"
quality: "usable"
aliases:
  - "FSAI Ricepure red yeast rice recall"
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
  title: "Recall of Ricepure Red Yeast Rice food supplement due to an elevated level of monacolin K and missing warning statements"
  authors: "Food Safety Authority of Ireland"
  year: 2025
  journal: "FSAI Food Alerts"
  citation: "Food Safety Authority of Ireland. Recall of Ricepure Red Yeast Rice food supplement due to an elevated level of monacolin K and missing warning statements. Food Alert 2025.28. 2025."
  url: "https://www.fsai.ie/news-and-alerts/food-alerts/recall-of-ricepure-red-yeast-rice-food-supplement"
sourceIdentity:
  identityKind: "web_page"
  canonicalIdBasis: "url"
  identifiers:
    titleHash: "45d0067ea7324c4b3f6b4e98fce6c96cd5d83604d1b61b231c34fe9353540082"
    url: "https://www.fsai.ie/news-and-alerts/food-alerts/recall-of-ricepure-red-yeast-rice-food-supplement"
  canonicalUrl: "https://www.fsai.ie/news-and-alerts/food-alerts/recall-of-ricepure-red-yeast-rice-food-supplement"
researchEvidence:
  designKind: "guideline"
  designLabel: "Food safety recall"
  populationLabel: "Consumers of Ricepure Red Yeast Rice 30-capsule packs."
  durationLabel: "Not applicable"
  aggregateRole: "primary"
  cohortKey: "fsai-ricepure-red-yeast-rice-recall-2025-06-18"
evidenceBucket: "Regulatory and jurisdiction warnings"
whyItMatters: "Shows EU/Irish enforcement of monacolin thresholds and label-warning requirements in a concrete product recall."
potentialMurphEndpoints:
  - "product recall status"
  - "monacolin K daily amount"
  - "GI symptoms"
  - "muscle symptoms"
  - "liver-safety symptoms"
protocolTakeaway: "A protocol should require checking current recalls and warning labels before product use."
murphTakeaway: "Missing label warnings and elevated monacolin levels are enough to stop a product from being suitable for self-experimentation."
studyDesign: "Food safety recall"
modality: "Red yeast rice regulatory, product-quality, or safety context"
claimUse: "safety-only"
sourceFindings:

  -
    findingKind: "safety"
    population: "Consumers of Ricepure Red Yeast Rice food supplement"
    exposure: "Ricepure Red Yeast Rice with elevated monacolin K in one batch and missing warning statements"
    outcome: "Food safety recall and consumer stop-use advice"
    summary: "FSAI recalled Ricepure Red Yeast Rice because one batch had elevated monacolin K and all packs lacked consumption warning statements; consumers were advised not to take the implicated product."
    evidenceUse:
      - "safety"
      - "context"
    findingId: "finding:fsai-ricepure-red-yeast-rice-recall-2025-06-18-ricepure-recall"
    sourceKey: "source_artifact:fsai-ricepure-red-yeast-rice-recall-2025-06-18"
    extractedFromArtifactId: "art_fsai_ricepure_red_yeast_rice_recall_2025_06_18_html"
murphV1Priority: "High"
pdfRightsStatus: "open_access"
artifacts:

  -
    artifactId: "art_fsai_ricepure_red_yeast_rice_recall_2025_06_18_html"
    sourceKey: "source_artifact:fsai-ricepure-red-yeast-rice-recall-2025-06-18"
    kind: "html"
    storage: "external"
    sourceUrl: "https://www.fsai.ie/news-and-alerts/food-alerts/recall-of-ricepure-red-yeast-rice-food-supplement"
    rightsStatus: "open_access"
    redistributable: false
    accessNotes: "External source artifact candidate only; copyrighted or externally hosted materials were not stored in Git during this extraction."
extractedEvidence:
  population: "Consumers of Ricepure Red Yeast Rice 30-capsule packs."
  interventionOrExposure: "Ricepure Red Yeast Rice food supplement with elevated monacolin K or missing warning statements."
  comparatorOrControl: "None"
  durationOrFollowUp: "Not applicable"
  endpoints:
    - "monacolin K above 3 mg/day concern"
    - "GI adverse effects"
    - "musculoskeletal effects"
    - "hepatobiliary effects"
    - "missing warnings"
  effectEstimatesOrDirection: "FSAI recalled all batch codes/best-before dates because one batch had elevated monacolin K and all packs lacked consumption warnings."
  adverseEventsOrSafetyNotes: "FSAI states that consuming more than 3 mg/day of monacolin K from red yeast rice may cause gastrointestinal, musculoskeletal/connective-tissue, hepatobiliary, and skin/subcutaneous adverse effects."
  limitations: "Recall alert for a named product; no individual adverse-event incidence estimate."
  populationMismatch: "Regulatory, product-quality, or safety context; not a Murph self-experiment cohort."
  directnessToProtocol: "general_guideline"
---
This source is included for **Regulatory and jurisdiction warnings**.

**Findings:** FSAI recall of Ricepure Red Yeast Rice due to elevated monacolin K in one batch and missing consumption warning statements on all packs.

**Why it matters:** Shows EU/Irish enforcement of monacolin thresholds and label-warning requirements in a concrete product recall.

**Potential experiment signals:** product recall status, monacolin K daily amount, GI symptoms, muscle symptoms, liver-safety symptoms.

**Protocol takeaway:** A protocol should require checking current recalls and warning labels before product use.

**Claim use:** `safety-only`.
