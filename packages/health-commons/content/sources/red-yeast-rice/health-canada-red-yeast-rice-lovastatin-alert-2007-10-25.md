---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:health-canada-red-yeast-rice-lovastatin-alert-2007-10-25"
slug: "sources/red-yeast-rice/health-canada-red-yeast-rice-lovastatin-alert-2007-10-25"
title: "Archived – Red Yeast Rice, Red Yeast Rice/Policosonal Complex and Cholestrix"
summary: "Health Canada foreign product alert about red yeast rice products promoted for high cholesterol and reported by FDA to contain lovastatin."
status: "draft"
quality: "usable"
aliases:
  - "Health Canada foreign product alert red yeast rice lovastatin"
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
  title: "Archived – Red Yeast Rice, Red Yeast Rice/Policosonal Complex and Cholestrix"
  authors: "Health Canada"
  year: 2007
  journal: "Health Canada recalls and safety alerts"
  citation: "Health Canada. Archived – Red Yeast Rice, Red Yeast Rice/Policosonal Complex and Cholestrix. Foreign Product Alert. 2007."
  url: "https://recalls-rappels.canada.ca/en/alert-recall/red-yeast-rice-red-yeast-ricepolicosonal-complex-and-cholestrix"
sourceIdentity:
  identityKind: "web_page"
  canonicalIdBasis: "url"
  identifiers:
    titleHash: "5b2bb5f7f6aae58ea941147bb26279356d7abf2387b8ecd3c272006cfc688482"
    url: "https://recalls-rappels.canada.ca/en/alert-recall/red-yeast-rice-red-yeast-ricepolicosonal-complex-and-cholestrix"
  canonicalUrl: "https://recalls-rappels.canada.ca/en/alert-recall/red-yeast-rice-red-yeast-ricepolicosonal-complex-and-cholestrix"
researchEvidence:
  designKind: "guideline"
  designLabel: "Foreign product alert"
  populationLabel: "Canadian consumers who could acquire the named products through travel or internet purchase."
  durationLabel: "Not applicable"
  aggregateRole: "primary"
  cohortKey: "health-canada-red-yeast-rice-lovastatin-alert-2007-10-25"
evidenceBucket: "Regulatory and jurisdiction warnings"
whyItMatters: "Adds Canada-specific jurisdictional context for products promoted for cholesterol management."
potentialMurphEndpoints:
  - "jurisdiction"
  - "product authorization status"
  - "liver/kidney history"
  - "concomitant medications"
protocolTakeaway: "Jurisdiction matters: a product may be unauthorized and unsafe even if obtainable online."
murphTakeaway: "A Murph protocol should log user jurisdiction and product authorization status before helping a user evaluate or log a product-specific run."
studyDesign: "Foreign product alert"
modality: "Red yeast rice regulatory, product-quality, or safety context"
claimUse: "safety-only"
sourceFindings:
  -
    findingKind: "safety"
    population: "Canadian consumers potentially exposed through travel or internet purchase"
    exposure: "Named red yeast rice products containing lovastatin"
    outcome: "Unauthorized product warning"
    summary: "Health Canada warned that named red yeast rice products promoted for high cholesterol were unauthorized in Canada and could expose users to lovastatin-associated liver, kidney, muscle, pregnancy, and interaction risks."
    evidenceUse:
      - "safety"
      - "context"
    findingId: "finding:health-canada-red-yeast-rice-lovastatin-alert-2007-10-25-canada-foreign-product-alert"
    sourceKey: "source_artifact:health-canada-red-yeast-rice-lovastatin-alert-2007-10-25"
    extractedFromArtifactId: "art_health_canada_red_yeast_rice_lovastatin_alert_2007_10_25_html"
murphV1Priority: "High"
pdfRightsStatus: "open_access"
artifacts:
  -
    artifactId: "art_health_canada_red_yeast_rice_lovastatin_alert_2007_10_25_html"
    sourceKey: "source_artifact:health-canada-red-yeast-rice-lovastatin-alert-2007-10-25"
    kind: "html"
    storage: "external"
    sourceUrl: "https://recalls-rappels.canada.ca/en/alert-recall/red-yeast-rice-red-yeast-ricepolicosonal-complex-and-cholestrix"
    rightsStatus: "open_access"
    redistributable: false
    accessNotes: "External source artifact candidate only; copyrighted or externally hosted materials were not stored in Git during this extraction."
extractedEvidence:
  population: "Canadian consumers who could acquire the named products through travel or internet purchase."
  interventionOrExposure: "Named red yeast rice products containing lovastatin."
  comparatorOrControl: "None"
  durationOrFollowUp: "Not applicable"
  endpoints:
    - "hidden lovastatin"
    - "liver/kidney/muscle risks"
    - "unauthorized product status"
  effectEstimatesOrDirection: "Health Canada noted the products were not authorized in Canada and repeated FDA findings that they contained lovastatin."
  adverseEventsOrSafetyNotes: "Health Canada warned of possible liver, kidney, and muscle problems and advised avoidance in pregnancy/nursing, elderly people, and people with liver/kidney disease or interacting medicines."
  limitations: "Foreign product alert; no Canadian adverse reactions had been reported at the posting date and no incidence denominator is available."
  populationMismatch: "Regulatory, product-quality, or safety context; not a Murph self-experiment cohort."
  directnessToProtocol: "general_guideline"
---
This source is included for **Regulatory and jurisdiction warnings**.

**Findings:** Health Canada foreign product alert about red yeast rice products promoted for high cholesterol and reported by FDA to contain lovastatin.

**Why it matters:** Adds Canada-specific jurisdictional context for products promoted for cholesterol management.

**Potential experiment signals:** jurisdiction, product authorization status, liver/kidney history, concomitant medications.

**Protocol takeaway:** Jurisdiction matters: a product may be unauthorized and unsafe even if obtainable online.

**Claim use:** `safety-only`.
