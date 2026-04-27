---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:nccih-red-yeast-rice-2026-04-26"
slug: "sources/red-yeast-rice/nccih-red-yeast-rice-2026-04-26"
title: "Red Yeast Rice: What You Need To Know"
summary: "NCCIH overview of red yeast rice, monacolin K/lovastatin identity, product variability, FDA legality, statin-like side effects/interactions, pregnancy/lactation cautions, and citrinin contamination."
status: "draft"
quality: "usable"
aliases:
  - "NCCIH Red Yeast Rice What You Need To Know"
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
  title: "Red Yeast Rice: What You Need To Know"
  authors: "National Center for Complementary and Integrative Health"
  year: 2026
  journal: "NCCIH"
  citation: "National Center for Complementary and Integrative Health. Red Yeast Rice: What You Need To Know. NCCIH. Accessed 2026."
  url: "https://www.nccih.nih.gov/health/red-yeast-rice"
sourceIdentity:
  identityKind: "web_page"
  canonicalIdBasis: "url"
  identifiers:
    titleHash: "43cd44b32aba6548033c77c1d09f5877f25ec4e47fac49c001c3b3199cf97491"
    url: "https://www.nccih.nih.gov/health/red-yeast-rice"
  canonicalUrl: "https://www.nccih.nih.gov/health/red-yeast-rice"
researchEvidence:
  designKind: "narrative_review"
  designLabel: "Consumer evidence page / narrative review"
  populationLabel: "Consumers considering red yeast rice supplements."
  durationLabel: "Not applicable"
  aggregateRole: "primary"
  cohortKey: "nccih-red-yeast-rice-2026-04-26"
evidenceBucket: "Regulatory and jurisdiction warnings"
whyItMatters: "Directly addresses the practical user risk: product labels often do not disclose the active drug-like exposure."
potentialMurphEndpoints:
  - "LDL-C"
  - "monacolin K per dose"
  - "citrinin certificate"
  - "muscle symptoms"
  - "liver/kidney symptoms"
protocolTakeaway: "Protocol materials must warn that monacolin K content varies widely and may be unknowable from the label."
murphTakeaway: "The experiment should require product identity, monacolin content, citrinin status, and medication/pregnancy screening before self-tracking LDL-C."
studyDesign: "Consumer evidence page / narrative review"
modality: "Red yeast rice regulatory, product-quality, or safety context"
claimUse: "safety-only"
sourceFindings:
  -
    findingKind: "safety"
    population: "Consumers considering red yeast rice supplements"
    exposure: "Commercial red yeast rice products with variable monacolin K content"
    outcome: "Product variability and statin-like safety cautions"
    summary: "NCCIH emphasizes that monacolin K content varies widely and usually is not disclosed on labels; products with significant monacolin K may lower cholesterol but can cause statin-like muscle, kidney, liver, gastrointestinal, and interaction risks, and citrinin contamination is a kidney-safety concern."
    evidenceUse:
      - "safety"
      - "context"
      - "efficacy"
    findingId: "finding:nccih-red-yeast-rice-2026-04-26-nccih-product-variability-and-safety"
    sourceKey: "source_artifact:nccih-red-yeast-rice-2026-04-26"
    extractedFromArtifactId: "art_nccih_red_yeast_rice_2026_04_26_html"
murphV1Priority: "High"
pdfRightsStatus: "open_access"
artifacts:
  -
    artifactId: "art_nccih_red_yeast_rice_2026_04_26_html"
    sourceKey: "source_artifact:nccih-red-yeast-rice-2026-04-26"
    kind: "html"
    storage: "external"
    sourceUrl: "https://www.nccih.nih.gov/health/red-yeast-rice"
    rightsStatus: "open_access"
    redistributable: false
    accessNotes: "External source artifact candidate only; copyrighted or externally hosted materials were not stored in Git during this extraction."
extractedEvidence:
  population: "Consumers considering red yeast rice supplements."
  interventionOrExposure: "Red yeast rice products with variable monacolin K and possible contaminants."
  comparatorOrControl: "None"
  durationOrFollowUp: "Not applicable"
  endpoints:
    - "monacolin K variability"
    - "LDL-C context"
    - "FDA legality"
    - "statin-like adverse effects"
    - "citrinin contamination"
  effectEstimatesOrDirection: "NCCIH reports that consumers cannot know monacolin K content from labels and cites a 2017 analysis where products containing monacolin K ranged from 0.09 to 5.48 mg per 1,200 mg red yeast rice."
  adverseEventsOrSafetyNotes: "Products with significant monacolin K can cause muscle, kidney, liver, gastrointestinal, and interaction risks similar to statins; citrinin may damage kidneys; pregnancy/lactation are cautioned against."
  limitations: "Consumer narrative page; summarizes other evidence and does not provide a new clinical effect estimate."
  populationMismatch: "Regulatory, product-quality, or safety context; not a Murph self-experiment cohort."
  directnessToProtocol: "general_guideline"
---
This source is included for **Regulatory and jurisdiction warnings**.

**Findings:** NCCIH overview of red yeast rice, monacolin K/lovastatin identity, product variability, FDA legality, statin-like side effects/interactions, pregnancy/lactation cautions, and citrinin contamination.

**Why it matters:** Directly addresses the practical user risk: product labels often do not disclose the active drug-like exposure.

**Potential experiment signals:** LDL-C, monacolin K per dose, citrinin certificate, muscle symptoms, liver/kidney symptoms.

**Protocol takeaway:** Protocol materials must warn that monacolin K content varies widely and may be unknowable from the label.

**Claim use:** `safety-only`.
