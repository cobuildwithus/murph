---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:fda-dr-sam-robbins-red-yeast-rice-2020-08-28"
slug: "sources/red-yeast-rice/fda-dr-sam-robbins-red-yeast-rice-2020-08-28"
title: "Dr. Sam Robbins, Inc. dba HFL Solutions, LLC - 608729"
summary: "FDA warning letter reporting lab-tested lovastatin levels in CholesLo red yeast rice capsules and treating added/enhanced lovastatin as a drug issue."
status: "draft"
quality: "usable"
aliases:
  - "FDA warning letter CholesLo red yeast rice"
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
  title: "Dr. Sam Robbins, Inc. dba HFL Solutions, LLC - 608729"
  authors: "U.S. Food and Drug Administration"
  year: 2020
  journal: "FDA Warning Letters"
  citation: "U.S. Food and Drug Administration. Dr. Sam Robbins, Inc. dba HFL Solutions, LLC - 608729. FDA Warning Letter. 2020."
  url: "https://www.fda.gov/inspections-compliance-enforcement-and-criminal-investigations/warning-letters/dr-sam-robbins-inc-dba-hfl-solutions-llc-608729-08282020"
sourceIdentity:
  identityKind: "web_page"
  canonicalIdBasis: "url"
  identifiers:
    titleHash: "ce22d2f6e7674440ed858732a37bb14d5ee13a6618e53cafcdb8f6574de0ad69"
    url: "https://www.fda.gov/inspections-compliance-enforcement-and-criminal-investigations/warning-letters/dr-sam-robbins-inc-dba-hfl-solutions-llc-608729-08282020"
  canonicalUrl: "https://www.fda.gov/inspections-compliance-enforcement-and-criminal-investigations/warning-letters/dr-sam-robbins-inc-dba-hfl-solutions-llc-608729-08282020"
researchEvidence:
  designKind: "guideline"
  designLabel: "FDA warning letter / product testing"
  populationLabel: "Consumers of CholesLo product promoted for cholesterol management."
  durationLabel: "Not applicable"
  aggregateRole: "primary"
  cohortKey: "fda-dr-sam-robbins-red-yeast-rice-2020-08-28"
evidenceBucket: "Regulatory and jurisdiction warnings"
whyItMatters: "Demonstrates product-level variability and hidden/enhanced lovastatin risk in a cholesterol-labeled product."
potentialMurphEndpoints:
  - "capsule lovastatin content"
  - "daily serving size"
  - "muscle symptoms"
  - "liver-safety symptoms"
protocolTakeaway: "Do not use unverified red yeast rice products as protocol evidence; product chemistry may dominate outcomes."
murphTakeaway: "Dose verification is essential because labeled red yeast rice capsules may deliver drug-range lovastatin exposure."
studyDesign: "FDA warning letter / product testing"
modality: "Red yeast rice regulatory, product-quality, or safety context"
claimUse: "safety-only"
sourceFindings:

  -
    findingKind: "safety"
    population: "Consumers of CholesLo red yeast rice capsules"
    exposure: "Measured lovastatin content in CholesLo samples"
    outcome: "Product-content variability and drug-status concern"
    summary: "FDA reported CholesLo samples with markedly different lovastatin levels, including one sample that could deliver approximately 85.8 mg/day at the maximum labeled dose, illustrating hidden or enhanced lovastatin exposure risk."
    evidenceUse:
      - "safety"
      - "measurement"
      - "context"
    findingId: "finding:fda-dr-sam-robbins-red-yeast-rice-2020-08-28-choleslo-lovastatin-content"
    sourceKey: "source_artifact:fda-dr-sam-robbins-red-yeast-rice-2020-08-28"
    extractedFromArtifactId: "art_fda_dr_sam_robbins_red_yeast_rice_2020_08_28_html"
murphV1Priority: "High"
pdfRightsStatus: "open_access"
artifacts:

  -
    artifactId: "art_fda_dr_sam_robbins_red_yeast_rice_2020_08_28_html"
    sourceKey: "source_artifact:fda-dr-sam-robbins-red-yeast-rice-2020-08-28"
    kind: "html"
    storage: "external"
    sourceUrl: "https://www.fda.gov/inspections-compliance-enforcement-and-criminal-investigations/warning-letters/dr-sam-robbins-inc-dba-hfl-solutions-llc-608729-08282020"
    rightsStatus: "open_access"
    redistributable: false
    accessNotes: "External source artifact candidate only; copyrighted or externally hosted materials were not stored in Git during this extraction."
extractedEvidence:
  population: "Consumers of CholesLo product promoted for cholesterol management."
  interventionOrExposure: "CholesLo red yeast rice capsules with measured lovastatin content."
  comparatorOrControl: "None"
  durationOrFollowUp: "Not applicable"
  endpoints:
    - "lovastatin per capsule"
    - "maximum labeled daily lovastatin exposure"
    - "drug-claim boundary"
  effectEstimatesOrDirection: "FDA reported one sample with approximately 14.3 mg lovastatin per capsule and a maximum labeled dose of 85.8 mg/day, while another sample had approximately 0.4141 mg per capsule and 2.48 mg/day."
  adverseEventsOrSafetyNotes: "High or variable lovastatin exposure can create statin-like safety concerns and shows product-dose unpredictability."
  limitations: "Warning-letter product sample; not a clinical outcome study and not generalizable to all red yeast rice products."
  populationMismatch: "Regulatory, product-quality, or safety context; not a Murph self-experiment cohort."
  directnessToProtocol: "general_guideline"
---
This source is included for **Regulatory and jurisdiction warnings**.

**Findings:** FDA warning letter reporting lab-tested lovastatin levels in CholesLo red yeast rice capsules and treating added/enhanced lovastatin as a drug issue.

**Why it matters:** Demonstrates product-level variability and hidden/enhanced lovastatin risk in a cholesterol-labeled product.

**Potential experiment signals:** capsule lovastatin content, daily serving size, muscle symptoms, liver-safety symptoms.

**Protocol takeaway:** Do not use unverified red yeast rice products as protocol evidence; product chemistry may dominate outcomes.

**Claim use:** `safety-only`.
