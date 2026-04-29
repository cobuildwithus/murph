---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:fda-dietary-supplement-ingredient-directory-red-yeast-rice-2025-05-23"
slug: "sources/red-yeast-rice/fda-dietary-supplement-ingredient-directory-red-yeast-rice-2025-05-23"
title: "Information on Select Dietary Supplement Ingredients and Other Substances"
summary: "FDA directory entry noting red yeast rice fermentation, monacolins, monacolin K/lovastatin identity, and links to FDA actions."
status: "draft"
quality: "usable"
aliases:
  - "FDA supplement ingredient directory red yeast rice entry"
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
  title: "Information on Select Dietary Supplement Ingredients and Other Substances"
  authors: "U.S. Food and Drug Administration"
  year: 2025
  journal: "FDA"
  citation: "U.S. Food and Drug Administration. Information on Select Dietary Supplement Ingredients and Other Substances. FDA. Accessed 2025."
  url: "https://www.fda.gov/food/dietary-supplements/information-select-dietary-supplement-ingredients-and-other-substances"
sourceIdentity:
  identityKind: "web_page"
  canonicalIdBasis: "url"
  identifiers:
    titleHash: "ff9321b9b92a88140713b9a471744fc92f557a699d3c862aeb66dfe59d167d7d"
    url: "https://www.fda.gov/food/dietary-supplements/information-select-dietary-supplement-ingredients-and-other-substances"
  canonicalUrl: "https://www.fda.gov/food/dietary-supplements/information-select-dietary-supplement-ingredients-and-other-substances"
researchEvidence:
  designKind: "guideline"
  designLabel: "Regulatory ingredient directory"
  populationLabel: "Dietary supplement stakeholders and consumers reviewing FDA actions for red yeast rice."
  durationLabel: "Not applicable"
  aggregateRole: "primary"
  cohortKey: "fda-dietary-supplement-ingredient-directory-red-yeast-rice-2025-05-23"
evidenceBucket: "Regulatory and jurisdiction warnings"
whyItMatters: "Summarizes FDA’s identity framing for monacolin K as a drug-like ingredient rather than a simple food-supplement constituent."
potentialMurphEndpoints:
  - "monacolin K label disclosure"
  - "jurisdiction"
  - "FDA warning-letter status"
protocolTakeaway: "Use as U.S. regulatory context; it does not independently support efficacy."
murphTakeaway: "The protocol should treat monacolin K exposure as drug-like and jurisdiction-dependent."
studyDesign: "Regulatory ingredient directory"
modality: "Red yeast rice regulatory, product-quality, or safety context"
claimUse: "safety-only"
sourceFindings:

  -
    findingKind: "context"
    population: "Dietary supplement consumers and stakeholders"
    exposure: "Red yeast rice containing monacolins"
    outcome: "FDA regulatory identity context"
    summary: "FDA’s dietary supplement ingredient directory describes red yeast rice as produced by fermentation of Monascus purpureus on rice and identifies monacolin K as lovastatin, the active ingredient in Mevacor."
    evidenceUse:
      - "context"
      - "safety"
    findingId: "finding:fda-dietary-supplement-ingredient-directory-red-yeast-rice-2025-05-23-ingredient-directory-context"
    sourceKey: "source_artifact:fda-dietary-supplement-ingredient-directory-red-yeast-rice-2025-05-23"
    extractedFromArtifactId: "art_fda_dietary_supplement_ingredient_directory_red_yeast_rice_2025_05_23_html"
murphV1Priority: "Medium"
pdfRightsStatus: "open_access"
artifacts:

  -
    artifactId: "art_fda_dietary_supplement_ingredient_directory_red_yeast_rice_2025_05_23_html"
    sourceKey: "source_artifact:fda-dietary-supplement-ingredient-directory-red-yeast-rice-2025-05-23"
    kind: "html"
    storage: "external"
    sourceUrl: "https://www.fda.gov/food/dietary-supplements/information-select-dietary-supplement-ingredients-and-other-substances"
    rightsStatus: "open_access"
    redistributable: false
    accessNotes: "External source artifact candidate only; copyrighted or externally hosted materials were not stored in Git during this extraction."
extractedEvidence:
  population: "Dietary supplement stakeholders and consumers reviewing FDA actions for red yeast rice."
  interventionOrExposure: "Red yeast rice and monacolins, including monacolin K/lovastatin."
  comparatorOrControl: "None"
  durationOrFollowUp: "Not applicable"
  endpoints:
    - "regulatory status"
    - "monacolin K identity"
    - "FDA action history"
  effectEstimatesOrDirection: "FDA describes red yeast rice as a source of monacolins and identifies monacolin K as lovastatin, the active ingredient in Mevacor."
  adverseEventsOrSafetyNotes: "Directory is a regulatory context source; linked FDA actions address hidden lovastatin and safety warnings."
  limitations: "Directory summary; it points to actions and does not provide clinical effect estimates."
  populationMismatch: "Regulatory, product-quality, or safety context; not a Murph self-experiment cohort."
  directnessToProtocol: "general_guideline"
---
This source is included for **Regulatory and jurisdiction warnings**.

**Findings:** FDA directory entry noting red yeast rice fermentation, monacolins, monacolin K/lovastatin identity, and links to FDA actions.

**Why it matters:** Summarizes FDA’s identity framing for monacolin K as a drug-like ingredient rather than a simple food-supplement constituent.

**Potential experiment signals:** monacolin K label disclosure, jurisdiction, FDA warning-letter status.

**Protocol takeaway:** Use as U.S. regulatory context; it does not independently support efficacy.

**Claim use:** `safety-only`.
