---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:eur-lex-regulation-2024-2063-monacolin-k-health-claim-2024-07-30"
slug: "sources/red-yeast-rice/eur-lex-regulation-2024-2063-monacolin-k-health-claim-2024-07-30"
title: "Commission Regulation (EU) 2024/2063 of 30 July 2024 refusing to authorise a health claim involving monacolin K from red yeast rice"
summary: "EU regulation refusing to authorize a proposed SYLVAN BIO red yeast rice LDL-C health claim after considering EFSA conclusions and safety restrictions."
status: "draft"
quality: "usable"
aliases:
  - "EU 2024 refusal of SYLVAN BIO monacolin K health claim"
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
  title: "Commission Regulation (EU) 2024/2063 of 30 July 2024 refusing to authorise a health claim involving monacolin K from red yeast rice"
  authors: "European Commission"
  year: 2024
  journal: "Official Journal of the European Union"
  citation: "European Commission. Commission Regulation (EU) 2024/2063 of 30 July 2024 refusing to authorise a health claim involving monacolin K from red yeast rice. Official Journal of the European Union. 2024."
  url: "https://eur-lex.europa.eu/eli/reg/2024/2063/oj/eng"
sourceIdentity:
  identityKind: "guideline"
  canonicalIdBasis: "url"
  identifiers:
    titleHash: "2114df6ca6e61e09f6cf4e0f207bef19300e945fbf2977ab2e9681863066afe5"
    url: "https://eur-lex.europa.eu/eli/reg/2024/2063/oj/eng"
  canonicalUrl: "https://eur-lex.europa.eu/eli/reg/2024/2063/oj/eng"
researchEvidence:
  designKind: "guideline"
  designLabel: "Health-claim refusal regulation"
  populationLabel: "EU foods/supplements seeking a health claim for SYLVAN BIO red yeast rice and normal LDL-C."
  durationLabel: "Not applicable"
  aggregateRole: "primary"
  cohortKey: "eur-lex-regulation-2024-2063-monacolin-k-health-claim-2024-07-30"
evidenceBucket: "Regulatory and jurisdiction warnings"
whyItMatters: "Shows the current EU position: even where LDL-C effect is recognized at around 10 mg/day, claim authorization is constrained by safety and regulatory restrictions."
potentialMurphEndpoints:
  - "LDL-C"
  - "monacolin K daily dose"
  - "muscle symptoms"
  - "pregnancy/lactation exclusion"
protocolTakeaway: "Do not translate refused EU health claims into protocol claims; use as mixed regulatory/effect context only."
murphTakeaway: "The LDL-C effect signal depends on a monacolin dose range with drug-like safety restrictions."
studyDesign: "Health-claim refusal regulation"
modality: "Red yeast rice regulatory, product-quality, or safety context"
claimUse: "safety-only"
sourceFindings:
  -
    findingKind: "context"
    population: "EU health-claim application for SYLVAN BIO red yeast rice"
    exposure: "Monacolin K in SYLVAN BIO and other red yeast rice preparations"
    outcome: "Refusal to authorize health claim"
    summary: "Regulation (EU) 2024/2063 refused a proposed health claim involving monacolin K in SYLVAN BIO red yeast rice; the regulation recounts EFSA’s LDL-C effect conclusion at 10 mg/day but highlights lovastatin-like safety restrictions and regulatory constraints."
    evidenceUse:
      - "efficacy"
      - "safety"
      - "context"
    findingId: "finding:eur-lex-regulation-2024-2063-monacolin-k-health-claim-2024-07-30-health-claim-refused"
    sourceKey: "source_artifact:eur-lex-regulation-2024-2063-monacolin-k-health-claim-2024-07-30"
    extractedFromArtifactId: "art_eur_lex_regulation_2024_2063_monacolin_k_health_claim_2024_07_30_pdf"
murphV1Priority: "High"
pdfRightsStatus: "open_access"
artifacts:
  -
    artifactId: "art_eur_lex_regulation_2024_2063_monacolin_k_health_claim_2024_07_30_pdf"
    sourceKey: "source_artifact:eur-lex-regulation-2024-2063-monacolin-k-health-claim-2024-07-30"
    kind: "pdf"
    storage: "external"
    sourceUrl: "https://eur-lex.europa.eu/eli/reg/2024/2063/oj/eng"
    rightsStatus: "open_access"
    redistributable: false
    accessNotes: "External source artifact candidate only; copyrighted or externally hosted materials were not stored in Git during this extraction."
extractedEvidence:
  population: "EU foods/supplements seeking a health claim for SYLVAN BIO red yeast rice and normal LDL-C."
  interventionOrExposure: "SYLVAN BIO red yeast rice and monacolin K from red yeast rice preparations."
  comparatorOrControl: "None"
  durationOrFollowUp: "Not applicable"
  endpoints:
    - "LDL-C health claim"
    - "daily monacolin dose"
    - "myopathy/rhabdomyolysis safety warnings"
    - "pregnancy/lactation warnings"
  effectEstimatesOrDirection: "The regulation states EFSA concluded a cause-and-effect relationship for monacolin K red yeast rice preparations at 10 mg/day, while the proposed product-specific claim was refused in the regulatory context of monacolin restrictions and safety concerns."
  adverseEventsOrSafetyNotes: "Safety discussion includes lovastatin identity, myopathy/rhabdomyolysis risk, interactions, and pregnancy/lactation concerns."
  limitations: "Legal health-claim decision; no new protocol trial and product-specific claim context."
  populationMismatch: "Regulatory, product-quality, or safety context; not a Murph self-experiment cohort."
  directnessToProtocol: "general_guideline"
---
This source is included for **Regulatory and jurisdiction warnings**.

**Findings:** EU regulation refusing to authorize a proposed SYLVAN BIO red yeast rice LDL-C health claim after considering EFSA conclusions and safety restrictions.

**Why it matters:** Shows the current EU position: even where LDL-C effect is recognized at around 10 mg/day, claim authorization is constrained by safety and regulatory restrictions.

**Potential experiment signals:** LDL-C, monacolin K daily dose, muscle symptoms, pregnancy/lactation exclusion.

**Protocol takeaway:** Do not translate refused EU health claims into protocol claims; use as mixed regulatory/effect context only.

**Claim use:** `safety-only`.
