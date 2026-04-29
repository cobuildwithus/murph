---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:clinicaltrials-nct06368258-2026-04-26"
slug: "sources/red-yeast-rice/clinicaltrials-nct06368258-2026-04-26"
title: "Middle Term Effect of Red Yeast Rice on Plasma Lipids and Proteoma in Individuals With Suboptimal Cholesterolemia"
summary: "Registry watchlist for a planned/early RYR crossover trial measuring lipids, proteomics, and safety labs."
status: "draft"
quality: "usable"
aliases:
  - "NCT06368258"
  - "RYR plasma lipids and proteoma crossover registry"
categories:
  - "red-yeast-rice"
relations:

  -
    type: "related_protocol"
    target: "protocol_variant:red-yeast-rice/red-yeast-rice-for-cholesterol"
  -
    type: "parent_family"
    target: "experiment_family:red-yeast-rice"
source:
  kind: "other"
  title: "Middle Term Effect of Red Yeast Rice on Plasma Lipids and Proteoma in Individuals With Suboptimal Cholesterolemia"
  authors: "ClinicalTrials.gov; University of Bologna"
  year: 2026
  journal: "ClinicalTrials.gov"
  citation: "ClinicalTrials.gov. Middle Term Effect of Red Yeast Rice on Plasma Lipids and Proteoma in Individuals With Suboptimal Cholesterolemia. NCT06368258. Snapshot source key dated 2026-04-26."
  url: "https://clinicaltrials.gov/study/NCT06368258"
sourceIdentity:
  identityKind: "trial_registry"
  canonicalIdBasis: "registry_id"
  identifiers:
    registryId: "NCT06368258"
    titleHash: "a8a54f171b84854f16f6573ac2caabf639d548e0d1f327fa8484b3d098cba3f5"
    url: "https://clinicaltrials.gov/study/NCT06368258"
  canonicalUrl: "https://clinicaltrials.gov/study/NCT06368258"
researchEvidence:
  designKind: "crossover_trial"
  designLabel: "Planned randomized crossover RYR lipid/proteomics registry"
  participantCount: 40
  participantCountKind: "approximate"
  populationLabel: "Individuals with suboptimal cholesterolemia and low-to-moderate cardiovascular risk."
  durationLabel: "Planned 6-week treatment periods in accessible extraction notes"
  aggregateRole: "context"
  cohortKey: "clinicaltrials-nct06368258-2026-04-26"
evidenceBucket: "Direct trial registry and future evidence watchlist"
whyItMatters: "May become a useful modern low-dose RYR lipid and proteomics source if results are posted."
potentialMurphEndpoints:
  - "LDL-C"
  - "total cholesterol"
  - "non-HDL-C"
  - "AST"
  - "ALT"
  - "gamma-GT"
  - "CPK"
  - "proteomics"
protocolTakeaway: "Watchlist only; no result claim."
murphTakeaway: "Useful to anticipate endpoints, not to set current expected benefits."
studyDesign: "Randomized crossover trial registry"
modality: "Trial registry record"
claimUse: "context-only"
directness: "direct_protocol_registry"
interventionOrExposure: "RYR 160 mg providing approximately 2.8 mg total monacolins."
comparatorOrControl: "Placebo in crossover design."
durationOrFollowUp: "Planned 6-week treatment periods in accessible extraction notes"
endpoints:
  - "LDL-C"
  - "total cholesterol"
  - "non-HDL-C"
  - "AST"
  - "ALT"
  - "gamma-GT"
  - "CPK"
  - "proteomics"
effectEstimatesOrDirection: "No efficacy results available in extracted registry context."
adverseEventsOrSafetyNotes: "Planned safety labs include AST, ALT, gamma-GT, and CPK."
limitations: "Registry watchlist item; status and results require refresh before use."
populationMismatch: "Suboptimal cholesterolemia, low-to-moderate risk; no completed results in this source batch."
sourceFindings:

  -
    findingId: "finding:clinicaltrials-nct06368258-2026-04-26-planned-trial"
    sourceKey: "source_artifact:clinicaltrials-nct06368258-2026-04-26"
    findingKind: "context"
    population: "Individuals with suboptimal cholesterolemia and low-to-moderate cardiovascular risk."
    exposure: "RYR 160 mg providing approximately 2.8 mg total monacolins."
    outcome: "Planned endpoints and dose"
    summary: "NCT06368258 describes a randomized crossover study of RYR 160 mg with approximately 2.8 mg total monacolins versus placebo, with planned LDL-C, total cholesterol, non-HDL-C, safety-lab, and proteomics endpoints."
    evidenceUse:
      - "context"
      - "measurement"
  -
    findingId: "finding:clinicaltrials-nct06368258-2026-04-26-no-results"
    sourceKey: "source_artifact:clinicaltrials-nct06368258-2026-04-26"
    findingKind: "context"
    population: "Individuals with suboptimal cholesterolemia and low-to-moderate cardiovascular risk."
    exposure: "RYR 160 mg providing approximately 2.8 mg total monacolins."
    outcome: "No efficacy results"
    summary: "No completed efficacy results were extracted from this registry in batch-001."
    evidenceUse:
      - "context"
murphV1Priority: "Low"
pdfRightsStatus: "open_access"
---
This source is included for **Direct trial registry and future evidence watchlist**.

**Findings:** No efficacy results available in extracted registry context. Planned safety labs include AST, ALT, gamma-GT, and CPK.

**Why it matters:** May become a useful modern low-dose RYR lipid and proteomics source if results are posted.

**Potential experiment signals:** LDL-C, total cholesterol, non-HDL-C, AST, ALT, gamma-GT, CPK, proteomics.

**Protocol takeaway:** Watchlist only; no result claim.

**Claim use:** `context-only`.

**Directness and boundary:** direct_protocol_registry. Registry watchlist item; status and results require refresh before use. Population mismatch: Suboptimal cholesterolemia, low-to-moderate risk; no completed results in this source batch.
