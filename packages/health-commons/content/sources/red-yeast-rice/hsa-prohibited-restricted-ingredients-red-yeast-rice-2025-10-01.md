---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:hsa-prohibited-restricted-ingredients-red-yeast-rice-2025-10-01"
slug: "sources/red-yeast-rice/hsa-prohibited-restricted-ingredients-red-yeast-rice-2025-10-01"
title: "Guidelines on Prohibited and Restricted Ingredients in Health Supplements and Traditional Medicines"
summary: "HSA guideline listing Monascus purpureus (red yeast rice) as restricted in health supplements and traditional medicines with lovastatin concentration and cautionary-label requirements."
status: "draft"
quality: "usable"
aliases:
  - "HSA prohibited and restricted ingredients red yeast rice"
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
  kind: "guideline"
  title: "Guidelines on Prohibited and Restricted Ingredients in Health Supplements and Traditional Medicines"
  authors: "Health Sciences Authority Singapore"
  year: 2025
  journal: "HSA Health Products Regulation Group"
  citation: "Health Sciences Authority Singapore. Guidelines on Prohibited and Restricted Ingredients in Health Supplements and Traditional Medicines. Oct 2025."
  url: "https://www.hsa.gov.sg/docs/default-source/hprg-tmhs/chpb-tmhs/prohibited_restricted_ing_guidelines.pdf"
sourceIdentity:
  identityKind: "guideline"
  canonicalIdBasis: "url"
  identifiers:
    titleHash: "cde774df13d96db521fa0229f3bfdb06a95b94976066582f48c4a376d79c8709"
    url: "https://www.hsa.gov.sg/docs/default-source/hprg-tmhs/chpb-tmhs/prohibited_restricted_ing_guidelines.pdf"
  canonicalUrl: "https://www.hsa.gov.sg/docs/default-source/hprg-tmhs/chpb-tmhs/prohibited_restricted_ing_guidelines.pdf"
researchEvidence:
  designKind: "guideline"
  designLabel: "Regulatory guideline"
  populationLabel: "Health supplements and traditional medicines in Singapore containing Monascus purpureus (red yeast rice)."
  durationLabel: "Not applicable"
  aggregateRole: "primary"
  cohortKey: "hsa-prohibited-restricted-ingredients-red-yeast-rice-2025-10-01"
evidenceBucket: "Regulatory and jurisdiction warnings"
whyItMatters: "Singapore-specific regulatory boundary for lovastatin content and warning labels."
potentialMurphEndpoints:
  - "lovastatin percentage"
  - "cholesterol-lowering medication use"
  - "muscle aches"
protocolTakeaway: "For Singapore users, red yeast rice content and warning-label requirements are jurisdictional safety constraints."
murphTakeaway: "Product selection and protocol warnings must be jurisdiction-specific; muscle aches should be a stop condition."
studyDesign: "Regulatory guideline"
modality: "Red yeast rice regulatory, product-quality, or safety context"
claimUse: "safety-only"
sourceFindings:

  -
    findingKind: "safety"
    population: "Singapore health supplements/traditional medicines containing red yeast rice"
    exposure: "Monascus purpureus with naturally occurring lovastatin"
    outcome: "Restricted-ingredient conditions and warning statement"
    summary: "HSA lists Monascus purpureus (red yeast rice) as restricted in health supplements and traditional medicines: lovastatin concentration must be less than 1%, and labels should warn that the product contains naturally occurring lovastatin, advise medical advice if taking cholesterol-lowering medicines, and discontinue use if muscle aches occur."
    evidenceUse:
      - "safety"
      - "context"
    findingId: "finding:hsa-prohibited-restricted-ingredients-red-yeast-rice-2025-10-01-hsa-lovastatin-restriction"
    sourceKey: "source_artifact:hsa-prohibited-restricted-ingredients-red-yeast-rice-2025-10-01"
    extractedFromArtifactId: "art_hsa_prohibited_restricted_ingredients_red_yeast_rice_2025_10_01_pdf"
murphV1Priority: "High"
pdfRightsStatus: "open_access"
artifacts:

  -
    artifactId: "art_hsa_prohibited_restricted_ingredients_red_yeast_rice_2025_10_01_pdf"
    sourceKey: "source_artifact:hsa-prohibited-restricted-ingredients-red-yeast-rice-2025-10-01"
    kind: "pdf"
    storage: "external"
    sourceUrl: "https://www.hsa.gov.sg/docs/default-source/hprg-tmhs/chpb-tmhs/prohibited_restricted_ing_guidelines.pdf"
    rightsStatus: "open_access"
    redistributable: false
    accessNotes: "External source artifact candidate only; copyrighted or externally hosted materials were not stored in Git during this extraction."
extractedEvidence:
  population: "Health supplements and traditional medicines in Singapore containing Monascus purpureus (red yeast rice)."
  interventionOrExposure: "Monascus purpureus (red yeast rice) with naturally occurring lovastatin."
  comparatorOrControl: "None"
  durationOrFollowUp: "Not applicable"
  endpoints:
    - "lovastatin concentration"
    - "cautionary label"
    - "cholesterol-lowering medicine interaction"
    - "muscle ache stop condition"
  effectEstimatesOrDirection: "HSA restricts red yeast rice use by requiring lovastatin concentration below 1% and a cautionary statement advising medical advice with cholesterol-lowering medicines and discontinuation if muscle aches occur."
  adverseEventsOrSafetyNotes: "Muscle aches and cholesterol-lowering medicine interactions are specifically flagged in the required cautionary statement."
  limitations: "Regulatory guideline; does not evaluate LDL-C efficacy or incidence of adverse effects."
  populationMismatch: "Regulatory, product-quality, or safety context; not a Murph self-experiment cohort."
  directnessToProtocol: "general_guideline"
---
This source is included for **Regulatory and jurisdiction warnings**.

**Findings:** HSA guideline listing Monascus purpureus (red yeast rice) as restricted in health supplements and traditional medicines with lovastatin concentration and cautionary-label requirements.

**Why it matters:** Singapore-specific regulatory boundary for lovastatin content and warning labels.

**Potential experiment signals:** lovastatin percentage, cholesterol-lowering medication use, muscle aches.

**Protocol takeaway:** For Singapore users, red yeast rice content and warning-label requirements are jurisdictional safety constraints.

**Claim use:** `safety-only`.
