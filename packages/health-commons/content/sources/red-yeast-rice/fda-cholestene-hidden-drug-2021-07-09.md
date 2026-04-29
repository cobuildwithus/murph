---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:fda-cholestene-hidden-drug-2021-07-09"
slug: "sources/red-yeast-rice/fda-cholestene-hidden-drug-2021-07-09"
title: "Public Notification: Cholestene contains hidden drug ingredient"
summary: "FDA public notification advising consumers not to buy or use Cholestene after laboratory analysis found undeclared lovastatin."
status: "draft"
quality: "usable"
aliases:
  - "FDA Cholestene hidden lovastatin notification"
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
  title: "Public Notification: Cholestene contains hidden drug ingredient"
  authors: "U.S. Food and Drug Administration"
  year: 2021
  journal: "FDA Medication Health Fraud"
  citation: "U.S. Food and Drug Administration. Public Notification: Cholestene contains hidden drug ingredient. FDA. 2021."
  url: "https://www.fda.gov/drugs/medication-health-fraud/public-notification-cholestene-contains-hidden-drug-ingredient"
sourceIdentity:
  identityKind: "web_page"
  canonicalIdBasis: "url"
  identifiers:
    titleHash: "41f8f540b48be5921a05dc735ceeacb0a1cc7b78ab809b854076d128932dcecc"
    url: "https://www.fda.gov/drugs/medication-health-fraud/public-notification-cholestene-contains-hidden-drug-ingredient"
  canonicalUrl: "https://www.fda.gov/drugs/medication-health-fraud/public-notification-cholestene-contains-hidden-drug-ingredient"
researchEvidence:
  designKind: "guideline"
  designLabel: "Regulatory public notification"
  populationLabel: "Consumers using or considering Cholestene, a product marketed for cholesterol management."
  durationLabel: "Not applicable"
  aggregateRole: "primary"
  cohortKey: "fda-cholestene-hidden-drug-2021-07-09"
evidenceBucket: "Regulatory and jurisdiction warnings"
whyItMatters: "Shows a real-world red yeast rice cholesterol product can expose users to undeclared statin drug risk."
potentialMurphEndpoints:
  - "product name and lot"
  - "muscle pain/weakness"
  - "dark urine"
  - "liver-risk medications"
protocolTakeaway: "Hidden-drug findings are a safety boundary and should not be counted as natural-product efficacy evidence."
murphTakeaway: "Product-specific recalls should override protocol experimentation when the product contains undeclared lovastatin."
studyDesign: "Regulatory public notification"
modality: "Red yeast rice regulatory, product-quality, or safety context"
claimUse: "safety-only"
sourceFindings:

  -
    findingKind: "safety"
    population: "Consumers exposed to Cholestene"
    exposure: "Undeclared lovastatin in a product promoted for cholesterol management"
    outcome: "FDA warning and safety risk"
    summary: "FDA advised consumers not to buy or use Cholestene after laboratory analysis confirmed undeclared lovastatin; the notification highlights statin-like muscle, liver, interaction, and kidney-impairment risks."
    evidenceUse:
      - "safety"
      - "context"
    findingId: "finding:fda-cholestene-hidden-drug-2021-07-09-hidden-lovastatin"
    sourceKey: "source_artifact:fda-cholestene-hidden-drug-2021-07-09"
    extractedFromArtifactId: "art_fda_cholestene_hidden_drug_2021_07_09_html"
murphV1Priority: "High"
pdfRightsStatus: "open_access"
artifacts:

  -
    artifactId: "art_fda_cholestene_hidden_drug_2021_07_09_html"
    sourceKey: "source_artifact:fda-cholestene-hidden-drug-2021-07-09"
    kind: "html"
    storage: "external"
    sourceUrl: "https://www.fda.gov/drugs/medication-health-fraud/public-notification-cholestene-contains-hidden-drug-ingredient"
    rightsStatus: "open_access"
    redistributable: false
    accessNotes: "External source artifact candidate only; copyrighted or externally hosted materials were not stored in Git during this extraction."
extractedEvidence:
  population: "Consumers using or considering Cholestene, a product marketed for cholesterol management."
  interventionOrExposure: "Cholestene product containing undeclared lovastatin."
  comparatorOrControl: "None"
  durationOrFollowUp: "Not applicable"
  endpoints:
    - "hidden lovastatin"
    - "muscle injury symptoms"
    - "liver dysfunction risk"
    - "kidney impairment risk"
  effectEstimatesOrDirection: "FDA laboratory analysis confirmed lovastatin, a prescription-drug ingredient, in the product."
  adverseEventsOrSafetyNotes: "FDA warned that undeclared lovastatin can cause serious side effects and that risk is higher with liver dysfunction or interacting medicines; symptoms include muscle pain, weakness, fatigue, and dark urine."
  limitations: "Product-specific enforcement notification; no denominator or incidence estimate."
  populationMismatch: "Regulatory, product-quality, or safety context; not a Murph self-experiment cohort."
  directnessToProtocol: "general_guideline"
---
This source is included for **Regulatory and jurisdiction warnings**.

**Findings:** FDA public notification advising consumers not to buy or use Cholestene after laboratory analysis found undeclared lovastatin.

**Why it matters:** Shows a real-world red yeast rice cholesterol product can expose users to undeclared statin drug risk.

**Potential experiment signals:** product name and lot, muscle pain/weakness, dark urine, liver-risk medications.

**Protocol takeaway:** Hidden-drug findings are a safety boundary and should not be counted as natural-product efficacy evidence.

**Claim use:** `safety-only`.
