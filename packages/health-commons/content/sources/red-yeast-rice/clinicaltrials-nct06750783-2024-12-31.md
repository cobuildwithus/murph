---
schemaVersion: "murph.commons.page.v1"
entityType: "source_artifact"
key: "source_artifact:clinicaltrials-nct06750783-2024-12-31"
slug: "sources/red-yeast-rice/clinicaltrials-nct06750783-2024-12-31"
title: "The Effects of Xuezhikang and Atorvastatin on Lipid in Patients With Dyslipidemia and Prediabetes"
summary: "Registry watchlist for Xuezhikang versus atorvastatin in dyslipidemia with prediabetes."
status: "draft"
quality: "usable"
aliases:
  - "NCT06750783"
  - "Xuezhikang versus atorvastatin dyslipidemia prediabetes registry"
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
  title: "The Effects of Xuezhikang and Atorvastatin on Lipid in Patients With Dyslipidemia and Prediabetes"
  authors: "ClinicalTrials.gov; Beijing Tsinghua Chang Gung Hospital"
  year: 2024
  journal: "ClinicalTrials.gov"
  citation: "ClinicalTrials.gov. The Effects of Xuezhikang and Atorvastatin on Lipid in Patients With Dyslipidemia and Prediabetes. NCT06750783. Source key dated 2024-12-31."
  url: "https://clinicaltrials.gov/study/NCT06750783"
sourceIdentity:
  identityKind: "trial_registry"
  canonicalIdBasis: "registry_id"
  identifiers:
    registryId: "NCT06750783"
    titleHash: "68964b1853f11f9d8741f758fbaac703e2c506e77ad84b0f0f5985ac73af28b0"
    url: "https://clinicaltrials.gov/study/NCT06750783"
  canonicalUrl: "https://clinicaltrials.gov/study/NCT06750783"
researchEvidence:
  designKind: "randomized_controlled_trial"
  designLabel: "Recruiting open-label active-comparator Xuezhikang registry"
  participantCount: 398
  participantCountKind: "approximate"
  populationLabel: "Patients with dyslipidemia and prediabetes."
  durationLabel: "24 weeks"
  aggregateRole: "context"
  cohortKey: "clinicaltrials-nct06750783-2024-12-31"
evidenceBucket: "Direct trial registry and future evidence watchlist"
whyItMatters: "May inform future adjacent Xuezhikang comparisons but should not be merged into RYR-only evidence."
potentialMurphEndpoints:
  - "diabetes incidence"
  - "lipid profile"
  - "liver function"
  - "renal function"
  - "CK"
protocolTakeaway: "Context-only adjacent proprietary-preparation registry; no current protocol claim."
murphTakeaway: "Do not treat Xuezhikang active-comparator results as equivalent to over-the-counter RYR-only products."
studyDesign: "Randomized open-label active-comparator trial registry"
modality: "Xuezhikang registry record"
claimUse: "context-only"
directness: "adjacent_variant_registry"
interventionOrExposure: "Xuezhikang 600 mg twice daily for 24 weeks."
comparatorOrControl: "Atorvastatin 20 mg once daily for 24 weeks."
durationOrFollowUp: "24 weeks"
endpoints:
  - "diabetes incidence"
  - "lipid profile"
  - "liver function"
  - "renal function"
  - "CK"
effectEstimatesOrDirection: "No completed efficacy results were extracted in this batch."
adverseEventsOrSafetyNotes: "Planned monitoring includes liver function, renal function, and CK."
limitations: "Xuezhikang proprietary RYR-derived preparation and active statin comparator; recruiting/future evidence context only."
populationMismatch: "Prediabetes/dyslipidemia population and Xuezhikang product are adjacent to RYR-only consumer supplement protocol."
sourceFindings:
  -
    findingId: "finding:clinicaltrials-nct06750783-2024-12-31-planned-xuezhikang-trial"
    sourceKey: "source_artifact:clinicaltrials-nct06750783-2024-12-31"
    findingKind: "context"
    population: "Patients with dyslipidemia and prediabetes."
    exposure: "Xuezhikang 600 mg twice daily for 24 weeks."
    outcome: "Planned comparator and endpoints"
    summary: "NCT06750783 describes an open-label randomized trial of Xuezhikang 600 mg twice daily versus atorvastatin 20 mg daily for 24 weeks in dyslipidemia and prediabetes, with lipid profile and safety-lab endpoints; no completed results were extracted."
    evidenceUse:
      - "context"
      - "adjacent_variant"
      - "measurement"
  -
    findingId: "finding:clinicaltrials-nct06750783-2024-12-31-adjacent-product-boundary"
    sourceKey: "source_artifact:clinicaltrials-nct06750783-2024-12-31"
    findingKind: "context"
    population: "Patients with dyslipidemia and prediabetes."
    exposure: "Xuezhikang 600 mg twice daily for 24 weeks."
    outcome: "Xuezhikang boundary"
    summary: "Xuezhikang is a proprietary RYR-derived preparation and should be handled as adjacent variant evidence rather than direct RYR-only supplement evidence."
    evidenceUse:
      - "context"
      - "adjacent_variant"
murphV1Priority: "Low"
pdfRightsStatus: "unknown"
---
This source is included for **Direct trial registry and future evidence watchlist**.

**Findings:** No completed efficacy results were extracted in this batch. Planned monitoring includes liver function, renal function, and CK.

**Why it matters:** May inform future adjacent Xuezhikang comparisons but should not be merged into RYR-only evidence.

**Potential experiment signals:** diabetes incidence, lipid profile, liver function, renal function, CK.

**Protocol takeaway:** Context-only adjacent proprietary-preparation registry; no current protocol claim.

**Claim use:** `context-only`.

**Directness and boundary:** adjacent_variant_registry. Xuezhikang proprietary RYR-derived preparation and active statin comparator; recruiting/future evidence context only. Population mismatch: Prediabetes/dyslipidemia population and Xuezhikang product are adjacent to RYR-only consumer supplement protocol.
