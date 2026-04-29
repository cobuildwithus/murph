---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:fda-red-yeast-rice-products-warning-2007-08-09"
slug: "sources/red-yeast-rice/fda-red-yeast-rice-products-warning-2007-08-09"
title: "FDA Warns Consumers to Avoid Red Yeast Rice Products Promoted on Internet as Treatments for High Cholesterol"
summary: "FDA warning advising consumers to avoid several internet-promoted red yeast rice products for high cholesterol after testing found lovastatin."
status: "draft"
quality: "usable"
aliases:
  - "FDA 2007 red yeast rice products warning"
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
  title: "FDA Warns Consumers to Avoid Red Yeast Rice Products Promoted on Internet as Treatments for High Cholesterol"
  authors: "U.S. Food and Drug Administration"
  year: 2007
  journal: "FDA / Indiana Department of Health archive"
  citation: "U.S. Food and Drug Administration. FDA Warns Consumers to Avoid Red Yeast Rice Products Promoted on Internet as Treatments for High Cholesterol. 2007."
  url: "https://www.in.gov/health/food-protection/recalls-and-advisories/2007-advisories/red-yeast-rice-products/"
sourceIdentity:
  identityKind: "web_page"
  canonicalIdBasis: "url"
  identifiers:
    titleHash: "eff8aedbf04c9421a270bb5b1ab4cd1bca6af24348d057c3fd80c2a332e74ca3"
    url: "https://www.in.gov/health/food-protection/recalls-and-advisories/2007-advisories/red-yeast-rice-products/"
  canonicalUrl: "https://www.in.gov/health/food-protection/recalls-and-advisories/2007-advisories/red-yeast-rice-products/"
researchEvidence:
  designKind: "guideline"
  designLabel: "Consumer safety warning"
  populationLabel: "Consumers considering internet-promoted red yeast rice products for high cholesterol."
  durationLabel: "Not applicable"
  aggregateRole: "primary"
  cohortKey: "fda-red-yeast-rice-products-warning-2007-08-09"
evidenceBucket: "Regulatory and jurisdiction warnings"
whyItMatters: "Classic U.S. regulatory warning establishing hidden lovastatin as a red yeast rice safety and legality issue."
potentialMurphEndpoints:
  - "product name"
  - "interacting medications"
  - "muscle pain/weakness"
  - "dark urine"
protocolTakeaway: "Historical FDA warnings should remain in safety guardrails; product claims are not enough to establish safe supplement status."
murphTakeaway: "Consumers should not treat internet-marketed high-cholesterol red yeast rice products as low-risk natural supplements without chemistry and regulatory checks."
studyDesign: "Consumer safety warning"
modality: "Red yeast rice regulatory, product-quality, or safety context"
claimUse: "safety-only"
sourceFindings:

  -
    findingKind: "safety"
    population: "Consumers of internet-promoted red yeast rice cholesterol products"
    exposure: "Named red yeast rice products containing lovastatin"
    outcome: "Consumer warning and unapproved-drug concern"
    summary: "FDA warned consumers to avoid three red yeast rice products promoted for high cholesterol after testing found lovastatin and highlighted severe muscle, kidney, and drug-interaction risks."
    evidenceUse:
      - "safety"
      - "context"
    findingId: "finding:fda-red-yeast-rice-products-warning-2007-08-09-2007-hidden-lovastatin-warning"
    sourceKey: "source_artifact:fda-red-yeast-rice-products-warning-2007-08-09"
    extractedFromArtifactId: "art_fda_red_yeast_rice_products_warning_2007_08_09_html"
murphV1Priority: "High"
pdfRightsStatus: "open_access"
artifacts:

  -
    artifactId: "art_fda_red_yeast_rice_products_warning_2007_08_09_html"
    sourceKey: "source_artifact:fda-red-yeast-rice-products-warning-2007-08-09"
    kind: "html"
    storage: "external"
    sourceUrl: "https://www.in.gov/health/food-protection/recalls-and-advisories/2007-advisories/red-yeast-rice-products/"
    rightsStatus: "open_access"
    redistributable: false
    accessNotes: "External source artifact candidate only; copyrighted or externally hosted materials were not stored in Git during this extraction."
extractedEvidence:
  population: "Consumers considering internet-promoted red yeast rice products for high cholesterol."
  interventionOrExposure: "Red Yeast Rice, Red Yeast Rice/Policosanol Complex, and Cholestrix products found to contain lovastatin."
  comparatorOrControl: "None"
  durationOrFollowUp: "Not applicable"
  endpoints:
    - "hidden lovastatin"
    - "muscle toxicity"
    - "kidney impairment"
    - "drug interaction risk"
  effectEstimatesOrDirection: "FDA testing revealed lovastatin in three red yeast rice products promoted for high cholesterol."
  adverseEventsOrSafetyNotes: "FDA warned of severe muscle problems that can lead to kidney impairment, with risk increased by high doses or interacting medicines."
  limitations: "Consumer warning for named products; no incidence or risk denominator."
  populationMismatch: "Regulatory, product-quality, or safety context; not a Murph self-experiment cohort."
  directnessToProtocol: "general_guideline"
---
This source is included for **Regulatory and jurisdiction warnings**.

**Findings:** FDA warning advising consumers to avoid several internet-promoted red yeast rice products for high cholesterol after testing found lovastatin.

**Why it matters:** Classic U.S. regulatory warning establishing hidden lovastatin as a red yeast rice safety and legality issue.

**Potential experiment signals:** product name, interacting medications, muscle pain/weakness, dark urine.

**Protocol takeaway:** Historical FDA warnings should remain in safety guardrails; product claims are not enough to establish safe supplement status.

**Claim use:** `safety-only`.
