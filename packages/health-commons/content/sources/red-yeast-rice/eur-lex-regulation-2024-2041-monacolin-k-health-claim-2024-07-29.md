---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:eur-lex-regulation-2024-2041-monacolin-k-health-claim-2024-07-29"
slug: "sources/red-yeast-rice/eur-lex-regulation-2024-2041-monacolin-k-health-claim-2024-07-29"
title: "Commission Regulation (EU) 2024/2041 of 29 July 2024 amending Regulation (EU) No 432/2012 as regards the health claim on monacolin K from red yeast rice"
summary: "EU regulation revoking the permitted health claim for monacolin K from red yeast rice because the claim’s 10 mg/day condition conflicts with monacolin safety restrictions."
status: "draft"
quality: "usable"
aliases:
  - "EU 2024 monacolin K health claim revocation"
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
  title: "Commission Regulation (EU) 2024/2041 of 29 July 2024 amending Regulation (EU) No 432/2012 as regards the health claim on monacolin K from red yeast rice"
  authors: "European Commission"
  year: 2024
  journal: "Official Journal of the European Union"
  citation: "European Commission. Commission Regulation (EU) 2024/2041 of 29 July 2024 amending Regulation (EU) No 432/2012 as regards the health claim on monacolin K from red yeast rice. Official Journal of the European Union. 2024."
  url: "https://eur-lex.europa.eu/legal-content/EN/PIN/?uri=oj:L_202402041"
sourceIdentity:
  identityKind: "guideline"
  canonicalIdBasis: "url"
  identifiers:
    titleHash: "0879e8f9cdc73c9ca6c45c28ece02e473137af15d30928c8c15dcc573d734e8b"
    url: "https://eur-lex.europa.eu/legal-content/EN/PIN/?uri=oj:L_202402041"
  canonicalUrl: "https://eur-lex.europa.eu/legal-content/EN/PIN/?uri=oj:L_202402041"
researchEvidence:
  designKind: "guideline"
  designLabel: "Health-claim regulation"
  populationLabel: "Foods and food supplements using health claims for monacolin K from red yeast rice in the EU."
  durationLabel: "Not applicable"
  aggregateRole: "primary"
  cohortKey: "eur-lex-regulation-2024-2041-monacolin-k-health-claim-2024-07-29"
evidenceBucket: "Regulatory and jurisdiction warnings"
whyItMatters: "Preserves a mixed boundary: LDL-C efficacy at higher monacolin exposure is acknowledged, but the associated dose is not compatible with current safety restrictions."
potentialMurphEndpoints:
  - "LDL-C"
  - "monacolin K daily dose"
  - "label claims"
  - "muscle/liver safety warnings"
protocolTakeaway: "Do not use the old EU LDL health claim as a live protocol claim; it has been revoked."
murphTakeaway: "A protocol should not promise the 10 mg monacolin effect while using dose ceilings constrained below 3 mg for safety/legal reasons."
studyDesign: "Health-claim regulation"
modality: "Red yeast rice regulatory, product-quality, or safety context"
claimUse: "safety-only"
sourceFindings:
  -
    findingKind: "context"
    population: "EU food products carrying monacolin K red yeast rice health claims"
    exposure: "Monacolin K from red yeast rice"
    outcome: "Revocation of LDL-C health claim"
    summary: "Regulation (EU) 2024/2041 revokes the permitted health claim for monacolin K from red yeast rice: EFSA had found LDL-C claim substantiation at 10 mg/day, but current safety restrictions prohibit portions providing 3 mg or more, so the claim should no longer be used on foods."
    evidenceUse:
      - "efficacy"
      - "safety"
      - "context"
    findingId: "finding:eur-lex-regulation-2024-2041-monacolin-k-health-claim-2024-07-29-health-claim-revoked"
    sourceKey: "source_artifact:eur-lex-regulation-2024-2041-monacolin-k-health-claim-2024-07-29"
    extractedFromArtifactId: "art_eur_lex_regulation_2024_2041_monacolin_k_health_claim_2024_07_29_pdf"
murphV1Priority: "High"
pdfRightsStatus: "open_access"
artifacts:
  -
    artifactId: "art_eur_lex_regulation_2024_2041_monacolin_k_health_claim_2024_07_29_pdf"
    sourceKey: "source_artifact:eur-lex-regulation-2024-2041-monacolin-k-health-claim-2024-07-29"
    kind: "pdf"
    storage: "external"
    sourceUrl: "https://eur-lex.europa.eu/legal-content/EN/PIN/?uri=oj:L_202402041"
    rightsStatus: "open_access"
    redistributable: false
    accessNotes: "External source artifact candidate only; copyrighted or externally hosted materials were not stored in Git during this extraction."
extractedEvidence:
  population: "Foods and food supplements using health claims for monacolin K from red yeast rice in the EU."
  interventionOrExposure: "Monacolin K from red yeast rice; previously authorized claim condition of 10 mg/day."
  comparatorOrControl: "None"
  durationOrFollowUp: "Not applicable"
  endpoints:
    - "LDL-C health claim"
    - "monacolin safety restriction"
    - "label claim legality"
  effectEstimatesOrDirection: "The regulation recounts that EFSA had found a cause-and-effect relationship at 10 mg/day, but the Commission revoked the health claim because current restrictions prohibit 3 mg or more per recommended daily portion."
  adverseEventsOrSafetyNotes: "Safety rationale includes lovastatin identity, myopathy/rhabdomyolysis warnings, pregnancy/lactation concerns, and inability to define a safe intake."
  limitations: "Health-claim legal act; it summarizes evidence/regulatory reasoning rather than reporting new trial data."
  populationMismatch: "Regulatory, product-quality, or safety context; not a Murph self-experiment cohort."
  directnessToProtocol: "general_guideline"
---
This source is included for **Regulatory and jurisdiction warnings**.

**Findings:** EU regulation revoking the permitted health claim for monacolin K from red yeast rice because the claim’s 10 mg/day condition conflicts with monacolin safety restrictions.

**Why it matters:** Preserves a mixed boundary: LDL-C efficacy at higher monacolin exposure is acknowledged, but the associated dose is not compatible with current safety restrictions.

**Potential experiment signals:** LDL-C, monacolin K daily dose, label claims, muscle/liver safety warnings.

**Protocol takeaway:** Do not use the old EU LDL health claim as a live protocol claim; it has been revoked.

**Claim use:** `safety-only`.
